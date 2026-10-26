// Profile handicap entry: aligned with the existing -10..54 event rule; plus handicaps enterable; display via the golf helper.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HANDICAP_ENTRY_MIN, HANDICAP_ENTRY_MAX, formatGolfHandicap } from '@/lib/scoring/handicapDisplay'
const here = dirname(fileURLToPath(import.meta.url))
const form = readFileSync(join(here, 'ProfileForm.tsx'), 'utf8')
const root = join(here, '..', '..', '..', '..')
test('range equals the existing event rule (migration 013/015 CHECK and join prompt)', () => {
  assert.equal(HANDICAP_ENTRY_MIN, -10); assert.equal(HANDICAP_ENTRY_MAX, 54)
  assert.match(readFileSync(join(root, 'supabase/migrations/013_playing_handicap_and_join_fix.sql'), 'utf8'), /BETWEEN -10 AND 54/)
})
test('profile input accepts negatives, explains plus handicaps, and uses the shared constants', () => {
  assert.match(form, /min=\{HANDICAP_ENTRY_MIN\} max=\{HANDICAP_ENTRY_MAX\}/)
  assert.doesNotMatch(form, /min=\{0\}/)
  assert.match(form, /Plus handicap\? Enter \\u22122 for a \+2 handicap\./)
  assert.match(form, /formatGolfHandicap\(parseFloat\(hcp\)\)/)
})
test('save validates the same range in code and still stores the typed number unchanged', () => {
  assert.match(form, /handicapVal < HANDICAP_ENTRY_MIN \|\| handicapVal > HANDICAP_ENTRY_MAX/)
  assert.match(form, /handicap: handicapVal,/)
})
test('typed -2 is shown as +2; stored value is untouched', () => {
  assert.equal(formatGolfHandicap(parseFloat('-2')), '+2'); assert.equal(parseFloat('-2'), -2)
  assert.equal(formatGolfHandicap(parseFloat('14.5')), '14.5'); assert.equal(formatGolfHandicap(parseFloat('0')), '0')
})
