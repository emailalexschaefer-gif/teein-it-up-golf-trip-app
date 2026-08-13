import test from 'node:test'
import assert from 'node:assert/strict'
import { groupSideCompsByRound, toWizardSideCompPrefill } from './sideCompRoundTrip'

// ── groupSideCompsByRound ────────────────────────────────────────────────────
// This is the function that replaced the fragile 3-level nested
// PostgREST embed (trips -> rounds -> side_comps) which was the
// suspected — and most plausible, after exhaustive tracing of every
// other layer found nothing — cause of side competitions vanishing from
// Edit Trip after being configured and saved.

test('groupSideCompsByRound — repeated same-type comps on one round remain separate, never collapsed by comp_type', () => {
  const rows = [
    { id: 'a', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 12, enabled: true },
  ]
  const grouped = groupSideCompsByRound(rows)
  assert.equal(grouped.get('r1')?.length, 2)
  assert.deepEqual(grouped.get('r1')?.map(c => c.hole_number).sort((a, b) => (a ?? 0) - (b ?? 0)), [3, 12])
})

test('groupSideCompsByRound — multiple Powerplays on one round remain separate', () => {
  const rows = [
    { id: 'a', round_id: 'r1', comp_type: 'powerplay', hole_number: 6, enabled: true },
    { id: 'b', round_id: 'r1', comp_type: 'powerplay', hole_number: 18, enabled: true },
  ]
  const grouped = groupSideCompsByRound(rows)
  assert.equal(grouped.get('r1')?.length, 2)
})

test('groupSideCompsByRound — this brief\'s exact five-instance example round-trips completely: NTP x2, Longest Drive, Powerplay x2', () => {
  const rows = [
    { id: 'a', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 12, enabled: true },
    { id: 'c', round_id: 'r1', comp_type: 'longest_drive', hole_number: 7, enabled: true },
    { id: 'd', round_id: 'r1', comp_type: 'powerplay', hole_number: 5, enabled: true },
    { id: 'e', round_id: 'r1', comp_type: 'powerplay', hole_number: 16, enabled: true },
  ]
  const grouped = groupSideCompsByRound(rows)
  assert.equal(grouped.get('r1')?.length, 5) // all five, none collapsed or dropped
  assert.equal(grouped.get('r1')?.filter(c => c.comp_type === 'nearest_pin').length, 2)
  assert.equal(grouped.get('r1')?.filter(c => c.comp_type === 'powerplay').length, 2)
})

test('groupSideCompsByRound — different rounds never mix, even with identical comp_type/hole_number pairs', () => {
  const rows = [
    { id: 'a', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', round_id: 'r2', comp_type: 'nearest_pin', hole_number: 3, enabled: true }, // same type/hole, different round
  ]
  const grouped = groupSideCompsByRound(rows)
  assert.equal(grouped.get('r1')?.length, 1)
  assert.equal(grouped.get('r2')?.length, 1)
  assert.notEqual(grouped.get('r1')?.[0].id, grouped.get('r2')?.[0].id)
})

test('groupSideCompsByRound — a round with zero side comps configured produces no entry (not an empty array vs. missing distinction issue downstream, since callers use ?? [])', () => {
  const grouped = groupSideCompsByRound([])
  assert.equal(grouped.get('any-round-id'), undefined)
})

test('groupSideCompsByRound — round_id is not present on the grouped output (already implied by the grouping itself)', () => {
  const rows = [{ id: 'a', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 3, enabled: true }]
  const grouped = groupSideCompsByRound(rows)
  assert.equal('round_id' in (grouped.get('r1')?.[0] ?? {}), false)
})

// ── toWizardSideCompPrefill ──────────────────────────────────────────────────
// The exact transformation applied when building Edit Trip's prefill
// payload — this is specifically what a fixed readback layer must still
// pass correctly onward into the wizard.

test('toWizardSideCompPrefill — multiple instances of the same comp_type all survive into the wizard prefill', () => {
  const comps = [
    { id: 'a', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', comp_type: 'nearest_pin', hole_number: 12, enabled: true },
  ]
  const result = toWizardSideCompPrefill(comps)
  assert.equal(result.length, 2)
})

test('toWizardSideCompPrefill — the full five-instance repro case survives end to end (grouping + prefill together)', () => {
  const rows = [
    { id: 'a', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', round_id: 'r1', comp_type: 'nearest_pin', hole_number: 12, enabled: true },
    { id: 'c', round_id: 'r1', comp_type: 'longest_drive', hole_number: 7, enabled: true },
    { id: 'd', round_id: 'r1', comp_type: 'powerplay', hole_number: 5, enabled: true },
    { id: 'e', round_id: 'r1', comp_type: 'powerplay', hole_number: 16, enabled: true },
  ]
  const grouped = groupSideCompsByRound(rows)
  const prefill = toWizardSideCompPrefill(grouped.get('r1') ?? [])
  assert.equal(prefill.length, 5)
  assert.deepEqual(prefill.map(c => c.hole_number).sort((a, b) => a - b), [3, 5, 7, 12, 16])
})

test('toWizardSideCompPrefill — a disabled comp is excluded (matches the same "enabled only" rule the scoring/holes API applies)', () => {
  const comps = [
    { id: 'a', comp_type: 'nearest_pin', hole_number: 3, enabled: true },
    { id: 'b', comp_type: 'nearest_pin', hole_number: 5, enabled: false },
  ]
  const result = toWizardSideCompPrefill(comps)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'a')
})

test('toWizardSideCompPrefill — a row with a null hole_number is excluded, not passed through as an invalid wizard entry', () => {
  const comps = [{ id: 'a', comp_type: 'nearest_pin', hole_number: null, enabled: true }]
  const result = toWizardSideCompPrefill(comps)
  assert.equal(result.length, 0)
})

test('toWizardSideCompPrefill — an unrecognised comp_type (e.g. the old dormant "best_on_day"/"custom" values) is excluded, not silently carried into the current wizard model', () => {
  const comps = [
    { id: 'a', comp_type: 'best_on_day', hole_number: 3, enabled: true },
    { id: 'b', comp_type: 'nearest_pin', hole_number: 5, enabled: true },
  ]
  const result = toWizardSideCompPrefill(comps)
  assert.equal(result.length, 1)
  assert.equal(result[0].comp_type, 'nearest_pin')
})

test('toWizardSideCompPrefill — an empty input produces an empty prefill, not an error', () => {
  assert.deepEqual(toWizardSideCompPrefill([]), [])
})
