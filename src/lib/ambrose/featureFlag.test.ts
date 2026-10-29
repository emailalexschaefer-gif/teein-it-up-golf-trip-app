import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambroseEnabled, ambroseEnabledForTrip, ambroseRestrictedToTrips, parseTripAllowlist } from './featureFlag'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

test('Ambrose is off unless explicitly enabled', () => {
  assert.equal(ambroseEnabled(undefined, undefined), false)
  assert.equal(ambroseEnabled('', undefined), false)
  assert.equal(ambroseEnabled('1', undefined), false)
  assert.equal(ambroseEnabled('TRUE', undefined), false)
  assert.equal(ambroseEnabled('true', undefined), true)
  assert.equal(ambroseEnabled('true', 'staging'), true)
})
test('Ambrose stays off in production even if the flag is set, unless trips are explicitly listed', () => {
  assert.equal(ambroseEnabled('true', 'production'), false)
  assert.equal(ambroseEnabled('true', 'production', ''), false)
  assert.equal(ambroseEnabled('true', 'production', 'not-a-uuid, 123'), false)
  assert.equal(ambroseEnabled('true', 'production', A), true)
  assert.equal(ambroseEnabled(undefined, 'production', A), false)   // the flag is still required
  assert.equal(ambroseEnabled('false', 'production', A), false)
})
test('the default (no env set in the test process) is off', () => {
  if (process.env.NEXT_PUBLIC_AMBROSE_ENABLED === undefined) {
    assert.equal(ambroseEnabled(), false)
    assert.equal(ambroseEnabledForTrip(A), false)
  }
})
test('allowlist parsing ignores anything that is not a well-formed UUID and is case/space tolerant', () => {
  const s = parseTripAllowlist(` ${A.toUpperCase()} , ,junk,${B},${B}x,*`)
  assert.deepEqual([...s].sort(), [A, B].sort())
  assert.equal(parseTripAllowlist(undefined).size, 0)
  assert.equal(parseTripAllowlist('*').size, 0)               // no wildcard
  assert.equal(parseTripAllowlist('all').size, 0)
})
test('non-production: on for every event when flagged; off when not', () => {
  assert.equal(ambroseEnabledForTrip(A, 'true', 'staging'), true)
  assert.equal(ambroseEnabledForTrip(A, 'true', undefined), true)
  assert.equal(ambroseEnabledForTrip(A, undefined, 'staging'), false)
  assert.equal(ambroseEnabledForTrip(null, 'true', 'staging'), true)
})
test('production: only the listed events; never when the flag is off; never for a missing trip id', () => {
  assert.equal(ambroseEnabledForTrip(A, 'true', 'production', A), true)
  assert.equal(ambroseEnabledForTrip(B, 'true', 'production', A), false)
  assert.equal(ambroseEnabledForTrip(A.toUpperCase(), 'true', 'production', A), true)
  assert.equal(ambroseEnabledForTrip(undefined, 'true', 'production', A), false)
  assert.equal(ambroseEnabledForTrip(null, 'true', 'production', A), false)
  assert.equal(ambroseEnabledForTrip('', 'true', 'production', A), false)
  assert.equal(ambroseEnabledForTrip(A, 'true', 'production', undefined), false)
  assert.equal(ambroseEnabledForTrip(A, 'true', 'production', ''), false)
  assert.equal(ambroseEnabledForTrip(A, 'true', 'production', '*'), false)
  assert.equal(ambroseEnabledForTrip(A, undefined, 'production', A), false)
  assert.equal(ambroseEnabledForTrip(A, 'false', 'production', A), false)
  assert.equal(ambroseEnabledForTrip(B, 'true', 'production', `${A},${B}`), true)
})
test('a listed set of events restricts Ambrose whatever the environment is called (including an unset environment name)', () => {
  assert.equal(ambroseEnabledForTrip(A, 'true', undefined, A), true)
  assert.equal(ambroseEnabledForTrip(B, 'true', undefined, A), false)   // unset APP_ENV in production must NOT open it to every event
  assert.equal(ambroseEnabledForTrip(B, 'true', 'staging', A), false)
  assert.equal(ambroseEnabledForTrip(A, 'true', 'staging', A), true)
  assert.equal(ambroseEnabled('true', undefined, A), true)
  assert.equal(ambroseEnabled('true', 'production', A), true)
  assert.equal(ambroseEnabled('true', 'production', undefined), false)
  assert.equal(ambroseRestrictedToTrips(A), true); assert.equal(ambroseRestrictedToTrips('junk'), false); assert.equal(ambroseRestrictedToTrips(undefined), false)
})
