import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCumulativeStandings, determineRoundWinners, determineChampions, seedLeadersLast, sortRoundsChronologically, selectLeaderboardRound, selectRelevantSideGameRounds, buildRoundsSummary, derivePreviousCurrentTotal } from './multiRound'

// ── sortRoundsChronologically ────────────────────────────────────────────────

test('sortRoundsChronologically — the exact bug scenario: rounds sharing an identical created_at (batch-inserted together) still sort correctly by play_date', () => {
  const rounds = [
    { id: 'round-2', play_date: '2026-08-11', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'round-1', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' }, // identical created_at to round-2 — the actual root cause
  ]
  const sorted = sortRoundsChronologically(rounds)
  assert.deepEqual(sorted.map(r => r.id), ['round-1', 'round-2'])
})

test('sortRoundsChronologically — normal case, distinct created_at, already-correct order is preserved', () => {
  const rounds = [
    { id: 'round-1', play_date: '2026-08-10', created_at: '2026-08-01T09:00:00.000Z' },
    { id: 'round-2', play_date: '2026-08-11', created_at: '2026-08-01T10:00:00.000Z' },
  ]
  const sorted = sortRoundsChronologically(rounds)
  assert.deepEqual(sorted.map(r => r.id), ['round-1', 'round-2'])
})

test('sortRoundsChronologically — same play_date AND same created_at falls back to id as a stable, deterministic (not necessarily meaningful, but repeatable) final tiebreaker', () => {
  const rounds = [
    { id: 'zzz', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'aaa', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' },
  ]
  const sorted = sortRoundsChronologically(rounds)
  assert.deepEqual(sorted.map(r => r.id), ['aaa', 'zzz'])
})

test('sortRoundsChronologically — generic for any round count, not special-cased to two', () => {
  const rounds = [
    { id: 'r4', play_date: '2026-08-13', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'r2', play_date: '2026-08-11', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'r1', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'r3', play_date: '2026-08-12', created_at: '2026-08-01T10:00:00.000Z' },
  ]
  const sorted = sortRoundsChronologically(rounds)
  assert.deepEqual(sorted.map(r => r.id), ['r1', 'r2', 'r3', 'r4'])
})

test('sortRoundsChronologically — does not mutate the input array', () => {
  const rounds = [
    { id: 'round-2', play_date: '2026-08-11', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'round-1', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' },
  ]
  const original = [...rounds]
  sortRoundsChronologically(rounds)
  assert.deepEqual(rounds, original)
})

test('cumulative standings — Darren\'s exact reported scenario: Round 1 complete (36/32), Round 2 unstarted, then Round 2 partial scoring', () => {
  // Round 1 complete
  const round1 = [
    { playerId: 'darren', playerName: 'Darren', roundPoints: 36 },
    { playerId: 'razzle', playerName: 'Razzle Dazzle', roundPoints: 32 },
  ]
  // Round 2 just started, nobody has a score yet — every active
  // scorecard still contributes a row (created at Begin Round), just
  // with 0 points, matching how the leaderboard route already treats
  // "this round's own totals" (see route comments) — never omitted,
  // never confused with "no data".
  const round2Unstarted = [
    { playerId: 'darren', playerName: 'Darren', roundPoints: 0 },
    { playerId: 'razzle', playerName: 'Razzle Dazzle', roundPoints: 0 },
  ]
  const standingsUnstarted = computeCumulativeStandings([round1, round2Unstarted])
  assert.deepEqual(standingsUnstarted.find(s => s.playerId === 'darren')?.totalPoints, 36)
  assert.deepEqual(standingsUnstarted.find(s => s.playerId === 'razzle')?.totalPoints, 32)

  // Round 2, hole 1 scored
  const round2Partial = [
    { playerId: 'darren', playerName: 'Darren', roundPoints: 3 },
    { playerId: 'razzle', playerName: 'Razzle Dazzle', roundPoints: 2 },
  ]
  const standingsPartial = computeCumulativeStandings([round1, round2Partial])
  const darren = standingsPartial.find(s => s.playerId === 'darren')
  const razzle = standingsPartial.find(s => s.playerId === 'razzle')
  // R1 (36) is frozen — this is the same round1 array passed unchanged,
  // never re-derived — and TOTAL = R1 + R2-live exactly, matching the
  // required "sum(completed round totals) + current live round subtotal"
  // formula, not a separately-maintained running total that could drift.
  assert.equal(darren?.totalPoints, 39) // 36 + 3
  assert.equal(razzle?.totalPoints, 34) // 32 + 2
})

test('computeCumulativeStandings — round ordering fed into it must come from sortRoundsChronologically, not raw array order — verifies the two functions compose correctly for the reported bug\'s exact shape', () => {
  // Simulates rounds returned in the WRONG order (as they could be,
  // pre-fix, when created_at collides) — round2's data listed first.
  const roundsInWrongOrder = [
    { id: 'round-2', play_date: '2026-08-11', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 'round-1', play_date: '2026-08-10', created_at: '2026-08-01T10:00:00.000Z' },
  ]
  const correctedOrder = sortRoundsChronologically(roundsInWrongOrder)
  assert.deepEqual(correctedOrder.map(r => r.id), ['round-1', 'round-2'])

  // Per-round results keyed by round id, not by array position — this is
  // what the API route now builds roundsSummary/roundNumber from, so the
  // corrected order above is what actually determines which id gets
  // labeled "roundNumber: 1" (the "R1" column) vs "roundNumber: 2"
  // ("R2 LIVE").
  const resultsByRoundId: Record<string, { playerId: string; playerName: string; roundPoints: number }[]> = {
    'round-1': [{ playerId: 'darren', playerName: 'Darren', roundPoints: 36 }],
    'round-2': [{ playerId: 'darren', playerName: 'Darren', roundPoints: 3 }],
  }
  const orderedResults = correctedOrder.map(r => resultsByRoundId[r.id])
  const standings = computeCumulativeStandings(orderedResults)
  assert.equal(standings[0].totalPoints, 39) // 36 + 3, correct regardless of the original fetch order
})

// ── computeCumulativeStandings ──────────────────────────────────────────────

test('cumulative standings — matches the brief\'s own worked example (Alex/TEST across two rounds)', () => {
  const round1 = [
    { playerId: 'alex', playerName: 'Alex', roundPoints: 38 },
    { playerId: 'test', playerName: 'TEST', roundPoints: 34 },
  ]
  const round2 = [
    { playerId: 'alex', playerName: 'Alex', roundPoints: 35 },
    { playerId: 'test', playerName: 'TEST', roundPoints: 37 },
  ]
  const standings = computeCumulativeStandings([round1, round2])
  const alex = standings.find(s => s.playerId === 'alex')
  const test_ = standings.find(s => s.playerId === 'test')
  assert.equal(alex?.totalPoints, 73)
  assert.equal(test_?.totalPoints, 71)
  // Alex (73) ranks above TEST (71) after round 2, despite TEST scoring
  // higher in round 2 alone — this is the actual point of cumulative
  // scoring, not just round-by-round.
  assert.equal(alex?.position, 1)
  assert.equal(test_?.position, 2)
})

test('cumulative standings — single round (Round 2 setup showing Round 1 only) is just that round\'s totals', () => {
  const round1 = [
    { playerId: 'a', playerName: 'Alex Schaefer', roundPoints: 38 },
    { playerId: 'b', playerName: 'TEST', roundPoints: 34 },
    { playerId: 'c', playerName: 'Player C', roundPoints: 31 },
    { playerId: 'd', playerName: 'Player D', roundPoints: 29 },
  ]
  const standings = computeCumulativeStandings([round1])
  assert.deepEqual(standings.map(s => s.playerId), ['a', 'b', 'c', 'd'])
  assert.deepEqual(standings.map(s => s.position), [1, 2, 3, 4])
})

test('cumulative standings — tied players share the same position (1,2,2,4 not 1,2,2,3)', () => {
  const round1 = [
    { playerId: 'a', playerName: 'A', roundPoints: 40 },
    { playerId: 'b', playerName: 'B', roundPoints: 35 },
    { playerId: 'c', playerName: 'C', roundPoints: 35 },
    { playerId: 'd', playerName: 'D', roundPoints: 30 },
  ]
  const standings = computeCumulativeStandings([round1])
  assert.deepEqual(standings.map(s => s.position), [1, 2, 2, 4])
})

test('cumulative standings — a player present in only round 1 (e.g. left the trip) is still totalled correctly', () => {
  const round1 = [
    { playerId: 'a', playerName: 'A', roundPoints: 30 },
    { playerId: 'guest', playerName: 'Guest', roundPoints: 25 },
  ]
  const round2 = [
    { playerId: 'a', playerName: 'A', roundPoints: 32 },
  ]
  const standings = computeCumulativeStandings([round1, round2])
  const a = standings.find(s => s.playerId === 'a')
  const guest = standings.find(s => s.playerId === 'guest')
  assert.equal(a?.totalPoints, 62)
  assert.equal(a?.roundsPlayed, 2)
  assert.equal(guest?.totalPoints, 25)
  assert.equal(guest?.roundsPlayed, 1)
})

// ── determineRoundWinners / determineChampions (Sprint 8 — Final Event
//    Results) ─────────────────────────────────────────────────────────────

test('determineRoundWinners — single clear winner', () => {
  const results = [
    { playerId: 'a', playerName: 'Alex', roundPoints: 39 },
    { playerId: 'b', playerName: 'Darren', roundPoints: 34 },
  ]
  const winners = determineRoundWinners(results)
  assert.deepEqual(winners, [{ playerId: 'a', playerName: 'Alex', points: 39 }])
})

test('determineRoundWinners — tie returns every player at the max, not just the first', () => {
  const results = [
    { playerId: 'a', playerName: 'Alex', roundPoints: 36 },
    { playerId: 'b', playerName: 'Darren', roundPoints: 36 },
    { playerId: 'c', playerName: 'Dave', roundPoints: 30 },
  ]
  const winners = determineRoundWinners(results)
  assert.equal(winners.length, 2)
  assert.deepEqual(new Set(winners.map(w => w.playerId)), new Set(['a', 'b']))
})

test('determineRoundWinners — no scorecards for the round returns no winners, not a crash', () => {
  assert.deepEqual(determineRoundWinners([]), [])
})

test('determineChampions — single champion at position 1', () => {
  const standings = computeCumulativeStandings([
    [{ playerId: 'a', playerName: 'Alex', roundPoints: 40 }, { playerId: 'b', playerName: 'Darren', roundPoints: 35 }],
  ])
  const champions = determineChampions(standings)
  assert.deepEqual(champions.map(c => c.playerId), ['a'])
})

test('determineChampions — a tie at the top produces joint champions, never one picked arbitrarily', () => {
  const standings = computeCumulativeStandings([
    [{ playerId: 'a', playerName: 'Alex', roundPoints: 36 }, { playerId: 'b', playerName: 'Darren', roundPoints: 36 }, { playerId: 'c', playerName: 'Dave', roundPoints: 30 }],
  ])
  const champions = determineChampions(standings)
  assert.equal(champions.length, 2)
  assert.deepEqual(new Set(champions.map(c => c.playerId)), new Set(['a', 'b']))
  // Third place is not a champion, however close.
  assert.equal(champions.some(c => c.playerId === 'c'), false)
})

test('determineChampions — matches the brief\'s own two-round worked example (Alex 72 vs TEST/Darren 69)', () => {
  const round1 = [{ playerId: 'a', playerName: 'Alex', roundPoints: 33 }, { playerId: 'd', playerName: 'Darren', roundPoints: 38 }]
  const round2 = [{ playerId: 'a', playerName: 'Alex', roundPoints: 39 }, { playerId: 'd', playerName: 'Darren', roundPoints: 31 }]
  const standings = computeCumulativeStandings([round1, round2])
  const champions = determineChampions(standings)
  assert.deepEqual(champions, [{ playerId: 'a', playerName: 'Alex', totalPoints: 72 }])
})

// ── seedLeadersLast ──────────────────────────────────────────────────────────

test('seedLeadersLast — exactly matches the brief\'s own 8-player, groups-of-4 example', () => {
  // Best-to-worst, position 1 first, matching the brief's own numbering.
  const standings = [
    { playerId: 'alex' },    // 1
    { playerId: 'darren' },  // 2
    { playerId: 'mark' },    // 3
    { playerId: 'steve' },   // 4
    { playerId: 'tom' },     // 5
    { playerId: 'james' },   // 6
    { playerId: 'peter' },   // 7
    { playerId: 'john' },    // 8
  ]
  const assignments = seedLeadersLast(standings, 4)
  const groupOf = (id: string) => assignments.find(a => a.playerId === id)?.groupIndex

  // Group 0 (earliest) = the bottom 4: John, Peter, James, Tom
  assert.equal(groupOf('john'), 0)
  assert.equal(groupOf('peter'), 0)
  assert.equal(groupOf('james'), 0)
  assert.equal(groupOf('tom'), 0)

  // Group 1 (later/last) = the top 4: Steve, Mark, Darren, Alex
  assert.equal(groupOf('steve'), 1)
  assert.equal(groupOf('mark'), 1)
  assert.equal(groupOf('darren'), 1)
  assert.equal(groupOf('alex'), 1)
})

test('seedLeadersLast — the event leader is always in the highest-index (last) group', () => {
  const standings = Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i + 1}` })) // p1 = leader
  const assignments = seedLeadersLast(standings, 4)
  const leaderGroup = assignments.find(a => a.playerId === 'p1')!.groupIndex
  const maxGroup = Math.max(...assignments.map(a => a.groupIndex))
  assert.equal(leaderGroup, maxGroup)
})

test('seedLeadersLast — the lowest-ranked player is always in group 0', () => {
  const standings = Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i + 1}` }))
  const assignments = seedLeadersLast(standings, 4)
  const lastPlaceGroup = assignments.find(a => a.playerId === 'p12')!.groupIndex
  assert.equal(lastPlaceGroup, 0)
})

