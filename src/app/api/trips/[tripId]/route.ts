// PATCH /api/trips/[tripId] — edit an existing trip (organiser only)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string }> }

const SIDE_COMP_LABELS: Record<string, string> = {
  nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach", powerplay: 'Powerplay',
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify organiser
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Build update object from known-safe base columns only
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // Sprint 1-2 columns — always safe
  if (body.name        !== undefined) update.name        = body.name
  if (body.event_type  !== undefined) update.event_type  = body.event_type  || null
  if (body.location    !== undefined) update.location    = body.location    || null
  if (body.start_date  !== undefined) update.start_date  = body.start_date
  if (body.end_date    !== undefined) update.end_date    = body.end_date
  if (body.description !== undefined) update.description = body.description || null
  if (body.logo_url    !== undefined) update.logo_url    = body.logo_url    || null

  // Sprint 3 columns — try first, fall back gracefully if not in schema yet
  const sprint3Fields: Record<string, unknown> = {}
  if (body.expected_players     !== undefined) sprint3Fields.expected_players     = body.expected_players
  if (body.players_per_group    !== undefined) sprint3Fields.players_per_group    = body.players_per_group
  if (body.organiser_is_playing !== undefined) sprint3Fields.organiser_is_playing = body.organiser_is_playing

  // Try full update with Sprint 3 fields
  if (Object.keys(sprint3Fields).length > 0) {
    const { error: updateError } = await admin
      .from('trips').update({ ...update, ...sprint3Fields }).eq('id', tripId)

    if (updateError) {
      const msg = updateError.message ?? ''
      const isMissingCol = msg.includes('column') || msg.includes('schema cache')

      if (isMissingCol) {
        // Sprint 3 columns not in DB yet — save base fields only and warn
        console.warn('[PATCH /api/trips] Sprint 3 columns missing, saving base fields only. Run migration 011.')
        const { error: fallbackError } = await admin
          .from('trips').update(update).eq('id', tripId)
        if (fallbackError) {
          return NextResponse.json({ error: `Failed to update trip: ${fallbackError.message}` }, { status: 500 })
        }
        // Return partial success — client knows to show the result
        return NextResponse.json({ tripId, ok: true, warning: 'Some fields could not be saved — database migration may be needed' })
      }

      return NextResponse.json({ error: `Failed to update trip: ${updateError.message}` }, { status: 500 })
    }
  } else {
    // No Sprint 3 fields — simple update
    const { error: updateError } = await admin
      .from('trips').update(update).eq('id', tripId)
    if (updateError) {
      return NextResponse.json({ error: `Failed to update trip: ${updateError.message}` }, { status: 500 })
    }
  }

  // ── Rounds: reconcile with the submitted set, in place ──────────────────────
  // This USED to delete every existing round for the trip and re-insert fresh
  // rows on every save — including saves that only touched the trip's name or
  // dates, with the rounds array just being resubmitted unchanged. Since a new
  // INSERT always gets a new id, that silently orphaned every round's id: any
  // round already 'active' (or 'completed') had its holes/scorecards/scores
  // CASCADE DELETEd the moment someone next edited the trip, and any round a
  // client still had cached under its old id would 404 with "Round not found
  // in this trip" the next time Begin Round was attempted. This is the actual
  // root cause of that error — not a lookup bug, a destructive write bug.
  //
  // Fixed: match incoming rounds against existing ones by id. A matching id
  // is UPDATEd in place (same id, same holes/scorecards/scores survive). A
  // round with no matching id is a genuinely new round and gets INSERTed. An
  // existing round whose id is missing from the incoming array is only
  // deleted if it's still 'upcoming' — an 'active' or 'completed' round is
  // never implicitly deleted through this endpoint, full stop.
  const rounds = (body.rounds as Array<{
    id?: string; name: string; course_name?: string; play_date: string
    tee_time?: string; holes?: number; scoring_format?: string
    // Starting Tee — round-level, only ever 1 or 10 (DB CHECK constraint
    // enforces this too, defense in depth). Defaults to 1 when absent
    // so an older client that doesn't yet send this field behaves
    // exactly as before.
    starting_hole_number?: 1 | 10
    // Sprint 9 — see migration 037. Only ever written for a round that is
    // still 'upcoming' — enforced both here (skipping the field entirely
    // in the update payload for a locked round, so the request succeeds
    // rather than tripping the DB lock trigger over an unrelated field
    // like a course-name typo fix) and at the DB level (defense in depth).
    // Corrected model: a round can hold multiple instances of the same
    // competition type, including Powerplay (now just another comp_type
    // here, not a separate rounds column) — each array entry is its own
    // independent competition instance.
    side_comps?: { comp_type: string; hole_number: number }[]
    // Course Library v1 — same "only if still upcoming" guard as side
    // comps, same reasoning: changing the course/tee mid-round would
    // invalidate holes already being scored against. library_holes_
    // snapshot is whatever the wizard already had frozen (either freshly
    // selected, or round-tripped unchanged from the round's own existing
    // values via CourseLibrarySearch's initialSelection) — this route
    // never re-fetches the library itself, so persisting exactly what
    // the client sends can never "silently refresh from the current
    // library": the only way this value changes at all is the organiser
    // explicitly picking a different course/tee in the wizard.
    library_tee_set_id?: string | null
    tee_name?: string | null
    course_rating?: number | null
    slope_rating?: number | null
    library_holes_snapshot?: { hole_number: number; par: number; stroke_index: number | null; distance: number | null; pro_tip?: string | null }[] | null
  }> | undefined)

  if (rounds && rounds.length > 0) {
    const existingRes = await admin
      .from('rounds')
      .select('id, status')
      .eq('trip_id', tripId)

    if (existingRes.error) {
      console.error('[PATCH /api/trips] rounds lookup failed', existingRes.error)
      return NextResponse.json({ error: `Failed to load existing rounds: ${existingRes.error.message}` }, { status: 500 })
    }

    const existingById = new Map<string, { id: string; status: string }>(
      (existingRes.data ?? []).map((r: { id: string; status: string }) => [r.id, r])
    )

    const toUpdate = rounds.filter(r => r.id && existingById.has(r.id))
    const toInsert = rounds.filter(r => !r.id || !existingById.has(r.id))
    const incomingIds = new Set(rounds.map(r => r.id).filter(Boolean))
    // Only ever remove rounds that are both absent from the incoming array
    // AND still upcoming — never an active or completed round.
    const toDelete = [...existingById.values()].filter(r => !incomingIds.has(r.id) && r.status === 'upcoming')

    for (const r of toUpdate) {
      const existingRound = existingById.get(r.id as string)
      const isUpcoming = existingRound?.status === 'upcoming'

      const updatePayload: Record<string, unknown> = {
        name:           r.name || 'Round',
        course_name:    r.course_name || null,
        play_date:      r.play_date,
        tee_time:       r.tee_time || null,
        holes:          r.holes ?? 18,
        scoring_format: r.scoring_format ?? 'stableford',
        // No powerplay_hole_number — Powerplay is a side_comps row now,
        // reconciled below alongside every other competition instance.
      }
      // Course Library snapshot — only touched for a round still
      // 'upcoming', same lock reasoning as Side Comps/Powerplay above.
      // Writing null/undefined-as-null here for a manually-configured
      // round is correct and expected, not a loss of data — a manual
      // round never had a library snapshot to begin with.
      // Starting Tee — same lock reasoning as Side Comps/Course Library
      // below: it determines which physical holes actually get created
      // when the round begins, so changing it once a round is active
      // (holes already exist, scoring may already be underway) would
      // silently invalidate what's already been scored. Same DB-level
      // lock trigger (migration 037) would reject writing a locked
      // round's config regardless; this keeps the request from failing
      // over an unrelated field the same way Side Comps already does.
      if (isUpcoming) {
        updatePayload.starting_hole_number   = r.starting_hole_number ?? 1
        updatePayload.tee_set_source_id      = r.library_tee_set_id ?? null
        updatePayload.tee_name               = r.tee_name ?? null
        updatePayload.course_rating          = r.course_rating ?? null
        updatePayload.slope_rating           = r.slope_rating ?? null
        updatePayload.library_holes_snapshot = r.library_holes_snapshot ?? null
      }

      const { error: updateRoundError } = await admin
        .from('rounds')
        .update(updatePayload)
        .eq('id', r.id as string)
        .eq('trip_id', tripId)

      if (updateRoundError) {
        console.error('[PATCH /api/trips] round update failed', { roundId: r.id, error: updateRoundError })
        return NextResponse.json({ error: `Failed to update round: ${updateRoundError.message}` }, { status: 500 })
      }

      // Side Competitions — only reconciled for a round still 'upcoming'
      // (the DB lock trigger would reject any change otherwise, and
      // there's no reason to let an unrelated field edit — e.g. fixing a
      // course-name typo on a round that's already started — fail the
      // whole request over Side Comp config that isn't even editable
      // on-screen for a locked round). Reconciled as delete-then-insert
      // rather than a granular per-row upsert: a full replace of this
      // round's competition instances is simple and correct, and at most
      // a handful of rows per round in practice. Every configured
      // instance is inserted, not one row per comp_type — a round can
      // legitimately have two NTPs, two Powerplay holes, etc.
      if (isUpcoming) {
        const { error: deleteCompsError } = await admin.from('side_comps').delete().eq('round_id', r.id as string)
        if (deleteCompsError) {
          console.error('[PATCH /api/trips] side_comps clear failed', { roundId: r.id, error: deleteCompsError })
          return NextResponse.json({ error: `Failed to update side competitions: ${deleteCompsError.message}` }, { status: 500 })
        }
        const comps = r.side_comps ?? []
        if (comps.length > 0) {
          const { error: insertCompsError } = await admin.from('side_comps').insert(
            comps.map(c => ({
              trip_id: tripId, round_id: r.id as string,
              name: SIDE_COMP_LABELS[c.comp_type] ?? c.comp_type, comp_type: c.comp_type,
              hole_number: c.hole_number, enabled: true,
            }))
          )
          if (insertCompsError) {
            console.error('[PATCH /api/trips] side_comps insert failed', { roundId: r.id, error: insertCompsError })
            return NextResponse.json({ error: `Failed to update side competitions: ${insertCompsError.message}` }, { status: 500 })
          }
        }
      }
    }

    if (toInsert.length > 0) {
      const insertRows = toInsert.map((r, i) => ({
        trip_id:        tripId,
        name:           r.name || `Round ${i + 1}`,
        course_name:    r.course_name || null,
        play_date:      r.play_date,
        tee_time:       r.tee_time || null,
        holes:          r.holes ?? 18,
        scoring_format: r.scoring_format ?? 'stableford',
        status:         'upcoming',
        starting_hole_number: r.starting_hole_number ?? 1,
        // No powerplay_hole_number — Powerplay is a side_comps row,
        // inserted below with every other competition instance.
        // A brand-new round is always 'upcoming' — safe to write the
        // library snapshot fields directly, same reasoning as
        // powerplay_hole_number used to have before Sprint 9's
        // correction: nothing has locked it yet.
        tee_set_source_id:      r.library_tee_set_id ?? null,
        tee_name:               r.tee_name ?? null,
        course_rating:          r.course_rating ?? null,
        slope_rating:           r.slope_rating ?? null,
        library_holes_snapshot: r.library_holes_snapshot ?? null,
      }))

      const { data: newRounds, error: insertRoundsError } = await admin.from('rounds').insert(insertRows).select('id')
      if (insertRoundsError) {
        console.error('[PATCH /api/trips] rounds insert failed', insertRoundsError)
        return NextResponse.json({ error: `Failed to save rounds: ${insertRoundsError.message}` }, { status: 500 })
      }

      const newSideCompRows = toInsert.flatMap((r, i) => {
        const roundId = newRounds?.[i]?.id
        if (!roundId) return []
        return (r.side_comps ?? []).map(c => ({
          trip_id: tripId, round_id: roundId,
          name: SIDE_COMP_LABELS[c.comp_type] ?? c.comp_type, comp_type: c.comp_type,
          hole_number: c.hole_number, enabled: true,
        }))
      })
      if (newSideCompRows.length > 0) {
        const { error: newCompsError } = await admin.from('side_comps').insert(newSideCompRows)
        if (newCompsError) {
          // Same reasoning as the create-trip route: additive to rounds
          // that already exist correctly, not fatal to the whole request.
          console.error('[PATCH /api/trips] side_comps insert (new rounds) failed', newCompsError)
        }
      }
    }

    if (toDelete.length > 0) {
      const { error: deleteRoundsError } = await admin
        .from('rounds')
        .delete()
        .in('id', toDelete.map(r => r.id))

      if (deleteRoundsError) {
        console.error('[PATCH /api/trips] rounds delete failed', deleteRoundsError)
        return NextResponse.json({ error: `Failed to remove round(s): ${deleteRoundsError.message}` }, { status: 500 })
      }
    }

    const skippedActiveCount = existingRes.data?.filter(
      (r: { id: string; status: string }) => !incomingIds.has(r.id) && r.status !== 'upcoming'
    ).length ?? 0

    console.log('[PATCH /api/trips] rounds reconciled', {
      tripId, updated: toUpdate.length, inserted: toInsert.length, deleted: toDelete.length,
      skippedActiveOrCompleted: skippedActiveCount,
    })
  }

  // Return the actual persisted round rows — direct proof (visible in the
  // Network tab) of what ids exist right after this save, independent of
  // whatever the next page load does.
  const finalRoundsRes = await admin
    .from('rounds')
    .select('id, name, play_date, status')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: true })

  // P0 fix — "trip stays COMPLETE after a new round is added." Mirrors
  // close/route.ts's own one-way live -> completed transition (also
  // derived purely from rounds.status, not a second flag) with the
  // symmetric reverse: a trip currently marked completed, that now has
  // at least one round that ISN'T completed (this request just added
  // one), can no longer honestly be "complete" — it returns to 'live',
  // the same status start/route.ts already uses for "an event with
  // rounds in progress." Never touches a trip that isn't currently
  // 'completed' — draft/open/groups_ready/ready trips are pre-round
  // setup states this has no opinion on, and a genuinely still-live
  // trip is already correctly live. Historical completed rounds are
  // never modified by this — only the trip-level label, derived fresh
  // from current round data every time, exactly as requested.
  const finalRounds = (finalRoundsRes.data ?? []) as { id: string; name: string; play_date: string; status: string }[]
  let revertedToLive = false
  if (finalRounds.length > 0) {
    const tripStatusRes = await admin.from('trips').select('status').eq('id', tripId).maybeSingle()
    const allStillComplete = finalRounds.every(r => r.status === 'completed')
    if (tripStatusRes.data?.status === 'completed' && !allStillComplete) {
      const { error: revertError } = await admin.from('trips').update({ status: 'live' }).eq('id', tripId)
      if (revertError) {
        console.error('[PATCH /api/trips] completed -> live lifecycle revert failed', revertError)
      } else {
        revertedToLive = true
        console.log('[PATCH /api/trips] trip lifecycle reverted completed -> live (new round added after completion)', { tripId })
      }
    }
  }

  return NextResponse.json({ tripId, ok: true, rounds: finalRounds, revertedToLive })
}


// DELETE /api/trips/[tripId] — permanently delete a trip (organiser only)
// Removes trip + all cascading data: trip_members, rounds, groups, scores, etc.
// All FK constraints have ON DELETE CASCADE so deleting the trip row is sufficient.
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify organiser
  const tripRes = await admin.from('trips').select('organiser_id, name').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Delete the trip — all related data cascades via FK ON DELETE CASCADE:
  // trip_members, rounds, trip_groups, scorecards, score_entries, side_comps, etc.
  const { error: deleteError } = await admin.from('trips').delete().eq('id', tripId)

  if (deleteError) {
    console.error('[DELETE /api/trips] failed', { tripId, error: deleteError.message })
    return NextResponse.json({ error: 'Failed to delete trip. Please try again.' }, { status: 500 })
  }

  console.log('[DELETE /api/trips] deleted', { tripId, name: tripRes.data.name, userId: user.id })
  return NextResponse.json({ ok: true })
}
