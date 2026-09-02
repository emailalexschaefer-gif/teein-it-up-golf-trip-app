import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidUserIntent, sanitizeOrganiserTypes } from './userIntent'

test('isValidUserIntent — accepts exactly player, organiser, both', () => {
  assert.equal(isValidUserIntent('player'), true)
  assert.equal(isValidUserIntent('organiser'), true)
  assert.equal(isValidUserIntent('both'), true)
})

test('isValidUserIntent — rejects anything else, including near-misses', () => {
  assert.equal(isValidUserIntent('Player'), false) // case-sensitive
  assert.equal(isValidUserIntent('admin'), false) // must never be confusable with app_role's values
  assert.equal(isValidUserIntent(''), false)
  assert.equal(isValidUserIntent(null), false)
  assert.equal(isValidUserIntent(undefined), false)
  assert.equal(isValidUserIntent(123), false)
})

test('sanitizeOrganiserTypes — player always resolves to null, regardless of what was sent', () => {
  assert.equal(sanitizeOrganiserTypes('player', ['golf_trips']), null)
  assert.equal(sanitizeOrganiserTypes('player', ['corporate', 'other']), null)
})

test('sanitizeOrganiserTypes — organiser/both keep only recognised values', () => {
  assert.deepEqual(sanitizeOrganiserTypes('organiser', ['golf_trips', 'corporate']), ['golf_trips', 'corporate'])
  assert.deepEqual(sanitizeOrganiserTypes('both', ['social_golf']), ['social_golf'])
})

test('sanitizeOrganiserTypes — an unknown value is silently dropped, not rejected outright', () => {
  assert.deepEqual(sanitizeOrganiserTypes('organiser', ['golf_trips', 'made_up_value']), ['golf_trips'])
})

test('sanitizeOrganiserTypes — an entirely empty or invalid input resolves to null, not an empty array', () => {
  assert.equal(sanitizeOrganiserTypes('organiser', []), null)
  assert.equal(sanitizeOrganiserTypes('organiser', ['made_up_value']), null)
  assert.equal(sanitizeOrganiserTypes('organiser', 'not-an-array'), null)
  assert.equal(sanitizeOrganiserTypes('organiser', null), null)
})

test('sanitizeOrganiserTypes — "other" is a genuinely valid, first-class option', () => {
  assert.deepEqual(sanitizeOrganiserTypes('both', ['other']), ['other'])
})
