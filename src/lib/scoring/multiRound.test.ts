import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCumulativeStandings, seedLeadersLast } from './multiRound'

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
