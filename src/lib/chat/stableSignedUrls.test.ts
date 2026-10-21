import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SignedUrlCache, stabiliseUrls, signedUrlExpiryMs, signedUrlBase,
  MIN_REUSE_REMAINING_MS, MIN_CLIENT_KEEP_REMAINING_MS, SIGN_TTL_SECONDS,
  type StableUrlMap,
} from './stableSignedUrls'

function b64u(o: object) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
function makeUrl(path: string, expMs: number, salt = 'a') {
  const token = `${b64u({ alg: 'HS256' })}.${b64u({ url: path, exp: Math.floor(expMs / 1000), salt })}.sig${salt}`
  return `https://x.supabase.co/storage/v1/object/sign/event-moments/${path}?token=${token}`
}
const NOW = 1_800_000_000_000
const HOUR = 3600_000

test('signedUrlExpiryMs reads the JWT exp; junk returns null', () => {
  assert.equal(signedUrlExpiryMs(makeUrl('a.jpg', NOW + HOUR)), Math.floor((NOW + HOUR) / 1000) * 1000)
  assert.equal(signedUrlExpiryMs('https://x/y.jpg'), null)
  assert.equal(signedUrlExpiryMs('https://x/y.jpg?token=notajwt'), null)
  assert.equal(signedUrlExpiryMs('https://x/y.jpg?token=a.b.c'), null)
})

test('signedUrlBase strips the token', () => {
  assert.equal(signedUrlBase(makeUrl('a.jpg', NOW)), 'https://x.supabase.co/storage/v1/object/sign/event-moments/a.jpg')
})

// ── server cache ────────────────────────────────────────────────────────────
test('cache: reuses a URL for the same user+path while plenty of life remains', () => {
  const c = new SignedUrlCache()
  const u = makeUrl('p/1.jpg', NOW + HOUR)
  c.set('u1', 'p/1.jpg', u, NOW)
  assert.equal(c.get('u1', 'p/1.jpg', NOW + 60_000), u)          // 1 min later
  assert.equal(c.get('u1', 'p/1.jpg', NOW + 40 * 60_000), u)     // 40 min later: 20 min left
})

test('cache: never reuses once less than the minimum life remains', () => {
  const c = new SignedUrlCache()
  c.set('u1', 'p/1.jpg', makeUrl('p/1.jpg', NOW + HOUR), NOW)
  assert.equal(c.get('u1', 'p/1.jpg', NOW + HOUR - MIN_REUSE_REMAINING_MS + 1), null)
  assert.equal(c.get('u1', 'p/1.jpg', NOW + HOUR + 1), null)     // expired
})

test('cache: a URL minted for one user is never returned to another user', () => {
  const c = new SignedUrlCache()
  c.set('alice', 'p/1.jpg', makeUrl('p/1.jpg', NOW + HOUR), NOW)
  assert.equal(c.get('bob', 'p/1.jpg', NOW + 1000), null)
})

test('cache: different paths are independent', () => {
  const c = new SignedUrlCache()
  c.set('u1', 'p/1.jpg', makeUrl('p/1.jpg', NOW + HOUR), NOW)
  assert.equal(c.get('u1', 'p/2.jpg', NOW + 1000), null)
})

test('cache: a URL already too close to expiry is not cached; no-expiry URLs use the TTL', () => {
  const c = new SignedUrlCache()
  c.set('u1', 'near.jpg', makeUrl('near.jpg', NOW + 60_000), NOW)
  assert.equal(c.size, 0)
  c.set('u1', 'plain.jpg', 'https://x/plain.jpg?token=junk', NOW, SIGN_TTL_SECONDS)
  assert.equal(c.get('u1', 'plain.jpg', NOW + 1000), 'https://x/plain.jpg?token=junk')
})

test('cache: bounded size (evicts, never grows past the cap)', () => {
  const c = new SignedUrlCache(5)
  for (let i = 0; i < 20; i++) c.set('u', `p${i}.jpg`, makeUrl(`p${i}.jpg`, NOW + HOUR), NOW)
  assert.ok(c.size <= 5)
  assert.equal(c.get('u', 'p19.jpg', NOW + 1), makeUrl('p19.jpg', NOW + HOUR))
})

// ── client stabiliser ───────────────────────────────────────────────────────
test('client: the same file with a new token keeps the URL already on screen', () => {
  const first = makeUrl('p/1.jpg', NOW + HOUR, 'a')
  const r1 = stabiliseUrls(new Map(), { m1: first }, NOW)
  assert.equal(r1.urls.m1, first)
  const second = makeUrl('p/1.jpg', NOW + HOUR + 4000, 'b')       // next poll: different token
  const r2 = stabiliseUrls(r1.map, { m1: second }, NOW + 4000)
  assert.equal(r2.urls.m1, first, 'src must not change between polls')
})

