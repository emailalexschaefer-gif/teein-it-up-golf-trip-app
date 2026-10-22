import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTripLayoutData, withTimeout, type TripLayoutFetchers, type TripLayoutTimeouts } from './tripLayoutData'

// Release 3A — the trip layout's loader must give the same answer as the
// previous sequential code for every combination of success / empty / error /
// hang, and must issue the three post-user lookups together.

const FAST: TripLayoutTimeouts = { userMs: 40, membershipMs: 40, practiceMs: 40, activeRoundMs: 80 }
type Mode = 'ok' | 'empty' | 'error' | 'throw' | 'hang'
interface Cfg { user: Mode; membership: Mode; trip: Mode; round: Mode; delay?: number; role?: string; practice?: boolean }

function fakeFetchers(cfg: Cfg, log: Array<{ t: string; at: number }> = []) {
  const t0 = performance.now()
  function result<T>(table: string, mode: Mode, data: T): Promise<{ data: T | null; error: { message: string } | null }> {
    log.push({ t: table, at: performance.now() - t0 })
    if (mode === 'hang') return new Promise(() => {})
    return new Promise((res, rej) => setTimeout(() => {
      if (mode === 'throw') rej(new Error('network'))
      else if (mode === 'error') res({ data: null, error: { message: 'x' } })
      else if (mode === 'empty') res({ data: null, error: null })
      else res({ data, error: null })
    }, cfg.delay ?? 5))
  }
  const fetchers: TripLayoutFetchers = {
    getUser: () => result('auth', cfg.user, { user: { id: 'u1' } }).then(r => ({ data: r.data ?? { user: null } })),
    getMembership: () => result('trip_members', cfg.membership, { role: cfg.role ?? 'organiser' }),
    getPractice: () => result('trips', cfg.trip, { is_practice: cfg.practice ?? true }),
    getActiveRound: () => result('rounds', cfg.round, { id: 'r2', name: 'Round 2' }),
  }
  return { log, fetchers }
}

// ---- reference: the exact sequential logic the layout used before 3A ----
async function legacy(f: TripLayoutFetchers, T: TripLayoutTimeouts) {
  const wt = <X,>(p: PromiseLike<X>, ms: number) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])
  const userResult = await wt(f.getUser(), T.userMs).catch(() => null)
  const user = userResult?.data?.user ?? null
  if (!user) return { user: null, isOrganiser: false, isPractice: false, activeRound: null }
  const m = await wt(f.getMembership(user.id), T.membershipMs).catch(() => null)
  const t = await wt(f.getPractice(), T.practiceMs).catch(() => null)
  const a = await wt(f.getActiveRound(), T.activeRoundMs).catch(() => null)
  return { user, isOrganiser: m?.data?.role === 'organiser', isPractice: t?.data?.is_practice === true, activeRound: a?.data ?? null }
}

const MODES: Mode[] = ['ok', 'empty', 'error', 'throw', 'hang']
test('loader equals the previous sequential logic for every membership × practice × active-round outcome', async () => {
  for (const membership of MODES) for (const trip of MODES) for (const round of MODES) {
    const cfg: Cfg = { user: 'ok', membership, trip, round }
    const a = await loadTripLayoutData(fakeFetchers(cfg).fetchers, FAST)
    const b = await legacy(fakeFetchers(cfg).fetchers, FAST)
    assert.deepEqual(a, b, JSON.stringify(cfg))
  }
})
test('loader equals the previous logic for every user outcome', async () => {
  for (const user of MODES) {
    const cfg: Cfg = { user, membership: 'ok', trip: 'ok', round: 'ok' }
    assert.deepEqual(await loadTripLayoutData(fakeFetchers(cfg).fetchers, FAST), await legacy(fakeFetchers(cfg).fetchers, FAST), user)
  }
})
test('non-organiser role is not organiser; non-practice trip is not practice', async () => {
  const r = await loadTripLayoutData(fakeFetchers({ user: 'ok', membership: 'ok', trip: 'ok', round: 'empty', role: 'player', practice: false }).fetchers, FAST)
  assert.deepEqual(r, { user: { id: 'u1' }, isOrganiser: false, isPractice: false, activeRound: null })
})
test('no signed-in user => no further lookups are made (layout redirects to /login)', async () => {
  for (const user of ['empty', 'error', 'throw', 'hang'] as Mode[]) {
    const c = fakeFetchers({ user, membership: 'ok', trip: 'ok', round: 'ok' })
    const r = await loadTripLayoutData(c.fetchers, FAST)
    assert.equal(r.user, null)
    assert.deepEqual(c.log.map(l => l.t), ['auth'], user)
  }
})
test('the user lookup finishes before any other lookup starts, then the three start together', async () => {
  const c = fakeFetchers({ user: 'ok', membership: 'ok', trip: 'ok', round: 'ok', delay: 20 })
  await loadTripLayoutData(c.fetchers, { userMs: 500, membershipMs: 500, practiceMs: 500, activeRoundMs: 500 })
  const [auth, ...rest] = c.log
  assert.equal(auth.t, 'auth')
  assert.deepEqual(rest.map(l => l.t).sort(), ['rounds', 'trip_members', 'trips'])
  for (const l of rest) assert.ok(l.at >= auth.at + 18, `${l.t} started ${l.at} before auth finished`)
  assert.ok(Math.max(...rest.map(l => l.at)) - Math.min(...rest.map(l => l.at)) < 8, 'three lookups start together')
})
test('total time is one lookup, not three (simulated latency)', async () => {
  const D = 30
  const t0 = performance.now()
  await loadTripLayoutData(fakeFetchers({ user: 'ok', membership: 'ok', trip: 'ok', round: 'ok', delay: D }).fetchers, { userMs: 500, membershipMs: 500, practiceMs: 500, activeRoundMs: 500 })
  const parallel = performance.now() - t0
  const t1 = performance.now()
  await legacy(fakeFetchers({ user: 'ok', membership: 'ok', trip: 'ok', round: 'ok', delay: D }).fetchers, { userMs: 500, membershipMs: 500, practiceMs: 500, activeRoundMs: 500 })
  const serial = performance.now() - t1
  assert.ok(parallel < serial - D, `parallel ${parallel.toFixed(0)}ms vs serial ${serial.toFixed(0)}ms`)
})
test('a hanging active-round lookup does not delay or change the nav flags (membership/practice still resolved)', async () => {
  const r = await loadTripLayoutData(fakeFetchers({ user: 'ok', membership: 'ok', trip: 'ok', round: 'hang' }).fetchers, FAST)
  assert.equal(r.isOrganiser, true); assert.equal(r.isPractice, true); assert.equal(r.activeRound, null)
})
test('a late rejection after the timeout is not an unhandled rejection', async () => {
  let unhandled = 0
  const h = () => { unhandled++ }
  process.on('unhandledRejection', h)
  const slowFail = new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 30))
  assert.equal(await withTimeout(slowFail, 5), null)
  await new Promise(r => setTimeout(r, 60))
  process.off('unhandledRejection', h)
  assert.equal(unhandled, 0)
})
test('layout file wires the loader and keeps the redirect', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../app/(app)/trips/[tripId]/layout.tsx', import.meta.url), 'utf8')
  assert.match(src, /loadTripLayoutData\(\{/)
  assert.match(src, /if \(!user\) redirect\('\/login'\)/)
})
