import test from 'node:test'
import assert from 'node:assert/strict'
import { generateMarkerAssignments } from './markerAssignment'
import { ScoringDomainError } from './errors'

test('2 players: mutual pair', () => {
  const result = generateMarkerAssignments(['alex', 'darren'])
  const byPlayer = Object.fromEntries(result.map(r => [r.playerId, r.markerPlayerId]))
  assert.equal(byPlayer['alex'], 'darren')
  assert.equal(byPlayer['darren'], 'alex')
})

test('4 players: two mutual pairs in given order', () => {
  const result = generateMarkerAssignments(['alex', 'darren', 'marnie', 'sam'])
  const byPlayer = Object.fromEntries(result.map(r => [r.playerId, r.markerPlayerId]))
  assert.equal(byPlayer['alex'], 'darren')
  assert.equal(byPlayer['darren'], 'alex')
  assert.equal(byPlayer['marnie'], 'sam')
  assert.equal(byPlayer['sam'], 'marnie')
})

test('3 players: circular assignment matching the brief exactly', () => {
  const result = generateMarkerAssignments(['alex', 'darren', 'sam'])
  const byPlayer = Object.fromEntries(result.map(r => [r.playerId, r.markerPlayerId]))
  // Alex marks Darren, Darren marks Sam, Sam marks Alex
  assert.equal(byPlayer['darren'], 'alex')
  assert.equal(byPlayer['sam'], 'darren')
  assert.equal(byPlayer['alex'], 'sam')
})

test('every player has exactly one marker, and nobody marks themselves', () => {
  for (const group of [['a','b'], ['a','b','c'], ['a','b','c','d'], ['a','b','c','d','e']]) {
    const result = generateMarkerAssignments(group)
    assert.equal(result.length, group.length)
    const playersCovered = new Set(result.map(r => r.playerId))
    assert.equal(playersCovered.size, group.length)
    for (const r of result) assert.notEqual(r.playerId, r.markerPlayerId)
  }
})

test('6 players: three mutual pairs', () => {
  const result = generateMarkerAssignments(['a','b','c','d','e','f'])
  const byPlayer = Object.fromEntries(result.map(r => [r.playerId, r.markerPlayerId]))
  assert.equal(byPlayer['a'], 'b'); assert.equal(byPlayer['b'], 'a')
  assert.equal(byPlayer['c'], 'd'); assert.equal(byPlayer['d'], 'c')
  assert.equal(byPlayer['e'], 'f'); assert.equal(byPlayer['f'], 'e')
})

test('duplicate player id throws', () => {
  assert.throws(
    () => generateMarkerAssignments(['a', 'b', 'a']),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'DUPLICATE_PLAYER_ID'
  )
})

test('fewer than 2 players throws', () => {
  assert.throws(
    () => generateMarkerAssignments(['a']),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'WRONG_PLAYER_COUNT'
  )
})
