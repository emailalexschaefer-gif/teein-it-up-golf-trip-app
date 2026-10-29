import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambroseCloseVerdict } from './closeGate'

const e = (name: string, complete: boolean | undefined, withdrawn = false) => ({ name, withdrawn, completion: complete === undefined ? null : { complete } })
test('closes only when every live team is complete', () => {
  assert.equal(ambroseCloseVerdict([e('A', true), e('B', true)]).ok, true)
  const v = ambroseCloseVerdict([e('A', true), e('B', false)])
  assert.equal(v.ok, false); assert.deepEqual(v.incomplete, ['B']); assert.match(v.reason!, /B/)
})
test('fails safe: no teams, or no database answer, blocks the close', () => {
  assert.equal(ambroseCloseVerdict([]).ok, false)
  assert.equal(ambroseCloseVerdict([e('A', undefined)]).ok, false)
})
test('a withdrawn team does not block the close, but all-withdrawn does', () => {
  assert.equal(ambroseCloseVerdict([e('A', true), e('W', false, true)]).ok, true)
  assert.equal(ambroseCloseVerdict([e('W', true, true)]).ok, false)
})
