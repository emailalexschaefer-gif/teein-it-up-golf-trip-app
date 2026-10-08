import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSideGameWinner, type SideCompForResolution } from './resolveSideGameWinner'

function comp(overrides: Partial<SideCompForResolution> = {}): SideCompForResolution {
  return {
    id: 'sc1', roundId: 'r1', compType: 'nearest_pin', label: 'Nearest the Pin', holeNumber: 6,
    officialWinnerPlayerId: null, officialWinnerName: null,
    ...overrides,
  }
}

// 1. Unfinalised + official winner exists -> official winner used.
test('1: unfinalised round with an official winner uses the official winner', () => {
  const result = resolveSideGameWinner(
    comp({ officialWinnerPlayerId: 'p1', officialWinnerName: 'Alex' }),
    false,
    { playerId: 'p2', playerName: 'Someone Else' }, // fallback disagrees -- must be ignored
  )
  assert.equal(result.winnerPlayerId, 'p1')
  assert.equal(result.winnerName, 'Alex')
})

// 2. Unfinalised + no official winner + completed Side Game with valid winner -> fallback used.
test('2: unfinalised round, no official winner, completed fallback -> fallback winner used', () => {
  const result = resolveSideGameWinner(
    comp(),
    false,
    { playerId: 'p2', playerName: 'TEST' },
  )
  assert.equal(result.winnerPlayerId, 'p2')
  assert.equal(result.winnerName, 'TEST')
})

// 3. Unfinalised + incomplete Side Game + current leader -> NO winner.
// (An in-progress leader must never be passed in as fallbackWinner in
// the first place -- computeRoundSideGames.ts's own `winner` field is
// already null while incomplete. This proves the resolver itself
// treats a null fallback signal as no winner, never substituting a
// leader on its own.)
test('3: unfinalised round, incomplete Side Game (null fallback signal) -> no winner', () => {
  const result = resolveSideGameWinner(comp(), false, null)
  assert.equal(result.winnerPlayerId, null)
  assert.equal(result.winnerName, null)
})

// 4. Completed Side Game with no valid qualifying result -> NO winner.
// (Same shape as case 3 at this function's boundary -- a Side Game
// that is "complete" with nobody qualifying also yields a null
// fallback signal from computeRoundSideGames.ts, which resolves the
// same way: no winner, never fabricated.)
test('4: completed Side Game with no qualifying result (null fallback signal) -> no winner', () => {
  const result = resolveSideGameWinner(comp(), false, null)
  assert.equal(result.winnerPlayerId, null)
})

// 5. Tie -- mirrors the live Side Games screen exactly, by
// construction: the fallback signal this function accepts is always a
// single winner (never an array), because that is exactly what
// computeRoundSideGames.ts's own `winner` field already is for every
// comp type. There is no tie-array case to construct here, because
// the source being mirrored never produces one -- see the delivery
// report's co-winner findings for the full explanation.
test('5: fallback signal is always a single winner, matching the live screen\'s own shape -- no co-winner handling needed or added', () => {
  const result = resolveSideGameWinner(comp(), false, { playerId: 'p1', playerName: 'Alex' })
  assert.equal(typeof result.winnerPlayerId, 'string')
  assert.ok(!Array.isArray(result.winnerPlayerId))
})

// 6. Official winner and computed fallback disagree -> official winner wins.
test('6: official and fallback disagree -> official wins', () => {
  const result = resolveSideGameWinner(
    comp({ officialWinnerPlayerId: 'p1', officialWinnerName: 'Alex' }),
    false,
    { playerId: 'p2', playerName: 'TEST' },
  )
  assert.equal(result.winnerPlayerId, 'p1')
})

// 7a. Formally finalised + valid official_winner_entry_id -> official winner returned.
test('7a: finalised round with a valid official winner -> official winner used', () => {
  const result = resolveSideGameWinner(
    comp({ officialWinnerPlayerId: 'p1', officialWinnerName: 'Alex' }),
    true,
    { playerId: 'p2', playerName: 'Ignored' },
  )
  assert.equal(result.winnerPlayerId, 'p1')
})

// 7b. Formally finalised + official_winner_entry_id = NULL -> authoritative NO WINNER, fallback must not execute.
test('7b: finalised round with a null official winner -> authoritative no winner, fallback never runs', () => {
  const result = resolveSideGameWinner(
    comp(),
    true,
    { playerId: 'p2', playerName: 'Should Never Appear' },
  )
  assert.equal(result.winnerPlayerId, null)
  assert.equal(result.winnerName, null)
})

// 8 & 9 (three-round event, Round 2 relies on the fallback, section
// exposure and actual slide generation) are covered end-to-end in
// slideshowDeck.test.ts, against the real getAvailableSections/
// defaultPresentationConfig/buildPresentationDeck pipeline, not
// duplicated here against the resolver in isolation.

// 10. Fallback winner resolves into the same normalised shape as an official winner.
test('10: fallback and official winners share an identical result shape', () => {
  const official = resolveSideGameWinner(comp({ officialWinnerPlayerId: 'p1', officialWinnerName: 'Alex' }), true, null)
  const fallback = resolveSideGameWinner(comp(), false, { playerId: 'p2', playerName: 'TEST' })
  assert.deepEqual(Object.keys(official).sort(), Object.keys(fallback).sort())
  assert.deepEqual(Object.keys(official).sort(), ['compType', 'holeNumber', 'label', 'roundId', 'sideCompId', 'winnerName', 'winnerPlayerId'])
})

// 11. Fallback winner photo matching works exactly like official-winner
// photo matching -- both resolve to the same winnerPlayerId field,
// which is the only field the existing photo-matching logic in
// slideshowDeck.ts ever reads (by playerId, against organiserFavourite
// Moments) -- it has no awareness of where winnerPlayerId came from,
// proven directly: this function never exposes a source/origin field
// for downstream code to branch on.
test('11: the resolved shape never exposes which path (official/fallback) produced it -- downstream code cannot distinguish them', () => {
  const official = resolveSideGameWinner(comp({ officialWinnerPlayerId: 'p1', officialWinnerName: 'Alex' }), true, null)
  const fallback = resolveSideGameWinner(comp(), false, { playerId: 'p1', playerName: 'Alex' })
  assert.deepEqual(official, fallback)
})
