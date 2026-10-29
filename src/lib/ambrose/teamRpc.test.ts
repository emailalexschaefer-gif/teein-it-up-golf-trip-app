import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleTeamAction, TEAM_ACTIONS, type TeamRpcDeps } from './teamRpc'

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const good = { client_id: U(1), entry_id: U(2), hole_id: U(3), gross_score: 4, is_no_return: false, base_revision: 0 }
function deps(over: Partial<TeamRpcDeps> & { data?: unknown } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const d: TeamRpcDeps = {
    getUser: over.getUser ?? (async () => ({ id: U(9) })),
    rpc: over.rpc ?? (async (fn, args) => { calls.push({ fn, args }); return { data: 'data' in over ? over.data : { outcome: 'inserted', revision: 1, gross_score: 4, is_no_return: false }, error: null } }),
  }
  return { d, calls }
}

test('no session -> 401 and the database is never called', async () => {
  const { d, calls } = deps({ getUser: async () => null })
  const r = await handleTeamAction('submit', good, d)
  assert.equal(r.status, 401); assert.equal(calls.length, 0)
})
test('validation: shape errors are 400 and never reach the database', async () => {
  const { d, calls } = deps()
  for (const bad of [{ ...good, gross_score: 0 }, { ...good, gross_score: 21 }, { ...good, is_no_return: true }, { ...good, gross_score: null }, { ...good, client_id: 'x' }, { ...good, base_revision: -1 }, { ...good, base_revision: 1.5 }]) {
    assert.equal((await handleTeamAction('submit', bad, d)).status, 400)
  }
  assert.equal((await handleTeamAction('submit', { ...good, gross_score: null, is_no_return: true }, d)).status, 200)
  assert.equal(calls.length, 1)
})
test('the database is called with exactly the schema fields and NO identity or privilege argument', async () => {
  const { d, calls } = deps()
  await handleTeamAction('submit', { ...good, actor: U(5), is_organiser: true, organiser: true }, d)  // extra fields from a hostile client
  assert.equal(calls[0].fn, 'submit_team_score')
  assert.deepEqual(Object.keys(calls[0].args).sort(), ['p_base_revision', 'p_client_id', 'p_drive', 'p_entry_id', 'p_gross', 'p_hole_id', 'p_no_return', 'p_reason'])
  for (const a of Object.keys(TEAM_ACTIONS) as (keyof typeof TEAM_ACTIONS)[]) {
    const sample = ({ submit: good, flag: { entry_id: U(2), hole_id: U(3) }, resolve_flag: { flag_id: U(4), status: 'resolved' }, assign_scorer: { entry_id: U(2), scorer_id: U(5) },
      unlock: { entry_id: U(2), hole_id: U(3), reason: 'x' }, resolve_no_return: { entry_id: U(2), hole_id: U(3), base_revision: 1, reason: 'x' }, waive_drive: { entry_id: U(2), reason: 'x' },
      create_team: { trip_id: U(6), name: 'Eagles' }, configure_round: { round_id: U(7), format: 'ambrose_2', method: 'ga_weighted' }, save_entry: { round_id: U(7), team_id: U(8), member_ids: [U(1), U(2)] },
      lock_handicap: { entry_id: U(2), team_handicap: 5.2, record: { method: 'ga_weighted' } }, reopen_setup: { round_id: U(4), reason: 'Wrong player' }, relock_setup: { round_id: U(4) } })[a]
    const c = deps(); await handleTeamAction(a, { ...sample, actor: U(7), p_actor: U(7) }, c.d)
    assert.equal(c.calls.length, 1, a)
    assert.ok(!Object.keys(c.calls[0].args).some(k => /actor|organiser/i.test(k)), a)
  }
})
test('outcomes map to the right HTTP status and carry a message when not ok', async () => {
  const cases: [string, number][] = [['conflict', 409], ['locked', 409], ['not_authorised', 403], ['not_authenticated', 401], ['round_closed', 422], ['scorer_not_confirmed', 422], ['not_found', 404], ['updated', 200], ['duplicate', 200]]
  for (const [o, status] of cases) {
    const { d } = deps({ data: { outcome: o, revision: 2, gross_score: 4, is_no_return: false } })
    const r = await handleTeamAction('submit', good, d)
    assert.equal(r.status, status, o)
    assert.equal(r.body.outcome, o)
    if (status >= 400) assert.equal(typeof r.body.message, 'string')
  }
})
test('database privilege refusal is 403; other database faults are retryable 503 and never claim a score', async () => {
  assert.equal((await handleTeamAction('submit', good, deps({ rpc: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) }).d)).status, 403)
  const r = await handleTeamAction('submit', good, deps({ rpc: async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }) }).d)
  assert.equal(r.status, 503); assert.equal(r.body.outcome, undefined)
})
test('a malformed database answer is a 502, not a success', async () => {
  assert.equal((await handleTeamAction('submit', good, deps({ data: { nope: 1 } }).d)).status, 502)
  assert.equal((await handleTeamAction('submit', good, deps({ data: null }).d)).status, 502)
})