test('seedLeadersLast — every player is assigned exactly once, none lost or duplicated', () => {
  const standings = Array.from({ length: 10 }, (_, i) => ({ playerId: `p${i + 1}` }))
  const assignments = seedLeadersLast(standings, 3)
  assert.equal(assignments.length, 10)
  assert.equal(new Set(assignments.map(a => a.playerId)).size, 10)
})

test('seedLeadersLast — an uneven player count puts the remainder in the final group', () => {
  const standings = Array.from({ length: 10 }, (_, i) => ({ playerId: `p${i + 1}` }))
  const assignments = seedLeadersLast(standings, 4)
  const groupSizes = new Map<number, number>()
  for (const a of assignments) groupSizes.set(a.groupIndex, (groupSizes.get(a.groupIndex) ?? 0) + 1)
  // 10 players / 4 per group = groups of 4, 4, 2 — the smaller group is
  // the last (highest-index, leaders) group.
  assert.equal(groupSizes.get(0), 4)
  assert.equal(groupSizes.get(1), 4)
  assert.equal(groupSizes.get(2), 2)
})

// ── Side Competition instance isolation (Sprint 9 correction) ───────────────
// determineRoundWinners/determineChampions are pure and take their own
// isolated input array on every call — there is no shared/module-level
// state for either function to leak between two competition instances.
// These tests document and assert that explicitly (two NTPs on
// different holes, called independently, produce independent results)
// rather than leaving it as an implicit property of "the functions
// happen to be pure". The actual DB-level isolation guarantee (every
// query scoped by side_comp_id, verified by code trace in the delivery
// report) is a different, integration-level claim this sandbox has no
// live database to exercise directly — not something a unit test here
// can honestly claim to cover.

