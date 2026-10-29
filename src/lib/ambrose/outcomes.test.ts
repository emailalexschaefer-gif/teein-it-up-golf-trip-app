import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyOutcome } from './outcomes'

test('EVERY outcome the proposed SQL can return is understood (none falls through to the 502 "unexpected answer")', () => {
  const sql = readFileSync('docs/package4-m1/PROPOSED_104_competition_teams.sql', 'utf8')
  const found = [...new Set([...sql.matchAll(/'outcome','([a-z_]+)'/g)].map(m => m[1]))]
  assert.ok(found.length >= 35, `only found ${found.length}`)
  const unknown = found.filter(o => classifyOutcome(o).http === 502)
  assert.deepEqual(unknown, [])
})
test('setup successes are 200; setup refusals are 4xx with a plain message', () => {
  for (const o of ['created', 'saved', 'configured']) assert.equal(classifyOutcome(o).http, 200, o)
  for (const o of ['scoring_started', 'duplicate_name', 'player_in_other_team', 'not_configured', 'team_not_in_event', 'wrong_team_size', 'not_trip_member', 'group_not_in_event', 'method_mismatch', 'roster_mismatch']) {
    const i = classifyOutcome(o); assert.ok(i.http >= 400 && i.http < 500, o); assert.ok(i.message.length > 10, o)
  }
})
test("'locked' always means the organiser has set the hole; a locked handicap answers 'handicap_locked' (success)", () => {
  assert.equal(classifyOutcome('locked').disposition, 'locked')
  assert.equal(classifyOutcome('handicap_locked').disposition, 'synced'); assert.equal(classifyOutcome('handicap_locked').http, 200)
})
test('a genuinely unknown outcome is still refused', () => {
  assert.equal(classifyOutcome('banana').http, 502); assert.equal(classifyOutcome(undefined).http, 502)
})
