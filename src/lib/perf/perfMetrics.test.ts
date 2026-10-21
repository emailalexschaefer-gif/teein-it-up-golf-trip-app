import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ratingFor, reportableValue, normaliseRoute, isTrackedApiRoute, median,
  serverDurFromTimings, summariseApiSamples, serverTimingHeader, isVitalName, serverRegionFromTimings,
} from './perfMetrics'
import { withServerTiming, SLOW_MS } from './withServerTiming'

const UUID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b'

test('ratingFor follows Google thresholds at the boundaries', () => {
  assert.equal(ratingFor('LCP', 2500), 'good')
  assert.equal(ratingFor('LCP', 2501), 'needs-improvement')
  assert.equal(ratingFor('LCP', 4001), 'poor')
  assert.equal(ratingFor('INP', 200), 'good')
  assert.equal(ratingFor('INP', 501), 'poor')
  assert.equal(ratingFor('CLS', 0.1), 'good')
  assert.equal(ratingFor('CLS', 0.26), 'poor')
})

test('reportableValue scales CLS x1000 and rounds everything to an integer', () => {
  assert.equal(reportableValue('CLS', 0.0873), 87)
  assert.equal(reportableValue('LCP', 2345.6), 2346)
})

test('isVitalName only accepts known metrics', () => {
  assert.equal(isVitalName('LCP'), true)
  assert.equal(isVitalName('Next.js-hydration'), false)
})

test('PRIVACY: normaliseRoute removes ids, invite codes and query strings', () => {
  assert.equal(normaliseRoute(`/trips/${UUID}/rounds/${UUID}`), '/trips/:id/rounds/:id')
  assert.equal(normaliseRoute(`/api/trips/${UUID}/rounds/${UUID}/my-scores?x=1&token=secret`), '/api/trips/:id/rounds/:id/my-scores')
  assert.equal(normaliseRoute('/join/ABC123XY'), '/join/:code')
  assert.equal(normaliseRoute(`https://app.example.com/api/trips/${UUID}/messages?q=1#frag`), '/api/trips/:id/messages')
  assert.equal(normaliseRoute('/trips/12345/rounds'), '/trips/:id/rounds')
  assert.equal(normaliseRoute('/'), '/')
  assert.equal(normaliseRoute(''), '/')
  const out = normaliseRoute(`/trips/${UUID}/players/${UUID}?email=a@b.c`)
  assert.equal(out.includes(UUID), false)
  assert.equal(out.includes('@'), false)
})

test('only the intended API routes are tracked', () => {
  for (const p of [
    '/api/trips/:id/rounds/:id/my-scores', '/api/trips/:id/rounds/:id/leaderboard',
    '/api/trips/:id/rounds/:id/tournament', '/api/trips/:id/messages', '/api/trips/:id/members', '/api/scores',
  ]) assert.equal(isTrackedApiRoute(p), true, p)
  for (const p of ['/api/me', '/api/admin/x', '/api/auth/callback', '/trips/:id', '/api/trips/:id/moments']) assert.equal(isTrackedApiRoute(p), false, p)
})

test('median / summary handle empty, odd, even and missing server timings', () => {
  assert.equal(median([]), 0)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([1, 2, 3, 10]), 3)
  const s = summariseApiSamples('/api/scores', [
    { total: 800, server: 200, ok: true },
    { total: 1000, server: 300, ok: true },
    { total: 5000, server: null, ok: false },
  ])
  assert.equal(s.count, 3)
  assert.equal(s.total_p50, 1000)
  assert.equal(s.total_max, 5000)
  assert.equal(s.server_p50, 250)
  assert.equal(s.overhead_p50, 650)  // median(600, 700)
  assert.equal(s.errors, 1)
  const empty = summariseApiSamples('/api/scores', [])
  assert.equal(empty.count, 0)
  assert.equal(empty.total_max, 0)
})

test('serverDurFromTimings reads the app entry only', () => {
  assert.equal(serverDurFromTimings([{ name: 'cdn', duration: 5 }, { name: 'app', duration: 123.4 }]), 123.4)
  assert.equal(serverDurFromTimings([{ name: 'cdn', duration: 5 }]), null)
  assert.equal(serverDurFromTimings(undefined), null)
})

test('serverTimingHeader format', () => {
  assert.equal(serverTimingHeader(123.456), 'app;dur=123.5')
  assert.equal(serverTimingHeader(-4), 'app;dur=0')
})