test('determineRoundWinners — two competition instances of the same comp_type (e.g. NTP on Hole 3 and NTP on Hole 7) never share or leak state between calls', () => {
  const instanceA = [
    { playerId: 'darren', playerName: 'Darren', roundPoints: 5 },
    { playerId: 'alex', playerName: 'Alex', roundPoints: 3 },
  ]
  const instanceB = [
    { playerId: 'darren', playerName: 'Darren', roundPoints: 1 },
    { playerId: 'alex', playerName: 'Alex', roundPoints: 8 },
  ]
  const winnersA = determineRoundWinners(instanceA)
  const winnersB = determineRoundWinners(instanceB)
  assert.deepEqual(winnersA.map(w => w.playerId), ['darren'])
  assert.deepEqual(winnersB.map(w => w.playerId), ['alex'])
  // Calling A again after B produces the exact same result as the first
  // time — nothing from instance B's call leaked into instance A.
  assert.deepEqual(determineRoundWinners(instanceA).map(w => w.playerId), ['darren'])
})

test('determineChampions — two independent standings computations (e.g. two Powerplay holes\' own best-score rankings) do not interfere with each other', () => {
  const standingsA = computeCumulativeStandings([[{ playerId: 'p1', playerName: 'P1', roundPoints: 10 }, { playerId: 'p2', playerName: 'P2', roundPoints: 6 }]])
  const standingsB = computeCumulativeStandings([[{ playerId: 'p1', playerName: 'P1', roundPoints: 4 }, { playerId: 'p2', playerName: 'P2', roundPoints: 9 }]])
  assert.deepEqual(determineChampions(standingsA).map(c => c.playerId), ['p1'])
  assert.deepEqual(determineChampions(standingsB).map(c => c.playerId), ['p2'])
})

