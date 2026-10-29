// M0 (Package 4): GOLDEN regression cases for the existing individual Stableford behaviour.
// These CHARACTERISE what V7 does today -- they are not a claim that every value is correct golf.
// If a later change makes golden.test.ts fail, the change altered existing Stableford behaviour: stop and review.
// Regenerate the fixture ONLY on purpose: `tsx src/lib/scoring/golden/generate.ts` (never automatically).
import { calculateStableford } from '../stableford'
import { getHandicapStrokesForHole } from '../strokeAllocation'
import { computeCumulativeStandings, determineRoundWinners, determineRoundStandings, determineChampions, type RoundPlayerResult } from '../multiRound'
import { decideScoreWrite } from '../scoreWriteDecision'
import { isCaptureAllowed } from '../captureMode'
import { compareCaptures, type CaptureValue } from '../comparison'
import { calculateTeamHandicap } from '../teamHandicap'
import { numberRounds } from '@/lib/trips/roundNumbering'
import { limitToTopFive } from '@/lib/trips/topFive'
import { summariseRoundPlay } from '@/lib/trips/roundPlay'

function attempt<T>(f: () => T): T | { error: string } {
  try { return f() } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}

export function computeGolden() {
  // 1. Stableford points grid, 18-hole allocation (what the database trigger and the live scoring screen use).
  const stableford: Record<string, unknown> = {}
  for (const hcp of [-3, 0, 9, 18, 28, 36, 40]) for (const si of [1, 5, 9, 10, 18]) for (const par of [3, 4, 5]) {
    const row: unknown[] = []
    for (let g = 1; g <= 10; g++) row.push(attempt(() => calculateStableford({ grossScore: g, par, strokeIndex: si, playingHandicap: hcp })))
    stableford[`h${hcp}_si${si}_p${par}`] = row
  }
  // 2. Powerplay doubling and an explicit nine-hole allocation (TS only; the DB trigger has no nine-hole input).
  const powerplay = [3, 4, 5, 6].map(g => calculateStableford({ grossScore: g, par: 4, strokeIndex: 7, playingHandicap: 12, isPowerplayHole: true }))
  const nine: Record<string, unknown> = {}
  for (const hcp of [0, 5, 9, 14, 18]) for (const si of [1, 5, 9, 10]) {
    nine[`h${hcp}_si${si}`] = attempt(() => getHandicapStrokesForHole({ playingHandicap: hcp, strokeIndex: si, holesInRound: 9 }))
  }
  const strokes18: Record<string, number> = {}
  for (const hcp of [-2, 0, 10, 24, 36, 40]) for (let si = 1; si <= 18; si++) strokes18[`h${hcp}_si${si}`] = getHandicapStrokesForHole({ playingHandicap: hcp, strokeIndex: si })

  // 3. Multi-round standings, ties and countback.
  const r = (playerId: string, roundPoints: number, holePoints: number[]): RoundPlayerResult => ({ playerId, playerName: playerId.toUpperCase(), roundPoints, holePoints })
  const round1 = [r('a', 36, [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]), r('b', 36, [3,1,3,1,3,1,3,1,3,1,3,1,3,1,3,1,3,1]), r('c', 30, []), r('d', 30, [])]
  const round2 = [r('a', 30, [1,1,1,1,1,1,1,1,1,3,3,3,3,3,3,0,0,0]), r('b', 30, [1,1,1,1,1,1,1,1,1,0,0,0,3,3,3,3,3,3]), r('c', 36, []), r('e', 20, [])]
  const standings = computeCumulativeStandings([round1, round2])
  const roundWinners = determineRoundWinners(round1)
  const roundStandings = determineRoundStandings([...round1, r('f', 25, []), r('g', 24, []), r('h', 23, []), r('i', 22, [])], 5)
  const champions = determineChampions(standings)

  // 4. Score write decisions.
  const base = { id: 'row', client_id: 'c1', entered_at: '2026-10-26T01:00:00.000Z', gross_score: 4, is_no_return: false }
  const inc = (cid: string, at: string, g: number | null, nr = false) => ({ client_id: cid, entered_at: at, gross_score: g, is_no_return: nr })
  const decisions = [
    decideScoreWrite(null, inc('c1', '2026-10-26T01:00:00.000Z', 4)),
    decideScoreWrite(base, inc('c1', '2026-10-26T01:00:00.000Z', 4)),
    decideScoreWrite(base, inc('c2', '2026-10-26T00:59:00.000Z', 5)),
    decideScoreWrite(base, inc('c2', '2026-10-26T01:01:00.000Z', 5)),
    decideScoreWrite({ ...base, admin_overridden: true }, inc('c2', '2026-10-26T09:00:00.000Z', 5)),
    decideScoreWrite({ ...base, entered_at: null }, inc('c2', '2026-10-26T01:01:00.000Z', 5)),
  ].map(d => d.action)

  // 5. Capture permissions, full matrix.
  const capture: Record<string, boolean> = {}
  for (const mode of ['self_and_marker', 'group_scorer', 'individual'] as const) for (const role of ['self', 'marker'] as const)
    for (const isOwnCard of [true, false]) for (const isOrganiser of [true, false]) for (const isSamePlayingGroup of [true, false]) for (const isAssignedMarker of [true, false])
      capture[`${mode}|${role}|own${+isOwnCard}|org${+isOrganiser}|grp${+isSamePlayingGroup}|mk${+isAssignedMarker}`] = isCaptureAllowed({ mode, captureRole: role, isOwnCard, isOrganiser, isSamePlayingGroup, isAssignedMarker })

  // 6. Self/marker comparison.
  const cv = (g: number | null, p = false, o = false): CaptureValue => ({ grossScore: g, pickedUp: p, adminOverridden: o })
  const comparison = [
    compareCaptures(null, null), compareCaptures(cv(4), null), compareCaptures(null, cv(4)), compareCaptures(cv(4), cv(4)), compareCaptures(cv(4), cv(5)),
    compareCaptures(cv(null, true), cv(null, true)), compareCaptures(cv(null, true), cv(5)), compareCaptures(cv(4, false, true), cv(5)),
  ]

  // 7. Existing (unverified) team handicap behaviour, frozen as-is.
  const teamHandicap = [
    calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [10, 20] }).finalHandicap,
    calculateTeamHandicap({ format: 'four_player_ambrose', playerHandicaps: [8, 12, 18, 22] }).finalHandicap,
    calculateTeamHandicap({ format: 'alternate_shot', playerHandicaps: [10, 20] }).finalHandicap,
    attempt(() => calculateTeamHandicap({ format: 'four_player_ambrose', playerHandicaps: [8, 12, 18] })),
  ]

  // 8. Round numbering, Top 5 and played-round detection (V6/V7 behaviours that Package 4 must not disturb).
  const rounds = [
    { id: 'r3', play_date: '2026-10-26', created_at: '2026-10-20T00:00:00Z', name: 'Round 2', status: 'completed' },
    { id: 'r1', play_date: '2026-10-24', created_at: '2026-10-20T00:00:00Z', name: 'Round 1', status: 'completed' },
    { id: 'r2', play_date: '2026-10-25', created_at: '2026-10-20T00:00:00Z', name: 'Round 2', status: 'cancelled' },
  ]
  const numbering = Object.fromEntries(numberRounds(rounds))
  const topFive = limitToTopFive([{ position: 1 }, { position: 2 }, { position: 3 }, { position: 4 }, { position: 4 }, { position: 4 }, { position: 7 }] as never)
  const roundPlay = [
    summariseRoundPlay([]).hasRecordedScores,
    summariseRoundPlay([{ playerId: 'a', playerName: 'A', entries: [{ stableford_pts: 0, capture_role: 'self' }] }]).hasRecordedScores,
    summariseRoundPlay([{ playerId: 'a', playerName: 'A', entries: [{ stableford_pts: 3, capture_role: 'marker' }] }]).hasRecordedScores,
  ]

  return { stableford, powerplay, nine, strokes18, standings, roundWinners, roundStandings, champions, decisions, capture, comparison, teamHandicap, numbering, topFive, roundPlay }
}
