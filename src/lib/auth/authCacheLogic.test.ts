import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldClearCacheOnAuthEvent, isBfcacheRestore } from './authCacheLogic'

// ── shouldClearCacheOnAuthEvent ─────────────────────────────────────────────

test('SIGNED_OUT always clears the cache, regardless of user IDs', () => {
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_OUT', 'user-a', null), true)
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_OUT', undefined, null), true)
})

test('the very first SIGNED_IN on a fresh page load does not clear the cache (Test Case A: Login User A)', () => {
  // previousUserId is undefined -- no auth event has been observed yet.
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_IN', undefined, 'user-a'), false)
})

test('SIGNED_IN with the same user as before does not clear the cache (e.g. a token refresh re-firing SIGNED_IN)', () => {
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_IN', 'user-a', 'user-a'), false)
})

test('SIGNED_IN with a genuinely different user clears the cache (Test Case B/G: account switch with cache populated)', () => {
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_IN', 'user-a', 'user-b'), true)
})

test('SIGNED_IN after a prior SIGNED_OUT (previousUserId is null, not undefined) does not clear again -- the SIGNED_OUT branch already cleared it', () => {
  assert.equal(shouldClearCacheOnAuthEvent('SIGNED_IN', null, 'user-a'), false)
})

test('repeated account switching (Test Case C: A/B switching 5 times) clears on every genuine switch', () => {
  const sequence: [string, string | null][] = [
    ['SIGNED_IN', 'user-a'],
    ['SIGNED_OUT', null],
    ['SIGNED_IN', 'user-b'],
    ['SIGNED_OUT', null],
    ['SIGNED_IN', 'user-a'],
    ['SIGNED_OUT', null],
    ['SIGNED_IN', 'user-b'],
    ['SIGNED_OUT', null],
    ['SIGNED_IN', 'user-a'],
    ['SIGNED_OUT', null],
  ]
  let previousUserId: string | null | undefined = undefined
  const clearedOnEachStep = sequence.map(([event, currentUserId]) => {
    const cleared = shouldClearCacheOnAuthEvent(event, previousUserId, currentUserId)
    previousUserId = event === 'SIGNED_OUT' ? null : currentUserId
    return cleared
  })
  // Every SIGNED_OUT clears. Every SIGNED_IN here follows a SIGNED_OUT
  // (previousUserId === null), so per the rule above those don't
  // separately clear again -- the SIGNED_OUT already did.
  assert.deepEqual(clearedOnEachStep, [
    false, // first-ever SIGNED_IN
    true,  // SIGNED_OUT
    false, // SIGNED_IN after SIGNED_OUT (already cleared)
    true, false, true, false, true, false, true,
  ])
})

test('other auth events (e.g. TOKEN_REFRESHED) do not clear the cache', () => {
  assert.equal(shouldClearCacheOnAuthEvent('TOKEN_REFRESHED', 'user-a', 'user-a'), false)
  assert.equal(shouldClearCacheOnAuthEvent('USER_UPDATED', 'user-a', 'user-a'), false)
})

// ── isBfcacheRestore ─────────────────────────────────────────────────────────

test('isBfcacheRestore is true when the pageshow event reports persisted', () => {
  assert.equal(isBfcacheRestore({ persisted: true }), true)
})

test('isBfcacheRestore is false for a normal page load', () => {
  assert.equal(isBfcacheRestore({ persisted: false }), false)
})