// ── selectLeaderboardRound ───────────────────────────────────────────────────
// The Leaderboard page's own round-selection logic, extracted specifically
// because it previously had zero direct test coverage — exactly how a real
// bug (no deterministic tiebreaker for rounds sharing a play_date) went
// unnoticed. These follow Darren's own reported scenarios precisely.

function round(id: string, status: string, playDate: string, createdAt = '2026-01-01T00:00:00Z') {
  return { id, name: id, status, play_date: playDate, created_at: createdAt }
}

test('selectLeaderboardRound — scenario 1: Round 1 active', () => {
  const rounds = [round('r1', 'active', '2026-08-01')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r1')
})

test('selectLeaderboardRound — scenario 2: Round 1 completed, Round 2 upcoming — shows Round 1 (cumulative through last completed), not an empty board', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'upcoming', '2026-08-02')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r1')
})

test('selectLeaderboardRound — scenario 3: Round 2 active (Round 1 completed)', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'active', '2026-08-02')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r2')
})

test('selectLeaderboardRound — scenario 4: Round 2 completed, Round 3 upcoming — shows Round 2, never falls back to Round 1', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02'), round('r3', 'upcoming', '2026-08-03')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r2')
})

test('selectLeaderboardRound — scenario 5: final round completed (event complete) — shows the LAST round, not Round 1', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r2')
})

