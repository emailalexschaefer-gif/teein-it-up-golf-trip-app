import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTripReadiness } from './tripLifecycle'

test('readiness — not ready with zero members', () => {
  const result = computeTripReadiness({ memberCount: 0, ungroupedMemberCount: 0, roundCount: 1 })
  assert.equal(result.ready, false)
  assert.match(result.reasons.join(' '), /No players/)
})

test('readiness — not ready with zero rounds', () => {
  const result = computeTripReadiness({ memberCount: 2, ungroupedMemberCount: 0, roundCount: 0 })
  assert.equal(result.ready, false)
  assert.match(result.reasons.join(' '), /No rounds/)
})

test('readiness — not ready with an ungrouped player', () => {
  const result = computeTripReadiness({ memberCount: 2, ungroupedMemberCount: 1, roundCount: 1 })
  assert.equal(result.ready, false)
  assert.match(result.reasons.join(' '), /1 player not yet assigned/)
})

test('readiness — pluralises the ungrouped-player message correctly', () => {
  const result = computeTripReadiness({ memberCount: 3, ungroupedMemberCount: 2, roundCount: 1 })
  assert.match(result.reasons.join(' '), /2 players not yet assigned/)
})

test('readiness — ready when players exist, all grouped, and rounds configured', () => {
  const result = computeTripReadiness({ memberCount: 2, ungroupedMemberCount: 0, roundCount: 1 })
  assert.equal(result.ready, true)
  assert.deepEqual(result.reasons, [])
})

test('readiness — multiple unmet criteria are all reported, not just the first', () => {
  const result = computeTripReadiness({ memberCount: 0, ungroupedMemberCount: 0, roundCount: 0 })
  assert.equal(result.ready, false)
  assert.equal(result.reasons.length, 2)
})
