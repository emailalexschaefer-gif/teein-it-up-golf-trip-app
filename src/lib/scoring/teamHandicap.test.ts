import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTeamHandicap, DEFAULT_HANDICAP_ALLOWANCES } from './teamHandicap'
import { ScoringDomainError } from './errors'

test('two-player Ambrose: [10, 18] → 7', () => {
  const result = calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [10, 18] })
  assert.equal(result.combinedHandicap, 28)
  assert.equal(result.allowance, 0.25)
  assert.equal(result.unroundedHandicap, 7)
  assert.equal(result.finalHandicap, 7)
  assert.equal(result.format, 'two_player_ambrose')
})

test('four-player Ambrose: [8, 12, 16, 20] → 7', () => {
  const result = calculateTeamHandicap({ format: 'four_player_ambrose', playerHandicaps: [8, 12, 16, 20] })
  assert.equal(result.combinedHandicap, 56)
  assert.equal(result.allowance, 0.125)
  assert.equal(result.finalHandicap, 7)
})

test('alternate shot: [8, 16] → 12', () => {
  const result = calculateTeamHandicap({ format: 'alternate_shot', playerHandicaps: [8, 16] })
  assert.equal(result.combinedHandicap, 24)
  assert.equal(result.allowance, 0.5)
  assert.equal(result.finalHandicap, 12)
})

test('optional allowance override', () => {
  const result = calculateTeamHandicap({
    format: 'two_player_ambrose',
    playerHandicaps: [10, 18],
    allowances: { twoPlayerAmbrose: 0.3 },
  })
  assert.equal(result.allowance, 0.3)
  assert.equal(result.unroundedHandicap, 28 * 0.3)
  assert.equal(result.finalHandicap, Math.round(28 * 0.3))
  // Defaults for other formats are untouched by a partial override
  assert.equal(DEFAULT_HANDICAP_ALLOWANCES.fourPlayerAmbrose, 0.125)
})

test('decimal result rounds per the project rounding rule', () => {
  // combined 27 × 0.25 = 6.75 → rounds to 7
  const result = calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [9, 18] })
  assert.equal(result.unroundedHandicap, 6.75)
  assert.equal(result.finalHandicap, 7)
})

test('wrong player count throws a typed error', () => {
  assert.throws(
    () => calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [10, 18, 5] }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'WRONG_PLAYER_COUNT'
  )
  assert.throws(
    () => calculateTeamHandicap({ format: 'four_player_ambrose', playerHandicaps: [10, 18] }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'WRONG_PLAYER_COUNT'
  )
  assert.throws(
    () => calculateTeamHandicap({ format: 'alternate_shot', playerHandicaps: [10] }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'WRONG_PLAYER_COUNT'
  )
})

test('empty team throws a typed error', () => {
  assert.throws(
    () => calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [] }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'EMPTY_TEAM'
  )
})

test('missing handicap (NaN in the array) throws a typed error', () => {
  assert.throws(
    () => calculateTeamHandicap({ format: 'two_player_ambrose', playerHandicaps: [10, NaN] }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'MISSING_HANDICAP'
  )
})

test('duplicate player id on the same team throws a typed error', () => {
  assert.throws(
    () => calculateTeamHandicap({
      format: 'two_player_ambrose',
      playerHandicaps: [10, 18],
      playerIds: ['player-1', 'player-1'],
    }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'DUPLICATE_PLAYER_ID'
  )
})

test('distinct player ids do not throw', () => {
  assert.doesNotThrow(() => calculateTeamHandicap({
    format: 'two_player_ambrose',
    playerHandicaps: [10, 18],
    playerIds: ['player-1', 'player-2'],
  }))
})