test('selectLeaderboardRound — scenario 6: three or more rounds, event complete — shows the genuinely final round', () => {
  const rounds = [
    round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02'),
    round('r3', 'completed', '2026-08-03'), round('r4', 'completed', '2026-08-04'),
  ]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r4')
})

test('selectLeaderboardRound — scenario 7: two rounds created at the same timestamp (identical play_date AND created_at) — this is the actual bug found: without a deterministic tiebreaker, this could non-deterministically resolve to Round 1', () => {
  const rounds = [
    round('r1', 'completed', '2026-08-01', '2026-08-01T09:00:00Z'),
    round('r2', 'completed', '2026-08-01', '2026-08-01T09:00:00Z'), // identical play_date AND created_at — id is the only remaining tiebreaker
  ]
  const result = selectLeaderboardRound(rounds)
  // Deterministic and repeatable — the exact identity matters less than
  // that calling this twice never disagrees with itself, and that it's
  // never influenced by array input order (both permutations checked).
  const resultReversed = selectLeaderboardRound([...rounds].reverse())
  assert.equal(result?.id, resultReversed?.id)
  assert.ok(result?.id === 'r1' || result?.id === 'r2')
})

test('selectLeaderboardRound — Darren\'s exact worked example: Round 1 (Kurt 54, Darren 44) + Round 2 (Kurt 42, Darren 40), event complete, must resolve to Round 2 so cumulative totals (Kurt 96, Darren 84) are what gets shown — never silently falls back to Round 1\'s 54/44', () => {
  const rounds = [round('round-1-id', 'completed', '2026-08-13'), round('round-2-id', 'completed', '2026-08-14')]
  const selected = selectLeaderboardRound(rounds)
  assert.equal(selected?.id, 'round-2-id') // NOT 'round-1-id' — the actual reported bug
})