test('client: URL is refreshed once the kept one is close to expiry', () => {
  const first = makeUrl('p/1.jpg', NOW + HOUR, 'a')
  const r1 = stabiliseUrls(new Map(), { m1: first }, NOW)
  const later = NOW + HOUR - MIN_CLIENT_KEEP_REMAINING_MS + 1000
  const fresh = makeUrl('p/1.jpg', later + HOUR, 'c')
  assert.equal(stabiliseUrls(r1.map, { m1: fresh }, later).urls.m1, fresh)
})

test('client: a different file for the same message replaces the kept URL', () => {
  const r1 = stabiliseUrls(new Map(), { m1: makeUrl('p/1.jpg', NOW + HOUR) }, NOW)
  const other = makeUrl('p/OTHER.jpg', NOW + HOUR)
  assert.equal(stabiliseUrls(r1.map, { m1: other }, NOW + 1000).urls.m1, other)
})

test('client: revocation — a null/missing incoming URL clears the kept one', () => {
  const r1 = stabiliseUrls(new Map(), { m1: makeUrl('p/1.jpg', NOW + HOUR) }, NOW)
  const r2 = stabiliseUrls(r1.map, { m1: null }, NOW + 1000)
  assert.equal(r2.urls.m1, null)
  assert.equal(r2.map.has('m1'), false)
})

test('client: a failed image forces adoption of the latest URL', () => {
  const first = makeUrl('p/1.jpg', NOW + HOUR, 'a')
  const r1 = stabiliseUrls(new Map(), { m1: first }, NOW)
  const fresh = makeUrl('p/1.jpg', NOW + HOUR, 'z')
  assert.equal(stabiliseUrls(r1.map, { m1: fresh }, NOW + 4000, new Set(['m1'])).urls.m1, fresh)
})

test('client: messages that disappear from the feed are dropped from the map', () => {
  const r1 = stabiliseUrls(new Map(), { m1: makeUrl('a.jpg', NOW + HOUR), m2: makeUrl('b.jpg', NOW + HOUR) }, NOW)
  const r2 = stabiliseUrls(r1.map as StableUrlMap, { m2: makeUrl('b.jpg', NOW + HOUR, 'q') }, NOW + 1000)
  assert.equal(r2.map.has('m1'), false)
  assert.equal(r2.map.has('m2'), true)
})

test('client: URLs without a readable expiry are still kept (50 min) then refreshed', () => {
  const noExp = 'https://x/y/1.jpg?token=opaque'
  const r1 = stabiliseUrls(new Map(), { m1: noExp }, NOW)
  assert.equal(stabiliseUrls(r1.map, { m1: 'https://x/y/1.jpg?token=opaque2' }, NOW + 10 * 60_000).urls.m1, noExp)
  assert.equal(stabiliseUrls(r1.map, { m1: 'https://x/y/1.jpg?token=opaque2' }, NOW + 49 * 60_000).urls.m1, 'https://x/y/1.jpg?token=opaque2')
})

// ── wiring: pin the integration so it can't silently regress ────────────────
test('messages route: access check and RLS query untouched; cache is per-user and only skips signing', () => {
  const src = readFileSync(new URL('../../app/api/trips/[tripId]/messages/route.ts', import.meta.url), 'utf8')
  assert.ok(src.includes("signedUrlCache.get(user.id, mo.image_path, nowMs)"))
  assert.ok(src.includes("signedUrlCache.set(user.id, mo.image_path, url, nowMs, SIGN_TTL_SECONDS)"))
  assert.ok(src.includes("createSignedUrl(mo.image_path, SIGN_TTL_SECONDS)"))
  assert.ok(src.includes("if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })"))
  // the RLS-subject query that decides which messages (and so which moments) are visible is still first
  assert.ok(src.indexOf(".from('event_messages')") < src.indexOf('signedUrlCache.get'))
})

test('EventMessages: poll results are stabilised and image errors are capped', () => {
  const src = readFileSync(new URL('../../components/chat/EventMessages.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('stabiliseUrls(stableUrlsRef.current, incoming, Date.now(), failedUrlIdsRef.current)'))
  assert.ok(src.includes('if (tries >= 2) return'))
  assert.ok(src.includes('refetchInterval: 4000'), 'polling interval is unchanged by Phase A')
})
