import test from 'node:test'
import assert from 'node:assert/strict'
import { floorDiv, roundHalfUpDiv, roundHalfAwayFromZeroDiv, wholeStrokesFromTeamHandicap, oneDecimalToTenths, buildAllowanceSnapshot, WHOLE_STROKES_RULE } from './rounding'
import { calculateAmbroseTeamHandicap } from './handicap'

test('floorDiv is exact for negatives', () => {
  assert.equal(floorDiv(7, 2), 3); assert.equal(floorDiv(-7, 2), -4); assert.equal(floorDiv(-8, 2), -4); assert.equal(floorDiv(0, 5), 0)
  assert.throws(() => floorDiv(1, 0)); assert.throws(() => floorDiv(1.5, 2))
})
test('half-up (team handicap): exact halves go toward +infinity, including negatives', () => {
  // num/den -> integer
  assert.equal(roundHalfUpDiv(5, 2), 3); assert.equal(roundHalfUpDiv(-5, 2), -2); assert.equal(roundHalfUpDiv(3, 2), 2); assert.equal(roundHalfUpDiv(-3, 2), -1)
  assert.equal(roundHalfUpDiv(1, 2), 1); assert.equal(roundHalfUpDiv(-1, 2), 0)
  // non-halves
  assert.equal(roundHalfUpDiv(7, 3), 2); assert.equal(roundHalfUpDiv(-7, 3), -2); assert.equal(roundHalfUpDiv(8, 3), 3); assert.equal(roundHalfUpDiv(-8, 3), -3)
})
test('half-away-from-zero (whole strokes): exact halves go away from zero, symmetric, never -0', () => {
  assert.equal(roundHalfAwayFromZeroDiv(5, 2), 3); assert.equal(roundHalfAwayFromZeroDiv(-5, 2), -3)
  assert.equal(roundHalfAwayFromZeroDiv(1, 2), 1); assert.equal(roundHalfAwayFromZeroDiv(-1, 2), -1)
  assert.equal(roundHalfAwayFromZeroDiv(7, 3), 2); assert.equal(roundHalfAwayFromZeroDiv(-7, 3), -2)
  assert.ok(Object.is(roundHalfAwayFromZeroDiv(-4, 10), 0)); assert.ok(Object.is(roundHalfAwayFromZeroDiv(0, 10), 0))
})
test('whole strokes from a one-decimal team handicap: worked examples incl. negatives and exact halves', () => {
  const cases: [number, number][] = [
    [7.5, 8], [7.4, 7], [7.6, 8], [0.5, 1], [0.4, 0], [0, 0], [10, 10], [12.5, 13],
    [-0.4, 0], [-0.5, -1], [-0.6, -1], [-1.5, -2], [-7.5, -8], [-7.4, -7], [-2.0, -2],
  ]
  for (const [h, want] of cases) assert.ok(Object.is(wholeStrokesFromTeamHandicap(h), want), `${h} -> ${wholeStrokesFromTeamHandicap(h)} want ${want}`)
})
test('the two rules differ exactly where intended (negative exact halves), and agree elsewhere', () => {
  // Team handicap to ONE DECIMAL (half up): combined -1.0 on a 2-person club divisor = -0.25 -> -0.2
  const r = calculateAmbroseTeamHandicap({ method: 'club_divisor', teamSize: 2, inputBasis: 'fixture',
    players: [{ playerId: 'a', handicap: -2.0 }, { playerId: 'b', handicap: 1.0 }] })
  assert.equal(r.teamHandicap, -0.2)
  // The positive mirror: +0.25 -> 0.3
  const m = calculateAmbroseTeamHandicap({ method: 'club_divisor', teamSize: 2, inputBasis: 'fixture',
    players: [{ playerId: 'a', handicap: 0.0 }, { playerId: 'b', handicap: 1.0 }] })
  assert.equal(m.teamHandicap, 0.3)
  // WHOLE strokes (away from zero) are symmetric: -7.5 -> -8 while one-decimal half-up of -7.25 is -7.2
  assert.equal(wholeStrokesFromTeamHandicap(-7.5), -8)
  assert.equal(wholeStrokesFromTeamHandicap(7.5), 8)
})
test('inputs with more than one decimal are rejected, never rounded', () => {
  assert.throws(() => wholeStrokesFromTeamHandicap(7.55)); assert.throws(() => oneDecimalToTenths(NaN)); assert.equal(oneDecimalToTenths(-7.5), -75)
})
test('snapshot freezes method, inputs, decimal allowance and (only for Team Stableford) the whole strokes', () => {
  const rec = calculateAmbroseTeamHandicap({ method: 'ga_weighted', teamSize: 4, inputBasis: 'fixture',
    players: [{ playerId: 'a', handicap: 8 }, { playerId: 'b', handicap: 14 }, { playerId: 'c', handicap: 20 }, { playerId: 'd', handicap: 26 }] })
  // 25%*8 + 20%*14 + 15%*20 + 10%*26 = 2 + 2.8 + 3 + 2.6 = 10.4
  assert.equal(rec.teamHandicap, 10.4)
  const net = buildAllowanceSnapshot(rec, { teamStableford: false })
  assert.equal(net.strokesReceived, null); assert.equal(net.strokesRounding, null); assert.equal(net.teamHandicap, 10.4)
  const ts = buildAllowanceSnapshot(rec, { teamStableford: true })
  assert.equal(ts.strokesReceived, 10); assert.equal(ts.strokesRounding, WHOLE_STROKES_RULE); assert.equal(ts.teamHandicap, 10.4)
  assert.equal(ts.method, 'ga_weighted'); assert.equal(ts.players.length, 4); assert.equal(ts.sourceStatus, 'unverified_archived_2020'); assert.equal(ts.components!.length, 4)
})
test('a plus-handicap team keeps its sign through both rules', () => {
  const rec = calculateAmbroseTeamHandicap({ method: 'organiser_entered', teamSize: 2, inputBasis: 'organiser', organiserTeamHandicap: -1.5, organiserNote: 'plus team',
    players: [{ playerId: 'a', handicap: -3 }, { playerId: 'b', handicap: 0 }] })
  const s = buildAllowanceSnapshot(rec, { teamStableford: true })
  assert.equal(s.teamHandicap, -1.5); assert.equal(s.strokesReceived, -2)
})
