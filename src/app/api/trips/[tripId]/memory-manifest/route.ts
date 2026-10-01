import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

const SIDE_COMP_LABEL: Record<string, string> = {
  nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach", powerplay: 'Powerplay',
}

/**
 * GET /api/trips/[tripId]/memory-manifest
 *
 * Event Memories V1 (10 Sep), Part 11 -- the Event Memory Manifest.
 * One reusable, structured read of "the complete story of this event,"
 * assembled entirely from canonical, already-existing data -- never a
 * second calculation of anything a system already computes. This is
 * the piece every future media generator (Event Story, poster,
 * slideshow, charity recap) should read from, so none of them ever
 * need to reconstruct the event from ten different tables themselves.
 *
 * PER PART 12 ("do not duplicate business logic"), sourced by reading,
 * not recomputing:
 *   - Side Game winners: side_comps.official_winner_entry_id, set
 *     once by finalize_side_comp_winners() at round close (migration
 *     080) -- read directly, joined to the winning player's name via
 *     a second, explicit query (not an assumed FK-hint join name,
 *     which cannot be verified against a live schema cache here).
 *   - Makers & Breakers / Highlights: published_round_highlights,
 *     the organiser's own published selection -- read directly, never
 *     regenerated.
 *   - Rounds/Memories/players: read directly from rounds/moments/
 *     profiles.
 *
 * DEFERRED, honestly, rather than duplicated or guessed at: Champion/
 * final standings. Computing this correctly requires the same
 * multi-round countback logic final-results/route.ts already has
 * (shotgun starts, per-hole play order, group starting holes) --
 * genuinely complex, and re-implementing it here risked either
 * duplicating that logic (exactly what Part 12 warns against) or
 * introducing a second, subtly different champion calculation that
 * could diverge from the canonical one. Extracting that route's logic
 * into a shared function both routes can call is the right next step,
 * not attempted this session to avoid destabilising a complex, working
 * route under time pressure. `results.champion` is present in the
 * response shape (so consumers don't need a breaking change later) but
 * is `null` in this version -- callers needing the champion today
 * should call the existing GET /api/trips/[tripId]/final-results route
 * directly.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Permissions (Part 17) -- trip membership, not organiser-only: any
  // participant may read the manifest (the same rule final-results
  // already uses for viewing results), matching "players should
  // continue seeing their existing Moments" -- reading the manifest
  // is not the same as managing Event Memories (favouriting/
  // downloading remain organiser actions, enforced in their own
  // routes below).
  const memberRes = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberRes.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const tripRes = await admin.from('trips').select('id, name, event_type, location, start_date, end_date, status, organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })

  const roundsRes = await admin.from('rounds')
    .select('id, name, course_name, play_date, status, holes')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: true })
  const rounds = roundsRes.data ?? []
  const roundIds = rounds.map((r: { id: string }) => r.id)

  // Memories -- the canonical moments rows themselves, each read once
  // (Part 1's "one canonical underlying record" requirement) --
  // confirmed this query never joins in a way that could return the
  // same moment more than once (a single SELECT against moments,
  // scoped to trip_id, no fan-out join).
  const momentsRes = await admin.from('moments')
    .select('id, round_id, hole_number, player_id, caption, image_path, audience, created_at, is_event_favourite, profiles:player_id(full_name)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  const moments = momentsRes.data ?? []

  // Side Game winners -- read directly from the already-persisted
  // official result (migration 080), never recomputed. The winning
  // player is looked up via a second, explicit query keyed by
  // official_winner_entry_id -- avoids relying on an assumed foreign-
  // key constraint name for an embedded join.
  const sideCompsRes = roundIds.length > 0
    ? await admin.from('side_comps').select('id, round_id, comp_type, hole_number, official_winner_entry_id').in('round_id', roundIds)
    : { data: [] }
  interface SideCompRow { id: string; round_id: string; comp_type: string; hole_number: number | null; official_winner_entry_id: string | null }
  const sideComps = (sideCompsRes.data ?? []) as SideCompRow[]
  const winnerEntryIds = sideComps.map(sc => sc.official_winner_entry_id).filter((id): id is string => id !== null)

  const winningEntriesRes = winnerEntryIds.length > 0
    ? await admin.from('side_comp_entries').select('id, player_id').in('id', winnerEntryIds)
    : { data: [] }
  const playerIdByEntryId = new Map(((winningEntriesRes.data ?? []) as { id: string; player_id: string }[]).map(e => [e.id, e.player_id]))
  const winnerPlayerIds = [...new Set([...playerIdByEntryId.values()])]
  const winnerProfilesRes = winnerPlayerIds.length > 0
    ? await admin.from('profiles').select('id, full_name').in('id', winnerPlayerIds)
    : { data: [] }
  const nameByPlayerId = new Map(((winnerProfilesRes.data ?? []) as { id: string; full_name: string }[]).map(p => [p.id, p.full_name]))

  const sideGameWinners = sideComps
    .filter(sc => sc.official_winner_entry_id !== null)
    .map(sc => {
      const playerId = playerIdByEntryId.get(sc.official_winner_entry_id as string) ?? null
      return {
        sideCompId: sc.id, roundId: sc.round_id,
        compType: sc.comp_type, label: SIDE_COMP_LABEL[sc.comp_type] ?? sc.comp_type,
        holeNumber: sc.hole_number,
        winnerPlayerId: playerId,
        winnerName: playerId ? nameByPlayerId.get(playerId) ?? null : null,
      }
    })

  // Makers & Breakers / Highlights -- the organiser's own published
  // selection, read directly, never regenerated from raw scores here.
  const highlightsRes = roundIds.length > 0
    ? await admin.from('published_round_highlights').select('round_id, highlights, published_at').in('round_id', roundIds)
    : { data: [] }
  const highlightsByRoundId = new Map(
    ((highlightsRes.data ?? []) as { round_id: string; highlights: unknown; published_at: string }[])
      .map(h => [h.round_id, h])
  )

  // Signed URLs for the grid -- one batch call for every Memory,
  // never one round-trip per photo (Part 20 performance: a 500-photo
  // event must not mean 500 sequential signed-URL requests). Supabase
  // Storage's own createSignedUrls (plural) accepts the full path
  // list in a single call.
  const imagePaths = moments.map((m: { image_path: string }) => m.image_path)
  const signedUrlsRes = imagePaths.length > 0
    ? await admin.storage.from('event-moments').createSignedUrls(imagePaths, 3600)
    : { data: [] }
  const signedUrlByPath = new Map(
    ((signedUrlsRes.data ?? []) as { path: string | null; signedUrl: string }[])
      .filter((r): r is { path: string; signedUrl: string } => r.path !== null)
      .map(r => [r.path, r.signedUrl])
  )

  return NextResponse.json({
    event: {
      id: tripRes.data.id, name: tripRes.data.name, eventType: tripRes.data.event_type,
      location: tripRes.data.location, startDate: tripRes.data.start_date, endDate: tripRes.data.end_date,
      status: tripRes.data.status,
    },
    rounds: rounds.map((r: { id: string; name: string; course_name: string | null; play_date: string; status: string; holes: number }) => ({
      id: r.id, name: r.name, courseName: r.course_name, playDate: r.play_date, status: r.status, holes: r.holes,
      publishedHighlights: highlightsByRoundId.get(r.id)?.highlights ?? null,
    })),
    memories: moments.map((m: {
      id: string; round_id: string | null; hole_number: number | null; player_id: string
      caption: string | null; image_path: string; audience: string; created_at: string
      is_event_favourite: boolean; profiles: { full_name: string } | null
    }) => ({
      momentId: m.id, roundId: m.round_id, holeNumber: m.hole_number,
      playerId: m.player_id, playerName: m.profiles?.full_name ?? null,
      caption: m.caption, imagePath: m.image_path, imageUrl: signedUrlByPath.get(m.image_path) ?? null, audience: m.audience,
      createdAt: m.created_at, organiserFavourite: m.is_event_favourite,
    })),
    sideGameWinners,
    results: {
      // Deferred -- see the file-level comment above.
      champion: null,
    },
  })
}
