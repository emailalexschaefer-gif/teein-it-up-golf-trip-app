// PATCH /api/trips/[tripId]/members/[memberId] — assign group
// DELETE /api/trips/[tripId]/members/[memberId] — remove player from trip

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'

interface Props { params: Promise<{ tripId: string; memberId: string }> }

export async function PATCH(req: NextRequest, { params }: Props) {
  const { tripId, memberId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if ('group_id' in body) update.group_id = body.group_id || null
  if ('playing_handicap' in body) update.playing_handicap = body.playing_handicap ?? null

  const result = await admin.from('trip_members').update(update).eq('id', memberId).eq('trip_id', tripId).select('profile_id, group_id, playing_handicap, profiles:profile_id(handicap)').single()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  // ── Backfill scorecards for any round already active on this trip ──────────
  // The actual root cause this fixes: scorecard creation previously only
  // happened once, inside begin_round() at the moment the organiser starts
  // a round. A player assigned to a group afterward — e.g. someone who
  // joins mid-round, or is reassigned once the round is already underway —
  // never got a scorecard through any other path, which is why they were
  // invisible to Marker Assignment and saw "scorecard hasn't been set up."
  // Only runs when group_id is actually being assigned to a real group
  // (not cleared, not other fields), and only for rounds already 'active' —
  // 'upcoming' rounds still get their scorecards the normal way when
  // begin_round() eventually runs.
  if (update.group_id) {
    const activeRoundsRes = await admin
      .from('rounds')
      .select('id, holes')
      .eq('trip_id', tripId)
      .eq('status', 'active')

    // TEMPORARY diagnostic logging for the Friday scorecard investigation —
    // confirms whether this backfill path even ran, and for which active
    // rounds. If this player's scorecard is missing and this log shows
    // zero active rounds, the round wasn't yet 'active' when this player
    // was assigned — meaning begin_round() should have picked them up
    // directly instead, and the round-start logs are the ones to check.
    console.log('[members PATCH][diag] backfill check', {
      tripId, memberId, playerId: result.data.profile_id,
      activeRoundCount: activeRoundsRes.data?.length ?? 0,
      activeRoundIds: (activeRoundsRes.data ?? []).map((r: { id: string }) => r.id),
    })

    for (const round of activeRoundsRes.data ?? []) {
      const playingHandicap = resolvePlayingHandicap(
        result.data.playing_handicap,
        result.data.profiles?.handicap
      )
      // TEMPORARY diagnostic logging — shows the exact resolved handicap
      // and both source values, so a silent skip (below) is visible
      // rather than indistinguishable from the backfill never running.
      console.log('[members PATCH][diag] resolved handicap for backfill', {
        tripId, memberId, playerId: result.data.profile_id, roundId: round.id,
        tripHandicap: result.data.playing_handicap,
        profileHandicap: result.data.profiles?.handicap ?? null,
        resolvedHandicap: playingHandicap,
      })
      // Same "every player must have a playing handicap" requirement
      // begin_round() enforces — if this player genuinely has none set,
      // skip creating a scorecard rather than writing a wrong default;
      // the organiser still sees them as unassigned-for-scoring, which is
      // more honest than a silent 0.
      if (playingHandicap === null) {
        console.warn('[members PATCH][diag] backfill SKIPPED — no handicap available', {
          tripId, memberId, playerId: result.data.profile_id, roundId: round.id,
        })
        continue
      }

      const { error: backfillError, data: backfillData } = await admin
        .from('scorecards')
        .upsert(
          { round_id: round.id, player_id: result.data.profile_id, playing_handicap: playingHandicap, status: 'active' },
          { onConflict: 'round_id,player_id', ignoreDuplicates: true }
        )
        .select('id, player_id')
      // TEMPORARY diagnostic logging — the exact upsert result. Note
      // ignoreDuplicates:true means an already-existing scorecard returns
      // no row here without being an error — that's expected, not a bug,
      // if this player already had one.
      console.log('[members PATCH][diag] backfill upsert result', {
        tripId, memberId, playerId: result.data.profile_id, roundId: round.id,
        returnedRows: backfillData ?? null, hadError: !!backfillError,
      })
      if (backfillError) {
        console.error('[members PATCH] scorecard backfill failed', {
          tripId, memberId, roundId: round.id, error: backfillError,
        })
        // Don't fail the group-assignment request over this — the
        // assignment itself already succeeded above. Log and continue;
        // this is surfaced to the organiser as a missing scorecard they
        // can retry, not a silent group-assignment failure.
      }
    }
  }

  return NextResponse.json(result.data)
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const { tripId, memberId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Prevent organiser from removing themselves
  const memberRes = await admin.from('trip_members').select('profile_id, role').eq('id', memberId).single()
  if (memberRes.data?.role === 'organiser') {
    return NextResponse.json({ error: 'Cannot remove the organiser' }, { status: 400 })
  }

  const result = await admin.from('trip_members').delete().eq('id', memberId).eq('trip_id', tripId)
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
