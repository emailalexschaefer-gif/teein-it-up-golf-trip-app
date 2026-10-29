import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { FORMATS, selectableFormats, resolveFormatForExistingRound, skinsCompatible, validateSideGameCombination } from './formatRegistry'

test('only Stableford is selectable today; planned formats cannot be enabled silently', () => {
  assert.deepEqual(selectableFormats().map(f => f.id), ['stableford'])
})
test('existing and legacy stored values all resolve to the untouched Stableford path', () => {
  for (const v of ['stableford', null, undefined, '', 'stroke', 'ambrose', 'match_play', 'four_ball_better_ball', 'something_else']) assert.equal(resolveFormatForExistingRound(v as string).id, 'stableford', String(v))
})
test('every stored value used by the registry is allowed by the database CHECK constraint (migration 004)', () => {
  const sql = readFileSync('supabase/migrations/004_scoring.sql', 'utf8')
  for (const f of Object.values(FORMATS)) assert.match(sql, new RegExp(`'${f.storedValue}'`), f.storedValue)
})
test('Skins is a Side Game: compatible with Stableford, refused for team and match formats', () => {
  assert.equal(skinsCompatible(FORMATS.stableford), true)
  assert.equal(validateSideGameCombination(FORMATS.stableford, 'skins').ok, true)
  for (const id of ['ambrose_2', 'ambrose_4', 'singles_match_play', 'four_ball_match_play'] as const) assert.equal(validateSideGameCombination(FORMATS[id], 'skins').ok, false, id)
})
test('individually attributed Side Games stay available for every format', () => {
  for (const f of Object.values(FORMATS)) for (const g of ['nearest_pin', 'longest_drive', 'pros_approach'] as const) assert.equal(validateSideGameCombination(f, g).ok, true)
})
test('the registry is not wired into the application yet (M0 changes no behaviour)', () => {
  const out = execSync("grep -rl \"formats/formatRegistry\" src --include=*.ts --include=*.tsx || true").toString().split('\n').filter(Boolean)
  assert.deepEqual(out.filter(p => !p.includes('src/lib/formats/')), [])
})
test('M2: no Ambrose format is playable or selectable until its scoring AND results paths are approved', () => {
  assert.deepEqual(selectableFormats().map(f => f.id), ['stableford'])
  assert.equal(FORMATS.ambrose_2.status, 'planned'); assert.equal(FORMATS.ambrose_4.status, 'planned')
})