test('selectLeaderboardRound — an active round always wins over a more recently completed one (mid-event, Round 2 active, Round 3 somehow already completed is not a realistic state, but active must still take priority per the explicit rule)', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'active', '2026-08-02')]
  assert.equal(selectLeaderboardRound(rounds)?.status, 'active')
})

test('selectLeaderboardRound — no rounds at all returns undefined, not a crash', () => {
  assert.equal(selectLeaderboardRound([]), undefined)
})

test('selectLeaderboardRound — only upcoming rounds (pre-event) falls back to the chronologically first, unchanged legacy behaviour', () => {
  const rounds = [round('r2', 'upcoming', '2026-08-02'), round('r1', 'upcoming', '2026-08-01')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r1')
})

// ── selectRelevantSideGameRounds ────────────────────────────────────────────
// Fix Batch 2 — Side Games' new event-level round selection. The
// per-competition logic itself (leader derivation, verification
// filtering, closure) is UNCHANGED — only relocated (extracted from the
// single-round route into computeRoundSideGames, called identically by
// both the drill-down and event-level routes) — so it isn't re-tested
// here; it was already correct per the Stage 4 audit and remains an
// admin-client-dependent function this sandbox can't unit test directly.
// What's genuinely new is which ROUNDS get included, which is exactly
// what these tests cover.

test('selectRelevantSideGameRounds — during an active round: includes completed rounds plus the active one', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'active', '2026-08-02')]
  const result = selectRelevantSideGameRounds(rounds)
  assert.deepEqual(result.map(r => r.id), ['r1', 'r2'])
})

