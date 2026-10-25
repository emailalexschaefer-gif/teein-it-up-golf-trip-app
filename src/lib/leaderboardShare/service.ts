/**
 * SERVER ONLY. Link management and board building for the public leaderboard,
 * with the Supabase admin client injected so the behaviour is unit tested
 * against an in-memory store. Every caller (route / page) performs its own
 * authentication and role check first.
 */
import { generateShareToken } from '@/lib/sharing/token'
import { isPlausibleShareToken } from '@/lib/sharing/tokenShape'
import { computeRoundLeaderboard } from '@/lib/scoring/roundLeaderboard'
import { getRoundDisplayName, selectLeaderboardRound, sortRoundsChronologically } from '@/lib/scoring/multiRound'
import { buildPublicBoard, type PublicBoard } from './publicBoard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export const leaderboardPath = (token: string): string => `/l/${token}`

export async function getActiveLink(admin: Admin, tripId: string): Promise<{ token: string } | null> {
  const { data } = await admin.from('shared_leaderboards').select('token').eq('trip_id', tripId).eq('status', 'active').maybeSingle()
  return data?.token ? { token: data.token as string } : null
}

/** Idempotent: returns the existing active link, or creates one. Race-safe via the one-active-per-event unique index. */
export async function enableSharing(admin: Admin, p: { tripId: string; userId: string }): Promise<{ token: string; created: boolean } | null> {
  const existing = await getActiveLink(admin, p.tripId)
  if (existing) return { token: existing.token, created: false }
  const token = generateShareToken()
  const ins = await admin.from('shared_leaderboards').insert({ trip_id: p.tripId, token, status: 'active', created_by: p.userId })
  if (ins.error) {
    if (ins.error.code === '23505') {
      const again = await getActiveLink(admin, p.tripId)
      if (again) return { token: again.token, created: false }
    }
    console.error('[share-leaderboard] enable failed', { code: ins.error.code, tripId: p.tripId })
    return null
  }
  return { token, created: true }
}

/** Revokes the active link. The old token can never be reactivated. */
export async function revokeSharing(admin: Admin, p: { tripId: string; userId: string }): Promise<boolean> {
  const upd = await admin.from('shared_leaderboards')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: p.userId })
    .eq('trip_id', p.tripId).eq('status', 'active').select('id')
  if (upd.error) {
    console.error('[share-leaderboard] revoke failed', { code: upd.error.code, tripId: p.tripId })
    return false
  }
  return true
}

/** Public token -> trip id. Malformed, unknown and revoked tokens all return null (indistinguishable). */
export async function resolveToken(admin: Admin, token: string): Promise<string | null> {
  if (!isPlausibleShareToken(token)) return null
  const { data } = await admin.from('shared_leaderboards').select('trip_id').eq('token', token).eq('status', 'active').maybeSingle()
  return (data?.trip_id as string | undefined) ?? null
}

interface RoundRow { id: string; name: string; status: string; play_date: string; created_at: string; holes: number | null; scoring_format: string | null; starting_hole_number: number | null }

/**
 * Builds the public board for an event from the SAME canonical computation the
 * app's own leaderboard uses. Returns null for a missing or practice event.
 * Throws on a computation failure so callers can answer 500 (never a wrong board).
 */
export async function buildBoardForTrip(admin: Admin, tripId: string, now: Date = new Date()): Promise<PublicBoard | null> {
  const [tripRes, roundsRes] = await Promise.all([
    admin.from('trips').select('id, name, status, is_practice').eq('id', tripId).maybeSingle(),
    admin.from('rounds').select('id, name, status, play_date, created_at, holes, scoring_format, starting_hole_number').eq('trip_id', tripId),
  ])
  const trip = tripRes.data as { id: string; name: string; status: string; is_practice: boolean | null } | null
  if (!trip || trip.is_practice === true) return null

  const counted = ((roundsRes.data ?? []) as RoundRow[]).filter(r => r.status !== 'cancelled')
  const chronological = sortRoundsChronologically(counted)
  const selectedRound = selectLeaderboardRound(counted)
  const completedRoundCount = counted.filter(r => r.status === 'completed').length

  if (!selectedRound || selectedRound.status === 'upcoming') {
    return buildPublicBoard({ eventName: trip.name, tripStatus: trip.status, selected: null, payload: null, completedRoundCount, now })
  }

  const result = await computeRoundLeaderboard(admin, {
    tripId, roundId: selectedRound.id,
    roundRow: { name: selectedRound.name, holes: selectedRound.holes, scoring_format: selectedRound.scoring_format, starting_hole_number: selectedRound.starting_hole_number },
    viewerId: null,
  })
  if (!result.ok) throw new Error(`leaderboard computation failed (${result.status})`)

  return buildPublicBoard({
    eventName: trip.name, tripStatus: trip.status,
    selected: { status: selectedRound.status, label: getRoundDisplayName(selectedRound, chronological) },
    payload: result.body, completedRoundCount, now,
  })
}
