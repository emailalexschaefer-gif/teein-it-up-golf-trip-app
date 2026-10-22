// The scenarios every optimised read route is checked against. The same
// scenarios produced the committed goldens from the ORIGINAL (sequential)
// routes, so a passing test means the optimised route returns byte-for-byte
// the same status and body for each of them.
import { buildTables, IDS } from './fixtures'
import type { FailRule, Row } from './fakeDb'

export interface Scenario {
  name: string
  params: { tripId: string; roundId: string }
  user: { id: string } | null
  mutate?: (t: Record<string, Row[]>) => void
  failRules?: FailRule[]
  fail?: Record<string, 'error' | 'throw'>
}

const T = IDS.trip
const on = (roundId: string) => ({ tripId: T, roundId })
const forRound = (id: string) => (f: string[]) => f.some(x => x === `eq:round_id=${JSON.stringify(id)}`)

export const MY_SCORES_SCENARIOS: Scenario[] = [
  { name: 'player p1, active round', params: on(IDS.r2), user: { id: IDS.p1 } },
  { name: 'player p2 (marker pair)', params: on(IDS.r2), user: { id: IDS.p2 } },
  { name: 'shared-device digital player p3 with paper partner p4', params: on(IDS.r2), user: { id: IDS.p3 } },
  { name: 'solo player with no group', params: on(IDS.r2), user: { id: IDS.solo } },
  { name: 'organiser whose own card is withdrawn', params: on(IDS.r2), user: { id: IDS.org } },
  { name: 'completed round as p1', params: on(IDS.r1), user: { id: IDS.p1 } },
  { name: 'not signed in -> 401', params: on(IDS.r2), user: null },
  { name: 'non-member of the event -> 403', params: on(IDS.r2), user: { id: IDS.stranger } },
  { name: "round belongs to another event -> 404", params: on(IDS.rOther), user: { id: IDS.p1 } },
  { name: 'group_scorer round -> 400', params: on(IDS.rGroupScorer), user: { id: IDS.p1 } },
  { name: 'scorecards query error -> 500', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { scorecards: 'error' } },
  { name: 'member lookup error -> 403', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { trip_members: 'error' } },
  { name: 'markers lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { round_markers: 'error' } },
  { name: 'override-audit lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { score_override_audit: 'error' } },
  { name: 'network failure on scorecards escapes the handler', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { scorecards: 'throw' } },
  { name: 'network failure on audit escapes the handler', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { score_override_audit: 'throw' } },
  { name: 'round without markers (no round_markers rows)', params: on(IDS.r2), user: { id: IDS.p1 }, mutate: t => { t.round_markers = [] } },
  { name: 'round in individual (non-marker) capture mode', params: on(IDS.r2), user: { id: IDS.p1 }, mutate: t => { (t.rounds.find(r => r.id === IDS.r2) as Row).score_capture_mode = 'individual' } },
]

export const LEADERBOARD_SCENARIOS: Scenario[] = [
  { name: 'p1 on active round 2 (cumulative with round 1)', params: on(IDS.r2), user: { id: IDS.p1 } },
  { name: 'p3 on active round 2', params: on(IDS.r2), user: { id: IDS.p3 } },
  { name: 'organiser on round 1 (single round)', params: on(IDS.r1), user: { id: IDS.org } },
  { name: 'not signed in -> 401', params: on(IDS.r2), user: null },
  { name: 'non-member -> 403', params: on(IDS.r2), user: { id: IDS.stranger } },
  { name: 'practice event -> 200 practice notice', params: { tripId: IDS.practiceTrip, roundId: IDS.r2 }, user: { id: IDS.p1 } },
  { name: 'unknown round -> 404', params: on('nope'), user: { id: IDS.p1 } },
  { name: 'round from another event -> 404', params: on(IDS.rOther), user: { id: IDS.p1 } },
  { name: 'scorecards error -> 500', params: on(IDS.r2), user: { id: IDS.p1 }, failRules: [{ table: 'scorecards', mode: 'error', when: forRound(IDS.r2) }] },
  { name: 'all-rounds lookup error: core board still returned', params: on(IDS.r2), user: { id: IDS.p1 }, failRules: [{ table: 'rounds', mode: 'error', when: f => f.some(x => x.startsWith('in:status')) }] },
  { name: 'all-rounds lookup network failure: core board still returned', params: on(IDS.r2), user: { id: IDS.p1 }, failRules: [{ table: 'rounds', mode: 'throw', when: f => f.some(x => x.startsWith('in:status')) }] },
  { name: 'prior-round scorecards network failure: core board still returned', params: on(IDS.r2), user: { id: IDS.p1 }, failRules: [{ table: 'scorecards', mode: 'throw', when: forRound(IDS.r1) }] },
  { name: 'prior-round scorecards error -> cumulative empty, board intact', params: on(IDS.r2), user: { id: IDS.p1 }, failRules: [{ table: 'scorecards', mode: 'error', when: forRound(IDS.r1) }] },
  { name: 'holes lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { holes: 'error' } },
  { name: 'holes network failure -> 500 from outer handler', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { holes: 'throw' } },
  { name: 'practice lookup error: treated as not practice', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { trips: 'error' } },
  { name: 'member lookup network failure -> 500', params: on(IDS.r2), user: { id: IDS.p1 }, fail: { trip_members: 'throw' } },
  { name: 'event with no scorecards yet', params: on(IDS.r2), user: { id: IDS.p1 }, mutate: t => { t.scorecards = t.scorecards.filter(c => c.round_id !== IDS.r2) } },
]

export const TOURNAMENT_SCENARIOS: Scenario[] = [
  { name: 'organiser on active round 2 (side comps, moment image)', params: on(IDS.r2), user: { id: IDS.org } },
  { name: 'organiser on completed round 1', params: on(IDS.r1), user: { id: IDS.org } },
  { name: 'player (not organiser) -> 403', params: on(IDS.r2), user: { id: IDS.p1 } },
  { name: 'not signed in -> 401', params: on(IDS.r2), user: null },
  { name: 'unknown round -> 404', params: on('nope'), user: { id: IDS.org } },
  { name: 'scorecards error -> 500', params: on(IDS.r2), user: { id: IDS.org }, fail: { scorecards: 'error' } },
  { name: 'side-comps lookup error: rest of response intact', params: on(IDS.r2), user: { id: IDS.org }, fail: { side_comps: 'error' } },
  { name: 'lead-changes lookup error', params: on(IDS.r2), user: { id: IDS.org }, fail: { side_comp_lead_changes: 'error' } },
  { name: 'side-comp entries network failure is contained', params: on(IDS.r2), user: { id: IDS.org }, fail: { side_comp_entries: 'throw' } },
  { name: 'moment lookup network failure is contained', params: on(IDS.r2), user: { id: IDS.org }, fail: { moments: 'throw' } },
  { name: 'markers lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.org }, fail: { round_markers: 'error' } },
  { name: 'groups lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.org }, fail: { trip_groups: 'error' } },
  { name: 'members lookup error is tolerated', params: on(IDS.r2), user: { id: IDS.org }, failRules: [{ table: 'trip_members', mode: 'error', when: f => !f.some(x => x.startsWith('eq:profile_id')) }] },
  { name: 'no side comps configured', params: on(IDS.r2), user: { id: IDS.org }, mutate: t => { t.side_comps = [] } },
  { name: 'no score entries yet', params: on(IDS.r2), user: { id: IDS.org }, mutate: t => { for (const c of t.scorecards) c.score_entries = [] } },
]

export function tablesFor(s: Scenario): Record<string, Row[]> {
  const t = buildTables()
  s.mutate?.(t)
  return t
}