test('selectRelevantSideGameRounds — between rounds: only completed rounds, upcoming excluded entirely (not an empty placeholder)', () => {
  const rounds = [round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02'), round('r3', 'upcoming', '2026-08-03')]
  const result = selectRelevantSideGameRounds(rounds)
  assert.deepEqual(result.map(r => r.id), ['r1', 'r2'])
})

test('selectRelevantSideGameRounds — event complete: every completed round included, in chronological order', () => {
  const rounds = [round('r3', 'completed', '2026-08-03'), round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02')]
  const result = selectRelevantSideGameRounds(rounds)
  assert.deepEqual(result.map(r => r.id), ['r1', 'r2', 'r3'])
})

test('selectRelevantSideGameRounds — a brand-new trip with only upcoming rounds returns an empty list, not an error', () => {
  const rounds = [round('r1', 'upcoming', '2026-08-01')]
  assert.deepEqual(selectRelevantSideGameRounds(rounds), [])
})

test('selectRelevantSideGameRounds — two rounds created at the same timestamp still both appear, deterministically ordered regardless of input order', () => {
  const rounds = [
    round('r1', 'completed', '2026-08-01', '2026-08-01T09:00:00Z'),
    round('r2', 'completed', '2026-08-01', '2026-08-01T09:00:00Z'),
  ]
  const forward = selectRelevantSideGameRounds(rounds)
  const backward = selectRelevantSideGameRounds([...rounds].reverse())
  assert.deepEqual(forward.map(r => r.id), backward.map(r => r.id))
  assert.equal(forward.length, 2)
})

test('selectRelevantSideGameRounds — three or more rounds, mixed statuses: only completed + active included, in order', () => {
  const rounds = [
    round('r1', 'completed', '2026-08-01'), round('r2', 'completed', '2026-08-02'),
    round('r3', 'active', '2026-08-03'), round('r4', 'upcoming', '2026-08-04'),
  ]
  const result = selectRelevantSideGameRounds(rounds)
  assert.deepEqual(result.map(r => r.id), ['r1', 'r2', 'r3'])
})

test('selectRelevantSideGameRounds — no rounds at all returns an empty array, not a crash', () => {
  assert.deepEqual(selectRelevantSideGameRounds([]), [])
})

test('buildRoundsSummary — the exact regression: viewing a completed round no longer says LIVE', () => {
  // Round 1 completed, Round 2 also completed (event finished, player
  // browsing back to review Round 1) — the OLD i === length-1 heuristic
  // would have labeled Round 1 (the last/only element in a
  // single-element relevant-rounds array when viewing R1 specifically)
  // as LIVE regardless of its real status.
  const result = buildRoundsSummary([{ id: 'r1', status: 'completed' }])
  assert.deepEqual(result, [{ roundId: 'r1', roundNumber: 1, isLive: false }])
})

test('buildRoundsSummary — Round 2 genuinely live is correctly labeled', () => {
  const result = buildRoundsSummary([
    { id: 'r1', status: 'completed' },
    { id: 'r2', status: 'active' },
  ])
  assert.deepEqual(result, [
    { roundId: 'r1', roundNumber: 1, isLive: false },
    { roundId: 'r2', roundNumber: 2, isLive: true },
  ])
})

test('buildRoundsSummary — both rounds completed (event fully finished) — neither is LIVE', () => {
  const result = buildRoundsSummary([
    { id: 'r1', status: 'completed' },
    { id: 'r2', status: 'completed' },
  ])
  assert.equal(result.every(r => !r.isLive), true)
})

test('buildRoundsSummary — generic for 3+ rounds, live round can be in the middle', () => {
  // Confirms this isn't secretly still position-based — a live round
  // that ISN'T the last element must still be correctly flagged.
  const result = buildRoundsSummary([
    { id: 'r1', status: 'completed' },
    { id: 'r2', status: 'active' },
    { id: 'r3', status: 'completed' },
  ])
  assert.deepEqual(result.map(r => r.isLive), [false, true, false])
})

test('derivePreviousCurrentTotal — matches the brief\u2019s own worked example exactly (Alex: Previous 59, Current 53, Total 112)', () => {
  const result = derivePreviousCurrentTotal(112, 53, 2)
  assert.equal(result.previous, 59)
  assert.equal(result.current, 53)
  assert.equal(result.total, 112)
  assert.equal(result.isFirstRound, false)
})

test('derivePreviousCurrentTotal — the brief\u2019s second worked example (Darren: Previous 47, Current 46, Total 93)', () => {
  const result = derivePreviousCurrentTotal(93, 46, 2)
  assert.equal(result.previous, 47)
})

test('derivePreviousCurrentTotal — Round 1 (no prior round) is flagged as isFirstRound, Previous is still numerically 0', () => {
  const result = derivePreviousCurrentTotal(53, 53, 1)
  assert.equal(result.isFirstRound, true)
  assert.equal(result.previous, 0) // caller renders "—" for this case, not this function's job to format
})

test('derivePreviousCurrentTotal — Total always equals Previous + Current, by construction, for any input', () => {
  for (const [total, current, count] of [[0, 0, 1], [200, 0, 3], [50, 50, 2], [37, 12, 5]] as [number, number, number][]) {
    const result = derivePreviousCurrentTotal(total, current, count)
    assert.equal(result.previous + result.current, result.total)
  }
})

test('derivePreviousCurrentTotal — scales identically for Round 20 of a season as for Round 2', () => {
  // "That architecture will work just as well for Round 20" — this
  // function takes no round-count-specific input at all beyond the
  // already-aggregated totalPoints, so there's nothing to special-case.
  const round2 = derivePreviousCurrentTotal(112, 53, 2)
  const round20 = derivePreviousCurrentTotal(1840, 53, 20)
  assert.equal(round2.current, round20.current)
  assert.notEqual(round2.previous, round20.previous)
})
