import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateSeasonSummary, type SeasonSummaryInput } from './roundResult'

// The exact scenario from the Social Golf brief:
//   Round 1: Alex 20, Dave 18
//   Round 2: Alex 17, Dave 21
//   Round 3: Alex 22, Dave 22 (tie)
//   Round 4: upcoming (must be excluded — never passed in here at all,
//     since the caller is responsible for only including completed
//     rounds; this function trusts its input)
const ALEX = 'alex-id'
const DAVE = 'dave-id'

function makeRound(roundId: string, roundName: string, alexPts: number, davePts: number): SeasonSummaryInput {
  const players = [
    { playerId: ALEX, name: 'Alex Schaefer', totalPts: alexPts },
    { playerId: DAVE, name: 'Dave Williams', totalPts: davePts },
  ]
  const maxPts = Math.max(alexPts, davePts)
  const winners = players.filter(p => p.totalPts === maxPts)
  return { roundId, roundName, result: { roundId, players, winners, isTie: winners.length > 1 } }
}

const rounds: SeasonSummaryInput[] = [
  makeRound('r1', 'Round 1', 20, 18),
  makeRound('r2', 'Round 2', 17, 21),
  makeRound('r3', 'Round 3', 22, 22),
]

test('Season Summary — completed rounds count excludes upcoming rounds', () => {
  const summary = aggregateSeasonSummary(rounds)
  assert.equal(summary.completedRoundsCount, 3)
})

test('Season Summary — round wins, joint winners each receive one full win', () => {
  const summary = aggregateSeasonSummary(rounds)
  const alex = summary.standings.find(s => s.playerId === ALEX)
  const dave = summary.standings.find(s => s.playerId === DAVE)
  assert.equal(alex?.wins, 2) // Round 1 + tied Round 3
  assert.equal(dave?.wins, 2) // Round 2 + tied Round 3
})

test('Season Summary — averages match the brief\'s exact expected values', () => {
  const summary = aggregateSeasonSummary(rounds)
  const alex = summary.averages.find(a => a.playerId === ALEX)
  const dave = summary.averages.find(a => a.playerId === DAVE)
  // Alex: (20+17+22)/3 = 19.666... -> 19.67
  assert.equal(alex?.average, 19.67)
  // Dave: (18+21+22)/3 = 20.333... -> 20.33
  assert.equal(dave?.average, 20.33)
  assert.equal(alex?.roundsPlayed, 3)
  assert.equal(dave?.roundsPlayed, 3)
})

test('Season Summary — best round is 22, joint Alex and Dave', () => {
  const summary = aggregateSeasonSummary(rounds)
  assert.equal(summary.bestRound?.pts, 22)
  const names = summary.bestRound?.players.map(p => p.playerId).sort()
  assert.deepEqual(names, [ALEX, DAVE].sort())
})

test('Season Summary — latest result is Round 3, joint winners', () => {
  const summary = aggregateSeasonSummary(rounds)
  assert.equal(summary.latestResult?.roundName, 'Round 3')
  assert.equal(summary.latestResult?.isTie, true)
  assert.equal(summary.latestResult?.winners.length, 2)
})

test('Season Summary — single, non-tied winner produces exactly one winner entry', () => {
  const single = aggregateSeasonSummary([makeRound('r1', 'Round 1', 24, 21)])
  assert.equal(single.latestResult?.isTie, false)
  assert.equal(single.latestResult?.winners.length, 1)
  assert.equal(single.latestResult?.winners[0].playerId, ALEX)
})

test('Season Summary — works for more than two players, not structurally limited to two', () => {
  const threePlayerRound: SeasonSummaryInput = {
    roundId: 'r1', roundName: 'Round 1',
    result: {
      roundId: 'r1',
      players: [
        { playerId: 'a', name: 'A', totalPts: 20 },
        { playerId: 'b', name: 'B', totalPts: 25 },
        { playerId: 'c', name: 'C', totalPts: 18 },
      ],
      winners: [{ playerId: 'b', name: 'B', totalPts: 25 }],
      isTie: false,
    },
  }
  const summary = aggregateSeasonSummary([threePlayerRound])
  assert.equal(summary.standings.length, 1) // only the winner has a win
  assert.equal(summary.standings[0].playerId, 'b')
  assert.equal(summary.averages.length, 3) // every player gets an average
})

test('Season Summary — zero completed rounds returns an empty, well-formed summary', () => {
  const summary = aggregateSeasonSummary([])
  assert.equal(summary.completedRoundsCount, 0)
  assert.deepEqual(summary.standings, [])
  assert.deepEqual(summary.averages, [])
  assert.equal(summary.bestRound, null)
  assert.equal(summary.latestResult, null)
})
