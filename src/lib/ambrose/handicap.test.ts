import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateAmbroseTeamHandicap, netScore, divRoundHalfUp, toTenths, explainAmbroseHandicap, AmbroseHandicapError } from './handicap'

const P = (...h: number[]) => h.map((handicap, i) => ({ playerId: `p${i + 1}`, handicap }))
const base = { inputBasis: 'test_basis' }

test('worked examples: weighted two-person 35/15 (8,16 -> 5.2)', () => {
  const r = calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(16, 8) })
  assert.equal(r.teamHandicap, 5.2)
  assert.deepEqual(r.components!.map(c => c.contribution), ['2.800', '2.400'])
  assert.equal(r.players[0].handicap, 8) // sorted lowest first regardless of input order
})
test('worked examples: weighted four-person 25/20/15/10 (6,12,18,24 -> 9.0)', () => {
  const r = calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 4, players: P(24, 6, 18, 12) })
  assert.equal(r.teamHandicap, 9)
  assert.deepEqual(r.components!.map(c => c.contribution), ['1.500', '2.400', '2.700', '2.400'])
})
test('worked examples: club divisor (2p 8,16 -> 6.0; 4p 6,12,18,24 -> 7.5)', () => {
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 2, players: P(8, 16) }).teamHandicap, 6)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 4, players: P(6, 12, 18, 24) }).teamHandicap, 7.5)
})
test('single rounding step, half up, on exact values (not on floats)', () => {
  // 4p divisor: sum 10.1 /8 = 1.2625 -> 1.3 ; sum 10.0/8 = 1.25 -> 1.3 (half up) ; 9.9/8=1.2375 -> 1.2
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 4, players: P(10.1, 0, 0, 0) }).teamHandicap, 1.3)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 4, players: P(10, 0, 0, 0) }).teamHandicap, 1.3)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 4, players: P(9.9, 0, 0, 0) }).teamHandicap, 1.2)
  // weighted 2p: 35% of 0.1 = 0.035 -> 0.0 ; 15% of 5.0 = 0.75 -> total 0.785 -> 0.8
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(0.1, 5) }).teamHandicap, 0.8)
  // exact half: 35% of 0 + 15% of 3.3 = 0.495 -> 0.5 ; and 0.25 case: 15% of 1.5 = 0.225 -> 0.2 (0.225 < 0.25)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(0, 3.3) }).teamHandicap, 0.5)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(0, 1.5) }).teamHandicap, 0.2)
  assert.equal(divRoundHalfUp(5, 2), 3); assert.equal(divRoundHalfUp(-5, 2), -2) // toward +infinity, like Math.round
})
test('plus handicaps are negative values and sort lowest first', () => {
  const r = calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(10, -2) })
  assert.equal(r.players[0].handicap, -2)
  // 35% of -2 = -0.7 ; 15% of 10 = 1.5 -> 0.8
  assert.equal(r.teamHandicap, 0.8)
  assert.equal(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 2, players: P(-2, 10) }).teamHandicap, 2)
})
test('incomplete or oversized teams are refused (4-player allowance never applied to 3)', () => {
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 4, players: P(1, 2, 3) }), (e: unknown) => (e as AmbroseHandicapError).code === 'INCOMPLETE_TEAM')
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 2, players: P(1, 2, 3) }), (e: unknown) => (e as AmbroseHandicapError).code === 'INCOMPLETE_TEAM')
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'ga_weighted', teamSize: 3 as 2, players: P(1, 2, 3) }), (e: unknown) => (e as AmbroseHandicapError).code === 'UNSUPPORTED_TEAM_SIZE')
})
test('duplicate player and over-precise input are refused, never silently rounded', () => {
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 2, players: [{ playerId: 'a', handicap: 1 }, { playerId: 'a', handicap: 2 }] }), (e: unknown) => (e as AmbroseHandicapError).code === 'DUPLICATE_PLAYER')
  assert.throws(() => toTenths(10.25))
  assert.throws(() => toTenths(Number.NaN))
  assert.throws(() => toTenths(101))
})
test('method C: organiser value is kept as typed, needs a note, is flagged organiser_supplied', () => {
  const r = calculateAmbroseTeamHandicap({ ...base, method: 'organiser_entered', teamSize: 4, players: P(1, 2, 3), organiserTeamHandicap: 7.5, organiserNote: 'Per club conditions' })
  assert.equal(r.teamHandicap, 7.5); assert.equal(r.sourceStatus, 'organiser_supplied')
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'organiser_entered', teamSize: 4, players: P(1), organiserTeamHandicap: 7.5 }), (e: unknown) => (e as AmbroseHandicapError).code === 'NOTE_REQUIRED')
  assert.throws(() => calculateAmbroseTeamHandicap({ ...base, method: 'organiser_entered', teamSize: 4, players: P(1), organiserTeamHandicap: 7.55, organiserNote: 'x' }))
})
test('no method is ever labelled as a current Golf Australia requirement', () => {
  for (const m of ['ga_weighted', 'club_divisor'] as const) {
    const r = calculateAmbroseTeamHandicap({ ...base, method: m, teamSize: 2, players: P(8, 16) })
    assert.notEqual(r.sourceStatus, 'organiser_supplied')
    assert.ok(['unverified_archived_2020', 'secondary_sources_only'].includes(r.sourceStatus))
  }
})
test('net score keeps one decimal exactly through the calculation', () => {
  assert.equal(netScore(72, 9), 63)
  assert.equal(netScore(72, 5.2), 66.8)
  assert.equal(netScore(70, 0.8), 69.2)
  assert.equal(netScore(70, -1.5), 71.5)
})
test('explain output matches the record', () => {
  const lines = explainAmbroseHandicap(calculateAmbroseTeamHandicap({ ...base, method: 'club_divisor', teamSize: 2, players: P(8, 16) }))
  assert.ok(lines.some(l => l.includes('divided by 4 = 6.0')))
})
