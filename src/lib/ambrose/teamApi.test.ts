import test from 'node:test'
import assert from 'node:assert/strict'
import { postTeamAction, getTeamState, ACTION_PATHS, type FetchLike } from './teamApi'
import { TEAM_ACTIONS } from './teamRpc'
import { existsSync } from 'node:fs'

const f = (status: number, body: unknown, extra: object = {}): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body instanceof Error) throw body; return body }, ...extra })

test('every action has a route file that exports POST', () => {
  assert.deepEqual(Object.keys(ACTION_PATHS).sort(), Object.keys(TEAM_ACTIONS).sort())
  for (const p of Object.values(ACTION_PATHS)) assert.ok(existsSync(`src/app${p}/route.ts`), p)
})
test('success needs a JSON body with an outcome', async () => {
  assert.equal((await postTeamAction(f(200, { outcome: 'inserted', revision: 1 }), 'submit', {})).ok, true)
  const r = await postTeamAction(f(200, { nope: 1 }), 'submit', {}); assert.equal(r.ok, false)
})
test('401 is auth, redirect and 405 are transport (the old 405 trap), network is network', async () => {
  assert.equal(((await postTeamAction(f(401, { error: 'Not authenticated' }), 'submit', {})) as { kind: string }).kind, 'auth')
  assert.equal(((await postTeamAction(f(200, '<html>', { redirected: true, url: 'https://x/login?redirectTo=/api/team-scores' }), 'submit', {})) as { kind: string }).kind, 'auth')
  const red = (await postTeamAction(f(200, '<html>', { redirected: true, url: 'https://x/somewhere-else' }), 'submit', {})) as { kind: string; message: string }
  assert.equal(red.kind, 'transport'); assert.match(red.message, /unexpected redirect at \/somewhere-else/)
  assert.equal(((await postTeamAction(f(405, new Error('html')), 'submit', {})) as { kind: string }).kind, 'transport')
  assert.equal(((await postTeamAction(async () => { throw new Error('offline') }, 'submit', {})) as { kind: string }).kind, 'network')
})
test('409 is a conflict with the server message; other refusals keep their message; HTML error pages never read as success', async () => {
  const c = await postTeamAction(f(409, { outcome: 'conflict', message: 'The team score was changed since you last saw it.' }), 'submit', {})
  assert.equal(c.ok, false); assert.equal((c as { kind: string }).kind, 'conflict'); assert.match((c as { message: string }).message, /changed since/)
  assert.match(((await postTeamAction(f(403, { outcome: 'not_authorised', message: 'You are not the scorer for this team.' }), 'submit', {})) as { message: string }).message, /not the scorer/)
  const h = await postTeamAction(f(200, new Error('not json')), 'submit', {}); assert.equal(h.ok, false)
})
test('getTeamState maps 401/404/redirect/ok', async () => {
  assert.equal(((await getTeamState(f(401, {}), 'r')) as { kind: string }).kind, 'auth')
  assert.equal(((await getTeamState(f(404, {}), 'r')) as { kind: string }).kind, 'not_found')
  assert.equal(((await getTeamState(f(200, '', { redirected: true }), 'r')) as { kind: string }).kind, 'transport')
  const ok = await getTeamState(f(200, { state: { a: 1 }, viewerId: 'u' }), 'r'); assert.equal(ok.ok, true)
  assert.equal(((await getTeamState(f(200, { state: null }), 'r')) as { ok: boolean }).ok, false)
})
