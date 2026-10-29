import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeGolden } from './goldenCases'

// M0 guard: the individual Stableford path must not change while new formats are added.
const frozen = JSON.parse(readFileSync('src/lib/scoring/golden/stableford.golden.json', 'utf8'))
const now = JSON.parse(JSON.stringify(computeGolden()))

for (const key of Object.keys(frozen)) {
  test(`golden: ${key} unchanged`, () => { assert.deepEqual(now[key], frozen[key]) })
}
test('golden: no new sections added without regenerating the fixture on purpose', () => {
  assert.deepEqual(Object.keys(now).sort(), Object.keys(frozen).sort())
})
