import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambroseLegacyScoreBlock, AMBROSE_LEGACY_BLOCK } from './legacyScoreGuard'

let queries = 0
const db = (res: { data: { format?: string } | null; error: unknown } | 'throw') => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { queries++; if (res === 'throw') throw new Error('x'); return res } }) }) }) })
test('an Ambrose round (flag on) refuses individual score writes with 409', async () => {
  const b = await ambroseLegacyScoreBlock(db({ data: { format: 'ambrose_4' }, error: null }), 'r', true)
  assert.equal(b, AMBROSE_LEGACY_BLOCK); assert.equal(b!.status, 409); assert.equal(b!.body.code, 'ambrose_round')
})
test('ordinary Stableford rounds are never blocked', async () => {
  assert.equal(await ambroseLegacyScoreBlock(db({ data: null, error: null }), 'r', true), null, 'no Ambrose config')
  assert.equal(await ambroseLegacyScoreBlock(db({ data: { format: 'ambrose_2' }, error: { code: '42P01' } }), 'r', true), null, 'read error never blocks')
  assert.equal(await ambroseLegacyScoreBlock(db('throw'), 'r', true), null, 'exception never blocks')
})
test('flag off: no query at all and nothing blocked (production behaviour unchanged)', async () => {
  queries = 0
  assert.equal(await ambroseLegacyScoreBlock(db({ data: { format: 'ambrose_4' }, error: null }), 'r', false), null)
  assert.equal(queries, 0)
})
