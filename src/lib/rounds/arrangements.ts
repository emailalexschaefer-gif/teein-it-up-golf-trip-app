// Package 2 -- between-round arrangements. Pure, framework-free helpers shared by the release
// route, the player endpoint and the tests. The snapshot (round_arrangements) is the ONE
// authoritative source of what players were told for a round; nothing here recomputes it later.
import { calculateDailyHandicap } from '@/lib/scoring/dailyHandicap'
import { resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'
import { roundHandicap } from '@/lib/scoring/rounding'

/**
 * Technical limit only (NOT a golf rule): the signed 32-bit range of scorecards.playing_handicap, the column the
 * released value is ultimately stored in. Plus handicaps are negative numbers (+2 is stored as -2). Nothing narrower
 * is imposed: a Course/Daily Handicap legitimately exceeds the 54 Handicap Index ceiling (e.g. 54 x 155 / 113 = 74)
 * and plus handicaps run below -10 once the slope is applied, and the scorecard column itself has no golf range.
 */
export const ROUND_HANDICAP_TECHNICAL_LIMIT = 2147483647
export interface ArrangementRow {
  player_id: string
  group_id: string
  group_name: string | null
  tee_time: string | null
  starting_hole: number | null
  playing_handicap: number
}

export type ChangeKind = 'group' | 'tee_time' | 'starting_hole' | 'handicap' | 'partners' | 'new'
export interface PlayerChange { player_id: string; changes: ChangeKind[] }

export function isValidRoundHandicap(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= ROUND_HANDICAP_TECHNICAL_LIMIT
}

/**
 * The ONE place a round's playing handicap is resolved from raw inputs (used by Release and, for rounds that were
 * never released, by Start Round): explicit organiser allocation, else Daily Handicap from the round's slope,
 * else the player's resolved GA handicap. Always a whole number.
 */
export function resolveRoundHandicap(input: {
  override?: number | null
  tripHandicap: number | null | undefined
  profileHandicap: number | null | undefined
  slopeRating: number | null | undefined
}): number | null {
  if (input.override !== undefined && input.override !== null) return roundHandicap(input.override)
  const ga = resolvePlayingHandicap(input.tripHandicap, input.profileHandicap)
  if (ga === null) return null
  if (input.slopeRating != null) {
    try { return calculateDailyHandicap({ gaHandicap: ga, slopeRating: input.slopeRating }) } catch { /* fall through to GA */ }
  }
  return ga
}

const sortKey = (r: ArrangementRow) => r.player_id
export function sortRows(rows: ArrangementRow[]): ArrangementRow[] { return [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b))) }

/** Per-player differences between two snapshots. A player present only in `next` is 'new'; only in `prev` is simply gone (not notified). */
export function diffArrangements(prev: ArrangementRow[], next: ArrangementRow[]): PlayerChange[] {
  const p = new Map(prev.map(r => [r.player_id, r]))
  const partners = (rows: ArrangementRow[], r: ArrangementRow) => rows.filter(o => o.group_id === r.group_id && o.player_id !== r.player_id).map(o => o.player_id).sort().join(',')
  const out: PlayerChange[] = []
  for (const n of next) {
    const o = p.get(n.player_id)
    if (!o) { out.push({ player_id: n.player_id, changes: ['new'] }); continue }
    const changes: ChangeKind[] = []
    if (o.group_id !== n.group_id) changes.push('group')
    if ((o.tee_time ?? null) !== (n.tee_time ?? null)) changes.push('tee_time')
    if ((o.starting_hole ?? null) !== (n.starting_hole ?? null)) changes.push('starting_hole')
    if (o.playing_handicap !== n.playing_handicap) changes.push('handicap')
    if (!changes.includes('group') && partners(prev, o) !== partners(next, n)) changes.push('partners')
    if (changes.length) out.push({ player_id: n.player_id, changes })
  }
  return out
}

export function sameArrangements(prev: ArrangementRow[], next: ArrangementRow[]): boolean {
  return prev.length === next.length && diffArrangements(prev, next).length === 0
    && next.every(n => prev.some(o => o.player_id === n.player_id))
}

export interface ReleaseMessage {
  message_type: 'announcement' | 'player_notification'
  recipient_type: 'all' | 'player'
  recipient_user_id: string | null
  message: string
}

/** Exact wording approved in the brief for the first release. One event-wide announcement; nothing per player. */
export function initialReleaseMessage(roundName: string): ReleaseMessage {
  return {
    message_type: 'announcement', recipient_type: 'all', recipient_user_id: null,
    message: `⛳ ${roundName} arrangements are ready!\n\nYour playing group, tee time and updated playing handicap are now available.\n\nView your arrangements in the Event Lobby.`,
  }
}

const WHAT: Record<ChangeKind, string> = {
  group: 'playing group', tee_time: 'tee time', starting_hole: 'starting hole', handicap: 'playing handicap',
  partners: 'playing partners', new: 'arrangements',
}
/** Re-release: one short message per AFFECTED player only (never to unaffected players). */
export function revisionMessages(roundName: string, changes: PlayerChange[]): ReleaseMessage[] {
  return changes.map(c => {
    const list = c.changes.filter(k => k !== 'new').map(k => WHAT[k])
    const what = list.length === 0 ? 'arrangements' : list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
    return {
      message_type: 'player_notification', recipient_type: 'player', recipient_user_id: c.player_id,
      message: `⛳ Your ${roundName} ${what} ${list.length > 1 || c.changes.includes('new') ? 'have' : 'has'} been updated.\n\nView your updated arrangements in the Event Lobby.`,
    }
  })
}

/** Does the live setup still equal what players were last shown? (for the organiser's "unreleased changes" notice) */
export function pendingChanges(snapshot: ArrangementRow[], live: ArrangementRow[]): PlayerChange[] {
  return diffArrangements(snapshot, live)
}
