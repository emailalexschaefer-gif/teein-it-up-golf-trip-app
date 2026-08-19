/**
 * GET /api/trips/[tripId]/rounds/[roundId]/highlights
 * Makers & Breakers V1 — generates up to 6 maker and 6 breaker
 * candidates from a completed round's actual scoring data.
 *
 * Data fetching deliberately mirrors the leaderboard route's own
 * established pattern (same capture_role='self' filter, same
 * scorecards/score_entries/holes shape) rather than inventing a
 * different query shape for the same underlying data.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateMakersAndBreakers, type FieldRoundData, type PlayerRoundData } from '@/lib/highlights/makersBreakers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

interface ScoreEntryRow { hole_id: string; gross_score: number; stableford_pts: number; capture_role: string }
interface ScorecardRow {
  id: string; player_id: string; group_id: string | null; status: string
  profiles: { full_name: string } | null
  score_entries: ScoreEntryRow[]
}
interface HoleRow { id: string; hole_number: number; par: number }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    // Organiser-only — Makers & Breakers curation is an organiser tool,
    // matching every other My HQ module's access pattern.
    const memberCheck = await admin.from('trip_members').select('role')
      .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
      return NextResponse.json({ error: 'Organiser access required.' }, { status: 403 })
    }

    const roundRes = await admin.from('rounds').select('id, holes, status').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
    if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
    if (roundRes.data.status !== 'completed') {
      // Item 1 — "after a round is fully completed/reconciled." Not a
      // hard architectural requirement of the engine itself (it would
      // happily run on live data), but showing highlights before the
      // round is genuinely finished risks presenting a half-finished
      // "Round Performer" as if it were final.
      return NextResponse.json({ error: 'Round is not yet complete.' }, { status: 409 })
    }
    const totalHoles: number = roundRes.data.holes ?? 18

    const holesRes = await admin.from('holes').select('id, hole_number, par').eq('round_id', roundId)
    const holeById = new Map<string, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h]))

    // Shotgun starting holes, per group — same table Priority items
    // elsewhere in this app already use for the exact same purpose.
    // Defaults to hole 1 (a standard round) when no row exists, which
    // is also correct for non-shotgun rounds where this table is
    // simply empty.
    const startingHolesRes = await admin.from('round_group_starting_holes').select('group_id, starting_hole').eq('round_id', roundId)
    const startingHoleByGroup = new Map<string, number>((startingHolesRes.data ?? []).map((r: { group_id: string; starting_hole: number }) => [r.group_id, r.starting_hole]))

    const { data: scorecards, error: scErr } = await admin
      .from('scorecards')
      .select(`
        id, player_id, group_id, status,
        profiles:player_id ( full_name ),
        score_entries ( hole_id, gross_score, stableford_pts, capture_role )
      `)
      .eq('round_id', roundId)
      .neq('status', 'withdrawn')

    if (scErr) {
      console.error('[highlights]', scErr)
      return NextResponse.json({ error: 'Could not load round data.' }, { status: 500 })
    }

    const players: PlayerRoundData[] = ((scorecards ?? []) as ScorecardRow[]).map(sc => {
      // Same capture_role='self' convention as the leaderboard route —
      // avoids double-counting a hole that has both a self and a marker
      // entry mid-reconciliation.
      const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
      const holes = selfEntries
        .map(e => {
          const hole = holeById.get(e.hole_id)
          if (!hole) return null
          return { holeNumber: hole.hole_number, stablefordPts: e.stableford_pts ?? 0, grossScore: e.gross_score, par: hole.par }
        })
        .filter((h): h is { holeNumber: number; stablefordPts: number; grossScore: number; par: number } => h !== null)

      return {
        playerId: sc.player_id,
        playerName: sc.profiles?.full_name ?? 'Player',
        startingHole: (sc.group_id && startingHoleByGroup.get(sc.group_id)) || 1,
        holes,
      }
    })

    const field: FieldRoundData = { players, totalHoles }
    const { makers, breakers } = generateMakersAndBreakers(field)

    return NextResponse.json({ makers, breakers })
  } catch (err) {
    console.error('[highlights] unexpected error', err)
    return NextResponse.json({ error: 'Could not generate highlights.' }, { status: 500 })
  }
}