test('serverTimingHeader includes the function region only when it is a clean region code', () => {
  assert.equal(serverTimingHeader(10, 'syd1'), 'app;dur=10, region;desc="syd1"')
  assert.equal(serverTimingHeader(10, 'iad1'), 'app;dur=10, region;desc="iad1"')
  assert.equal(serverTimingHeader(10, undefined), 'app;dur=10')
  assert.equal(serverTimingHeader(10, ''), 'app;dur=10')
  assert.equal(serverTimingHeader(10, 'bad"; evil=1'), 'app;dur=10', 'never echo arbitrary text into a header')
})

test('serverRegionFromTimings reads a valid region only', () => {
  assert.equal(serverRegionFromTimings([{ name: 'app' }, { name: 'region', description: 'syd1' }]), 'syd1')
  assert.equal(serverRegionFromTimings([{ name: 'region', description: 'x y z' }]), null)
  assert.equal(serverRegionFromTimings([{ name: 'app' }]), null)
  assert.equal(serverRegionFromTimings(undefined), null)
})

// ── withServerTiming ────────────────────────────────────────────────────────
test('withServerTiming: adds the header and leaves body and status untouched', async () => {
  const h = withServerTiming('t', async (_a: string) => new Response(JSON.stringify({ ok: 1 }), { status: 201 }))
  const res = await h('x')
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { ok: 1 })
  assert.match(res.headers.get('Server-Timing') ?? '', /^app;dur=\d/)
})

test('withServerTiming: passes through all arguments', async () => {
  const h = withServerTiming('t', async (a: number, b: number) => new Response(String(a + b)))
  assert.equal(await (await h(2, 3)).text(), '5')
})

test('withServerTiming: errors propagate exactly as before (never swallowed)', async () => {
  const h = withServerTiming('t', async () => { throw new Error('boom') })
  await assert.rejects(() => h(), /boom/)
})

test('withServerTiming: immutable headers do not break the response', async () => {
  const res = Response.redirect('https://example.com/', 302) // immutable headers
  const h = withServerTiming('t', async () => res)
  const out = await h()
  assert.equal(out.status, 302)
})

test('withServerTiming: logs only slow calls, with no request data', async () => {
  const lines: string[] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => { lines.push(a.join(' ')) }
  try {
    await withServerTiming('fast', async () => new Response('x'))()
    assert.equal(lines.length, 0)
    const realNow = Date.now
    let calls = 0
    Date.now = () => (calls++ === 0 ? 0 : SLOW_MS + 5)
    try { await withServerTiming('slowroute', async () => new Response('x', { status: 200 }))() } finally { Date.now = realNow }
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^\[perf-slow\] slowroute status=200 ms=\d+$/)
  } finally { console.warn = orig }
})

// ── wiring ──────────────────────────────────────────────────────────────────
test('all four hot GET routes are wrapped, and their handlers are otherwise unchanged in name/signature', () => {
  const base = '../../app/api/trips/[tripId]/'
  for (const [rel, label] of [
    ['rounds/[roundId]/my-scores/route.ts', 'my-scores'],
    ['rounds/[roundId]/leaderboard/route.ts', 'leaderboard'],
    ['rounds/[roundId]/tournament/route.ts', 'tournament'],
    ['messages/route.ts', 'messages'],
  ]) {
    const src = readFileSync(new URL(base + rel, import.meta.url), 'utf8')
    assert.ok(src.includes(`export const GET = withServerTiming('${label}', getHandler)`), label)
    assert.ok(src.includes('async function getHandler(_req: NextRequest, { params }: RouteProps)'), label)
    assert.equal((src.match(/export async function GET\(/g) ?? []).length, 0, label)
  }
})

test('the scores write route is NOT touched by instrumentation', () => {
  const src = readFileSync(new URL('../../app/api/scores/route.ts', import.meta.url), 'utf8')
  assert.equal(src.includes('withServerTiming'), false)
})

test('PerformanceReporter sends no identifying data and respects Do Not Track', () => {
  const src = readFileSync(new URL('../../components/analytics/PerformanceReporter.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes("navigator.doNotTrack === '1'"))
  assert.equal(/tripId|roundId|user\.id|profile|email|full_name|score/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false)
  assert.ok(src.includes('normaliseRoute('))
})

test('PerformanceReporter is mounted once at the root', () => {
  const src = readFileSync(new URL('../../app/layout.tsx', import.meta.url), 'utf8')
  assert.equal((src.match(/<PerformanceReporter \/>/g) ?? []).length, 1)
})
