import test from 'node:test'
import assert from 'node:assert/strict'
import { findLateMismatches, pendingLateNotices } from './mismatchWarning'
import { statusIndicator, summaryIndicator } from './statusIndicator'
import type { CaptureValue } from './comparison'

const c = (g: number): CaptureValue => ({ grossScore: g, pickedUp: false })
const base = { holeNumbers: [1, 2, 3], myName: 'Alex', partnerName: 'Sam', comparing: true, hasPartner: true,
  mySelf: {}, myMarker: {}, partnerSelf: {}, partnerMarker: {} }

test('no entries / matching entries -> no late notices', () => {
  assert.equal(findLateMismatches(base).length, 0)
  assert.equal(findLateMismatches({ ...base, mySelf: { 1: c(4) }, myMarker: { 1: c(4) } }).length, 0)
})
test('partner entry arrives later and disagrees with my entry -> hole 1 flagged (marker direction)', () => {
  const r = findLateMismatches({ ...base, mySelf: { 1: c(4) }, myMarker: { 1: c(5) } })
  assert.deepEqual(r.map(x => x.holeNumber), [1])
  assert.match(r[0].items[0].golfer, /Alex/)
})
test('two-way: my entry for the partner disagrees with their own -> flagged', () => {
  const r = findLateMismatches({ ...base, partnerSelf: { 2: c(6) }, partnerMarker: { 2: c(5) } })
  assert.deepEqual(r.map(x => x.holeNumber), [2])
  assert.equal(r[0].items[0].golfer, 'Sam')
})
test('waiting (one side only) never warns', () => {
  assert.equal(findLateMismatches({ ...base, mySelf: { 1: c(4) }, partnerMarker: { 2: c(4) } }).length, 0)
})
test('shared-device / paper / individual never compare', () => {
  assert.equal(findLateMismatches({ ...base, comparing: false, mySelf: { 1: c(4) }, myMarker: { 1: c(5) } }).length, 0)
})
test('no partner selected -> partner side ignored', () => {
  assert.equal(findLateMismatches({ ...base, hasPartner: false, partnerSelf: { 2: c(6) }, partnerMarker: { 2: c(5) } }).length, 0)
})
test('current hole excluded; acknowledged excluded; an edited dispute re-announces', () => {
  const a = findLateMismatches({ ...base, mySelf: { 1: c(4), 3: c(4) }, myMarker: { 1: c(5), 3: c(6) } })
  assert.deepEqual(pendingLateNotices(a, 3, new Set()).map(x => x.holeNumber), [1])
  const ack = new Set([a[0].signature])
  assert.deepEqual(pendingLateNotices(a, 2, ack).map(x => x.holeNumber), [3])
  const edited = findLateMismatches({ ...base, mySelf: { 1: c(4) }, myMarker: { 1: c(6) } })
  assert.equal(pendingLateNotices(edited, 2, ack).length, 1)
})
test('picked-up vs number is a mismatch; organiser-resolved is not', () => {
  const r = findLateMismatches({ ...base, mySelf: { 1: { grossScore: null, pickedUp: true } }, myMarker: { 1: c(5) } })
  assert.equal(r.length, 1)
  assert.equal(findLateMismatches({ ...base, mySelf: { 1: { ...c(4), adminOverridden: true } }, myMarker: { 1: c(5) } }).length, 0)
})
test('one indicator mapping: green matched, red mismatch, amber waiting/override; summary uses the same', () => {
  assert.equal(statusIndicator('matched').tone, 'green')
  assert.equal(statusIndicator('mismatch').tone, 'red')
  for (const s of ['pending_marker', 'pending_self', 'resolved_by_organiser'] as const) assert.equal(statusIndicator(s).tone, 'amber')
  assert.equal(summaryIndicator('matched').color, statusIndicator('matched').color)
  assert.equal(summaryIndicator('mismatch').color, statusIndicator('mismatch').color)
  assert.equal(summaryIndicator('awaiting').color, statusIndicator('pending_marker').color)
})
