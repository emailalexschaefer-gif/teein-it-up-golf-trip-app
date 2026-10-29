import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handicapsOptionalForRound } from './handicapPolicy'

const db = (res: { data: { handicap_method?: string } | null; error: unknown } | 'throw') => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { if (res === 'throw') throw new Error('x'); return res } }) }) }) })
test('handicaps become optional only for a gross_only Ambrose round with the flag on', async () => {
  assert.equal(await handicapsOptionalForRound(db({ data: { handicap_method: 'gross_only' }, error: null }), 'r', true), true)
})
test('every other case keeps handicaps REQUIRED (fail closed)', async () => {
  assert.equal(await handicapsOptionalForRound(db({ data: { handicap_method: 'gross_only' }, error: null }), 'r', false), false, 'flag off')
  for (const m of ['organiser_entered', 'club_divisor', 'weighted_scramble']) assert.equal(await handicapsOptionalForRound(db({ data: { handicap_method: m }, error: null }), 'r', true), false, m)
  assert.equal(await handicapsOptionalForRound(db({ data: null, error: null }), 'r', true), false, 'not an Ambrose round')
  assert.equal(await handicapsOptionalForRound(db({ data: { handicap_method: 'gross_only' }, error: { code: 'x' } }), 'r', true), false, 'read error')
  assert.equal(await handicapsOptionalForRound(db('throw'), 'r', true), false, 'exception')
})
