import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTripId, makeTripAllowed } from './tripGate'
import { ambroseEnabledForTrip } from './featureFlag'

const TRIP = '11111111-1111-4111-8111-111111111111'
type Tables = Record<string, Record<string, Record<string, unknown>>>
const fake = (t: Tables, calls: string[] = [], boom = false) => ({
  from: (table: string) => ({ select: (_c: string) => ({ eq: (_col: string, id: string) => ({ maybeSingle: async () => {
    calls.push(table); if (boom) throw new Error('db down')
    const row = t[table]?.[id]; return { data: row ?? null, error: null } } }) }) }),
})
const data: Tables = {
  rounds: { r1: { trip_id: TRIP } },
  round_team_entries: { e1: { round_id: 'r1' } },
  team_score_flags: { f1: { entry_id: 'e1' } },
}

test('resolves the event from a trip, round, entry or flag', async () => {
  assert.equal(await resolveTripId(fake(data), { tripId: TRIP }), TRIP)
  assert.equal(await resolveTripId(fake(data), { roundId: 'r1' }), TRIP)
  assert.equal(await resolveTripId(fake(data), { entryId: 'e1' }), TRIP)
  assert.equal(await resolveTripId(fake(data), { flagId: 'f1' }), TRIP)
})
test('hidden or unknown references resolve to null (RLS looks the same as missing)', async () => {
  assert.equal(await resolveTripId(fake(data), { roundId: 'nope' }), null)
  assert.equal(await resolveTripId(fake(data), { entryId: 'nope' }), null)
  assert.equal(await resolveTripId(fake(data), { flagId: 'nope' }), null)
  assert.equal(await resolveTripId(fake(data), {}), null)
})
test('outside production: always allowed and no query is made', async () => {
  const calls: string[] = []
  assert.equal(await makeTripAllowed(fake(data, calls), false)({ entryId: 'e1' }), true)
  assert.equal(calls.length, 0)
})
test('production: allowed only for a listed event; lookup failure fails closed', async () => {
  // ambroseEnabledForTrip reads process env defaults, so exercise the same decision with explicit values here
  assert.equal(ambroseEnabledForTrip(TRIP, 'true', 'production', TRIP), true)
  assert.equal(ambroseEnabledForTrip(TRIP, 'true', 'production', undefined), false)
  // with no env in the test process the production gate says no for every event, and never throws
  assert.equal(await makeTripAllowed(fake(data), true)({ entryId: 'e1' }), false)
  assert.equal(await makeTripAllowed(fake(data, [], true), true)({ entryId: 'e1' }), false)
  assert.equal(await makeTripAllowed(fake(data), true)({ entryId: 'missing' }), false)
})
