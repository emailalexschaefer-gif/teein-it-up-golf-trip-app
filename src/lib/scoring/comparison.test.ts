import test from 'node:test'
import assert from 'node:assert/strict'
import { compareCaptures } from './comparison'

test('neither entered -> not_started', () => {
  assert.equal(compareCaptures(null, null), 'not_started')
})

test('self entered, marker not -> pending_marker', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, null), 'pending_marker')
})

test('marker entered, self not -> pending_self', () => {
  assert.equal(compareCaptures(null, { grossScore: 5, pickedUp: false }), 'pending_self')
})

test('both entered, same score -> matched', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: 5, pickedUp: false }), 'matched')
})

test('both entered, different score -> mismatch (the brief\'s worked example)', () => {
  // Alex self-recorded Hole 7: 5. Darren recorded Alex Hole 7: 6.
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: 6, pickedUp: false }), 'mismatch')
})

test('both picked up -> matched, regardless of any stale gross score', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: true }, { grossScore: null, pickedUp: true }), 'matched')
})

test('self picked up, marker entered a numeric score -> mismatch', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: true }, { grossScore: 6, pickedUp: false }), 'mismatch')
})

test('self entered a numeric score, marker picked up -> mismatch', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: null, pickedUp: true }), 'mismatch')
})

test('a capture object with pickedUp false and grossScore null counts as not entered', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: false }, { grossScore: 5, pickedUp: false }), 'pending_self')
})