test('setup actions: method id is mapped to the database value; three-player and five-player rosters are refused before the database', async () => {
  const c = deps()
  await handleTeamAction('configure_round', { round_id: U(7), format: 'ambrose_4', method: 'ga_weighted', min_drives_per_player: 4 }, c.d)
  assert.equal(c.calls[0].args.p_method, 'weighted_scramble'); assert.equal(c.calls[0].args.p_min_drives, 4)
  assert.equal((await handleTeamAction('configure_round', { round_id: U(7), format: 'ambrose_3', method: 'club_divisor' }, c.d)).status, 400)
  assert.equal((await handleTeamAction('save_entry', { round_id: U(7), team_id: U(8), member_ids: [U(1)] }, c.d)).status, 400)
  assert.equal((await handleTeamAction('save_entry', { round_id: U(7), team_id: U(8), member_ids: [U(1), U(2), U(3), U(4), U(5)] }, c.d)).status, 400)
  assert.equal(c.calls.length, 1)
})
test('configure_round accepts gross_only and sends it to the database unchanged (never mapped to an allowance method)', async () => {
  const c = deps()
  await handleTeamAction('configure_round', { round_id: U(7), format: 'ambrose_4', method: 'gross_only' }, c.d)
  assert.equal(c.calls[0].args.p_method, 'gross_only')
})

test('reopen set-up needs a reason and maps to the audited database function', async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const deps: TeamRpcDeps = { getUser: async () => ({ id: 'u' }), rpc: async (fn, args) => { calls.push({ fn, args }); return { data: { outcome: 'reopened' }, error: null } } }
  const U4 = '00000000-0000-4000-8000-000000000004'
  assert.equal((await handleTeamAction('reopen_setup', { round_id: U4, reason: '  ' }, deps)).status, 400)
  const ok = await handleTeamAction('reopen_setup', { round_id: U4, reason: 'Wrong player' }, deps)
  assert.equal(ok.status, 200)
  assert.deepEqual(calls[0], { fn: 'reopen_team_setup', args: { p_round_id: U4, p_reason: 'Wrong player' } })
  const locked: TeamRpcDeps = { ...deps, rpc: async () => ({ data: { outcome: 'setup_locked' }, error: null }) }
  assert.equal((await handleTeamAction('save_entry', { round_id: U4, team_id: U4, member_ids: [U4, U4] }, locked)).status, 409)
})

test('server-side feature gate: a disabled deployment answers 404 and never touches the database or the session', async () => {
  let touched = 0
  const deps: TeamRpcDeps = { enabled: () => false, getUser: async () => { touched++; return { id: 'u' } }, rpc: async () => { touched++; return { data: { outcome: 'inserted' }, error: null } } }
  const r = await handleTeamAction('submit', {}, deps)
  assert.equal(r.status, 404); assert.equal(touched, 0)
  const on: TeamRpcDeps = { ...deps, enabled: () => true }
  assert.notEqual((await handleTeamAction('submit', {}, on)).status, 404)
})

test('per-event production gate: a refused event answers 404 and the database function is never called; resolver sees the right ids', async () => {
  const seen: unknown[] = []
  const { d, calls } = deps()
  const refuse: TeamRpcDeps = { ...d, tripAllowed: async ref => { seen.push(ref); return false } }
  const r = await handleTeamAction('submit', good, refuse)
  assert.equal(r.status, 404); assert.equal(calls.length, 0)
  assert.deepEqual(seen, [{ tripId: undefined, roundId: undefined, entryId: good.entry_id, flagId: undefined }])
  const allow: TeamRpcDeps = { ...d, tripAllowed: async () => true }
  assert.equal((await handleTeamAction('submit', good, allow)).status, 200); assert.equal(calls.length, 1)
})
test('per-event gate: round-level and trip-level actions pass their own ids; a resolver that throws fails closed (404, no database call)', async () => {
  const seen: Record<string, unknown>[] = []
  const { d, calls } = deps()
  const spy: TeamRpcDeps = { ...d, tripAllowed: async ref => { seen.push(ref as Record<string, unknown>); return false } }
  const R = U(40); const T = U(41)
  await handleTeamAction('configure_round', { round_id: R, format: 'ambrose_2', method: 'gross_only' }, spy)
  await handleTeamAction('create_team', { trip_id: T, name: 'A' }, spy)
  await handleTeamAction('resolve_flag', { flag_id: U(42), status: 'resolved' }, spy)
  assert.equal(seen[0].roundId, R); assert.equal(seen[1].tripId, T); assert.equal(seen[2].flagId, U(42))
  const boom: TeamRpcDeps = { ...d, tripAllowed: async () => { throw new Error('db down') } }
  assert.equal((await handleTeamAction('submit', good, boom)).status, 404); assert.equal(calls.length, 0)
})
test('per-event gate runs after sign-in and after validation: signed-out is still 401 and a bad body is still 400', async () => {
  let asked = 0
  const { d } = deps({ getUser: async () => null })
  assert.equal((await handleTeamAction('submit', good, { ...d, tripAllowed: async () => { asked++; return true } })).status, 401)
  const { d: d2 } = deps()
  assert.equal((await handleTeamAction('submit', {}, { ...d2, tripAllowed: async () => { asked++; return true } })).status, 400)
  assert.equal(asked, 0)
})
