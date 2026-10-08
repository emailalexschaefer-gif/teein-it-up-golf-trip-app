import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finaliseSideCompWinner, type SideCompEntry, type LeadChange } from './finaliseSideCompWinnerAlgorithm'

function entry(overrides: Partial<SideCompEntry> = {}): SideCompEntry {
  return { id: 'e1', playerId: 'p1', qualified: true, verificationStatus: 'verified', resultValue: 1, ...overrides }
}

// 1. Live completed winner and official finalised winner agree, for a
// non-longest_drive type -- the exact scenario that was previously
// guaranteed broken (no lead changes exist for these types at all, so
// the old algorithm found nothing).
test('1: nearest_pin -- official finalisation picks the same winner the live screen would (best, lowest, qualifying result)', () => {
  const entries = [
    entry({ id: 'e1', playerId: 'alex', resultValue: 0.5 }),
    entry({ id: 'e2', playerId: 'test', resultValue: 1.0 }),
  ]
  const result = finaliseSideCompWinner('nearest_pin', entries, [])
  assert.equal(result.winnerPlayerId, 'alex')
  assert.equal(result.winnerEntryId, 'e1')
})

test("1b: pros_approach -- same agreement, confirming this isn't longest_drive-specific", () => {
  const entries = [
    entry({ id: 'e1', playerId: 'alex', resultValue: 0.5 }),
    entry({ id: 'e2', playerId: 'test', resultValue: 1.0 }),
  ]
  const result = finaliseSideCompWinner('pros_approach', entries, [])
  assert.equal(result.winnerPlayerId, 'alex')
})

// 2. Multiple lead changes do not cause a later but worse NTP/Pro's
// Approach result to incorrectly become official -- modelled here as
// "a later-submitted (in insertion order) but worse result must never
// beat an earlier but better one," since value-based types are never
// ordered by submission time at all, only by result value.
test('2: a later-submitted but worse result never beats an earlier but better one', () => {
  const entries = [
    entry({ id: 'early-good', playerId: 'alex', resultValue: 0.3 }),
    entry({ id: 'later-worse', playerId: 'dave', resultValue: 2.5 }),
  ]
  const result = finaliseSideCompWinner('nearest_pin', entries, [])
  assert.equal(result.winnerPlayerId, 'alex')
  assert.equal(result.winnerEntryId, 'early-good')
})

// 3. Qualification/verification requirements remain respected.
test('3a: an unqualified entry is never selected, even with the best result_value', () => {
  const entries = [
    entry({ id: 'e1', playerId: 'alex', resultValue: 0.1, qualified: false }),
    entry({ id: 'e2', playerId: 'test', resultValue: 2.0, qualified: true }),
  ]
  const result = finaliseSideCompWinner('nearest_pin', entries, [])
  assert.equal(result.winnerPlayerId, 'test')
})

test('3b: an unverified (pending/rejected) entry is never selected, even with the best result_value', () => {
  const entries = [
    entry({ id: 'e1', playerId: 'alex', resultValue: 0.1, verificationStatus: 'pending' }),
    entry({ id: 'e2', playerId: 'dave', resultValue: 0.2, verificationStatus: 'rejected' }),
    entry({ id: 'e3', playerId: 'test', resultValue: 2.0, verificationStatus: 'verified' }),
  ]
  const result = finaliseSideCompWinner('nearest_pin', entries, [])
  assert.equal(result.winnerPlayerId, 'test')
})

// 4. longest_drive behaviour remains correct, including the fix for
// the subtler pre-existing gap: an unqualified/unverified MOST RECENT
// lead change must be skipped in favour of the next valid one, not
// treated as having no winner at all.
test('4a: longest_drive -- the most recent qualifying lead change wins', () => {
  const entries = [entry({ id: 'e1', playerId: 'alex' }), entry({ id: 'e2', playerId: 'dave' })]
  const leadChanges: LeadChange[] = [
    { playerId: 'dave', sequenceNumber: 1 },
    { playerId: 'alex', sequenceNumber: 2 },
  ]
  const result = finaliseSideCompWinner('longest_drive', entries, leadChanges)
  assert.equal(result.winnerPlayerId, 'alex')
})

test('4b: longest_drive -- an unverified most-recent lead change is skipped in favour of the next valid one, never producing no winner when a valid earlier one exists', () => {
  const entries = [
    entry({ id: 'e1', playerId: 'alex', verificationStatus: 'verified' }),
    entry({ id: 'e2', playerId: 'dave', verificationStatus: 'pending' }), // most recent, but not yet verified
  ]
  const leadChanges: LeadChange[] = [
    { playerId: 'alex', sequenceNumber: 1 },
    { playerId: 'dave', sequenceNumber: 2 },
  ]
  const result = finaliseSideCompWinner('longest_drive', entries, leadChanges)
  assert.equal(result.winnerPlayerId, 'alex')
})

// 5. No valid result produces no winner -- never fabricated.
test('5a: no qualifying entries at all -> no winner', () => {
  const entries = [entry({ qualified: false }), entry({ id: 'e2', verificationStatus: 'pending' })]
  const result = finaliseSideCompWinner('nearest_pin', entries, [])
  assert.equal(result.winnerPlayerId, null)
  assert.equal(result.winnerEntryId, null)
})

test('5b: longest_drive with no lead changes at all -> no winner', () => {
  const result = finaliseSideCompWinner('longest_drive', [entry()], [])
  assert.equal(result.winnerPlayerId, null)
})

test('5c: powerplay never produces a winner via this path, matching the live screen', () => {
  const result = finaliseSideCompWinner('powerplay', [entry({ resultValue: 0.1 })], [])
  assert.equal(result.winnerPlayerId, null)
})

// 6. Existing Side Game tests remain passing -- confirmed by the full
// fresh suite run in the delivery report (this is not itself a new
// test; the assertion lives in the full-suite result, not here).
