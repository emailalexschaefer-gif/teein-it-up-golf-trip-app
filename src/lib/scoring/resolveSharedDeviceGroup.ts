/**
 * P0 follow-up — root cause of "Confirm Final Scores still requires
 * marker entries" (and the same class of bug lurking in every other
 * server-side shared-device check written so far).
 *
 * Every one of close/route.ts, tournament/route.ts, scorecards/route.ts,
 * pending-verifications/route.ts, and verify/route.ts resolved a
 * player's group by reading scorecards.group_id — a per-round snapshot
 * column (migration 035) that begin_round()'s CURRENT live definition
 * (migration 057, inherited unchanged by migration 064's own explicit
 * "identical to 057" comment) never actually writes. Confirmed by
 * reading 057's INSERT INTO scorecards statement directly: it lists
 * (round_id, player_id, playing_handicap, status) only — group_id is
 * absent from both the column list and the ON CONFLICT DO UPDATE SET,
 * even though start/route.ts's caller still faithfully builds and sends
 * it in p_scorecard_data. The column exists and is nullable, so this
 * fails silently: no error, just group_id = NULL forever on every
 * scorecard created by the current RPC.
 *
 * page.tsx's own shared-device detection (Round 1's fix, proven working
 * on real devices) was never affected by this because it was written
 * against a different, reliable source from the start: the LIVE
 * trip_members.group_id (never snapshotted, always current), cross-
 * referenced against this round's scorecards by profile_id membership.
 * This helper is that exact same pattern, extracted so every other
 * call site can share ONE resolution function instead of five
 * independent copies quietly relying on a column that doesn't work.
 *
 * Deliberately does NOT attempt to fix begin_round() itself — that
 * would require applying a new migration against a live database this
 * environment has no credentials or network access to reach, and could
 * not be verified from here. Routing every consumer around the broken
 * column via the one already-proven-correct source is the safer fix
 * available right now. Fixing the migration itself is still worth
 * doing separately (flagged in this round's delivery notes) — until
 * then, scorecards.group_id should not be trusted by any new code
 * either.
 */
export interface GroupScorecardRow {
  player_id: string
  scoring_method: string
}

// Minimal shape needed from an admin Supabase client — avoids importing
// the concrete AdminClient type into a file that's otherwise pure
// data-shape logic, matching the `any`-typed admin client already used
// at every call site in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalAdminClient = any

import { detectSharedDeviceGroup, type SharedDeviceDetectionResult } from './sharedDeviceScoring'

// P0 follow-up trace — every consumer of this function has, at least
// once, turned out to be blocked by something one level deeper than
// isSharedDevice/digitalPlayerId/paperPlayerId alone can explain (first
// scorecards.group_id being silently NULL, discovered only by reading
// begin_round()'s actual INSERT statement — there is no reason to
// assume there isn't a second, still-undiscovered reason the LIVE
// trip_members.group_id path could also fail for a specific production
// pair: a stale/withdrawn scorecard still counted, a third profile
// sharing the same group_id, a scoring_method that isn't exactly
// 'paper'/'digital' as stored, etc. Returning every intermediate value
// (not just the final yes/no) is what lets a still-failing case be
// diagnosed from one server log line instead of another guess-and-ship
// cycle.
export interface SharedDeviceResolutionResult extends SharedDeviceDetectionResult {
  trace: {
    myGroupId: string | null
    groupProfileIds: string[]
    relevantCards: GroupScorecardRow[]
  }
}

/**
 * Resolves whether `playerId` is part of a genuine shared-device pair
 * for this specific round, using their CURRENT trip_members.group_id
 * (not any per-round snapshot) to find their groupmates, then checking
 * this round's own scorecards for those specific profiles.
 */
export async function resolveSharedDeviceGroupForPlayer(
  admin: MinimalAdminClient,
  params: { tripId: string; roundId: string; playerId: string },
): Promise<SharedDeviceResolutionResult> {
  const { tripId, roundId, playerId } = params
  const none = (trace: SharedDeviceResolutionResult['trace']): SharedDeviceResolutionResult =>
    ({ isSharedDevice: false, digitalPlayerId: null, paperPlayerId: null, trace })

  const memberRes = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', playerId).maybeSingle()
  const myGroupId = memberRes.data?.group_id ?? null
  if (!myGroupId) return none({ myGroupId: null, groupProfileIds: [], relevantCards: [] })

  const [groupCardsRes, groupMembersRes] = await Promise.all([
    admin.from('scorecards').select('player_id, scoring_method').eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('trip_members').select('profile_id').eq('trip_id', tripId).eq('group_id', myGroupId),
  ])
  const groupProfileIds = new Set((groupMembersRes.data ?? []).map((m: { profile_id: string }) => m.profile_id))
  const relevantCards = ((groupCardsRes.data ?? []) as GroupScorecardRow[]).filter(c => groupProfileIds.has(c.player_id))
  const trace = { myGroupId, groupProfileIds: [...groupProfileIds], relevantCards }

  const detection = detectSharedDeviceGroup(
    relevantCards.map(c => ({ playerId: c.player_id, scoringMethod: c.scoring_method === 'paper' ? 'paper' as const : 'digital' as const })),
  )
  return { ...detection, trace }
}
