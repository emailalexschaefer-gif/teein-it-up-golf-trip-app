/**
 * POST /api/trips/[tripId]/rounds/[roundId]/release   -- "Confirm & Release" / "Confirm & Re-release"
 * GET  /api/trips/[tripId]/rounds/[roundId]/release   -- organiser: release state + unreleased changes
 *
 * Package 2 (between-round management). Releasing publishes ONE authoritative snapshot of the round's
 * arrangements (group, tee time, starting hole, playing handicap per player) via the transactional
 * release_round_arrangements() function (migration 101), records the in-app announcement in Event Chat,
 * and writes an audit row -- all or nothing. It NEVER changes rounds.status, never creates scorecards,
 * and never touches a player's profile or event-membership handicap. Start Round remains a separate action.
 *
 * Idempotent: releasing identical arrangements again changes nothing and sends nothing.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadLiveArrangements } from '@/lib/rounds/liveArrangements'
import { roundHandicap } from '@/lib/scoring/rounding'
import { diffArrangements, sameArrangements, initialReleaseMessage, revisionMessages, isValidRoundHandicap, type ArrangementRow } from '@/lib/rounds/arrangements'

export const dynamic = 'force-dynamic'
interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

type AdminClient = ReturnType<typeof createAdminClient>

const MIGRATION_MISSING = 'Round release needs a database update (migration 101) that has not been applied yet.'
const isMissingSchema = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || /release_revision|round_arrangements|release_round_arrangements/.test(e.message ?? ''))

async function authorise(tripId: string) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) }
  const admin: AdminClient = createAdminClient()
  const m = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!m.data || m.data.role !== 'organiser') return { error: NextResponse.json({ error: 'Organiser access required.' }, { status: 403 }) }
  return { user, admin }
}

async function loadRound(admin: AdminClient, tripId: string, roundId: string) {
  return admin.from('rounds').select('id, name, status, start_type, starting_hole_number, slope_rating, setup_released, release_revision, released_at').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
}
async function loadSnapshot(admin: AdminClient, roundId: string) {
  const res = await admin.from('round_arrangements').select('player_id, group_id, group_name, tee_time, starting_hole, playing_handicap').eq('round_id', roundId)
  return { rows: (res.data ?? []) as ArrangementRow[], error: res.error }
}

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const auth = await authorise(tripId); if ('error' in auth) return auth.error
  const { admin } = auth
  const roundRes = await loadRound(admin, tripId, roundId)
  if (isMissingSchema(roundRes.error)) return NextResponse.json({ available: false, released: false, revision: 0, snapshot: [], pending: [] })
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const r = roundRes.data
  const snap = await loadSnapshot(admin, roundId)
  if (isMissingSchema(snap.error)) return NextResponse.json({ available: false, released: false, revision: 0, snapshot: [], pending: [] })
  const released = !!r.setup_released && snap.rows.length > 0
  let pending: { player_id: string; changes: string[] }[] = []
  if (released) {
    // Live setup with the released handicaps held fixed, so only genuine edits show up as pending.
    const hold = Object.fromEntries(snap.rows.map(s => [s.player_id, s.playing_handicap]))
    const live = await loadLiveArrangements(admin, tripId, r, hold)
    pending = diffArrangements(snap.rows, live.rows)
  }
  return NextResponse.json({ available: true, released, legacy: !!r.setup_released && !released, revision: r.release_revision ?? 0, releasedAt: r.released_at ?? null, status: r.status, snapshot: snap.rows, pending })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const auth = await authorise(tripId); if ('error' in auth) return auth.error
  const { user, admin } = auth

  const roundRes = await loadRound(admin, tripId, roundId)
  if (isMissingSchema(roundRes.error)) return NextResponse.json({ error: MIGRATION_MISSING, code: 'migration_missing' }, { status: 503 })
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const round = roundRes.data
  if (round.status === 'completed') return NextResponse.json({ error: 'This round has already been completed.' }, { status: 409 })
  if (round.status === 'cancelled') return NextResponse.json({ error: 'This round has been cancelled.' }, { status: 409 })
  if (round.status === 'active') return NextResponse.json({ error: 'This round is already live. Arrangements can no longer be released or changed here.' }, { status: 409 })

  // Optional explicit allocations: the organiser's full, resolved per-player handicaps from Begin Round.
  let allocations: Record<string, number> | undefined
  let announceLegacy = false
  try {
    const body = await req.json().catch(() => ({}))
    announceLegacy = !!(body && typeof body === 'object' && (body as Record<string, unknown>).announceLegacy === true)
    if (body && typeof body === 'object' && body.handicaps && typeof body.handicaps === 'object') {
      allocations = {}
      for (const [pid, v] of Object.entries(body.handicaps as Record<string, unknown>)) {
        if (!isValidRoundHandicap(v)) return NextResponse.json({ error: 'A playing handicap value is not a valid number.' }, { status: 400 })
        allocations[pid] = roundHandicap(v)
      }
    }
  } catch { /* no body: allocations stay computed */ }

  const live = await loadLiveArrangements(admin, tripId, round, allocations)
  if (live.problems.length > 0) {
    // Report exactly what is missing; never insert defaults to satisfy readiness.
    return NextResponse.json({ error: 'Round setup is not yet complete.', problems: live.problems, readiness: live.readiness }, { status: 400 })
  }

  const snap = await loadSnapshot(admin, roundId)
  if (isMissingSchema(snap.error)) return NextResponse.json({ error: MIGRATION_MISSING, code: 'migration_missing' }, { status: 503 })
  const revision = round.release_revision ?? 0
  const wasReleased = !!round.setup_released && revision > 0 && snap.rows.length > 0

  if (wasReleased && sameArrangements(snap.rows, live.rows)) {
    return NextResponse.json({ ok: true, unchanged: true, revision, notified: 0 })
  }

  // Legacy release: released before snapshots existed (setup_released = true, no snapshot). Players have been seeing
  // the live arrangements all along, so converting is SILENT by default -- it records exactly what is set now as the
  // authoritative version and sends nothing, rather than announcing a "new" release for a round everyone already
  // knows about. The organiser can opt in to an announcement with `announceLegacy: true`.
  const legacy = !!round.setup_released && !wasReleased
  const changes = wasReleased ? diffArrangements(snap.rows, live.rows) : []
  const messages = wasReleased
    ? revisionMessages(round.name, changes)
    : (legacy && !announceLegacy ? [] : [initialReleaseMessage(round.name)])
  const rpc = await admin.rpc('release_round_arrangements', {
    p_round_id: roundId, p_actor: user.id, p_expected_revision: revision,
    p_rows: live.rows, p_changes: changes, p_messages: messages,
  })
  if (rpc.error) {
    if (isMissingSchema(rpc.error)) return NextResponse.json({ error: MIGRATION_MISSING, code: 'migration_missing' }, { status: 503 })
    console.error('[release] rpc failed', { roundId, code: rpc.error.code, message: rpc.error.message })
    return NextResponse.json({ error: 'Could not release this round. Nothing was changed. Please try again.' }, { status: 500 })
  }
  const out = rpc.data as { ok: boolean; error?: string; revision?: number }
  if (!out.ok) {
    if (out.error === 'revision_conflict') return NextResponse.json({ error: 'The arrangements were just updated by another release. Refresh and review before releasing again.', code: 'revision_conflict', revision: out.revision }, { status: 409 })
    if (out.error === 'not_upcoming') return NextResponse.json({ error: 'This round is no longer upcoming, so it cannot be released.' }, { status: 409 })
    return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, unchanged: false, legacyConverted: legacy, revision: out.revision, notified: wasReleased ? messages.length : (messages.length > 0 ? live.rows.length : 0) })
}
