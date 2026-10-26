// Package 2 -- the ONE place player-facing reads decide between the released snapshot and live (editable) data.
//
// Rule: while a round is still `upcoming` and has been released at least once (release_revision > 0 and snapshot
// rows exist), players see ONLY the released snapshot. The organiser's unpublished edits live in trip_members /
// trip_groups / round_group_* and are never shown to players until Confirm & Re-release writes a new snapshot.
// Once the round starts, begin_round() snapshots group + handicap onto scorecards and those take over.
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ArrangementRow } from '@/lib/rounds/arrangements'

type Admin = ReturnType<typeof createAdminClient>

/** Released rows for an upcoming round, or null when players should fall back to the existing behaviour
 *  (never released / legacy release without a snapshot / round already started / migration 101 not applied). */
export async function loadPublishedRows(admin: Admin, roundId: string): Promise<ArrangementRow[] | null> {
  const roundRes = await admin.from('rounds').select('status, release_revision').eq('id', roundId).maybeSingle()
  if (roundRes.error || !roundRes.data) return null
  const { status, release_revision } = roundRes.data as { status: string; release_revision: number | null }
  if (status !== 'upcoming' || !release_revision || release_revision < 1) return null
  const rowsRes = await admin.from('round_arrangements').select('player_id, group_id, group_name, tee_time, starting_hole, playing_handicap').eq('round_id', roundId)
  if (rowsRes.error) return null
  const rows = (rowsRes.data ?? []) as ArrangementRow[]
  return rows.length > 0 ? rows : null
}

/** Per-group tee time from the snapshot (all members of a group share one). */
export function publishedTeeTimes(rows: ArrangementRow[]): { group_id: string; tee_time: string | null }[] {
  const seen = new Map<string, string | null>()
  for (const r of rows) if (!seen.has(r.group_id)) seen.set(r.group_id, r.tee_time)
  return [...seen].map(([group_id, tee_time]) => ({ group_id, tee_time }))
}

export function publishedStartingHoles(rows: ArrangementRow[]): { group_id: string; starting_hole: number }[] {
  const seen = new Map<string, number>()
  for (const r of rows) if (!seen.has(r.group_id)) seen.set(r.group_id, r.starting_hole)
  return [...seen].map(([group_id, starting_hole]) => ({ group_id, starting_hole }))
}
