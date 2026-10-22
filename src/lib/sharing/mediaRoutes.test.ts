import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { FakeDb, type Row } from '../perf/harness/fakeDb'
import { loadGet } from '../perf/harness/runRoute'
import { setHarness } from '../perf/harness/state'
import { generateShareToken } from './token'

const PUBLIC_ROUTE = fileURLToPath(new URL('../../app/api/s/[token]/m/[momentId]/route.ts', import.meta.url))
const MEMBER_ROUTE = fileURLToPath(new URL('../../app/api/trips/[tripId]/presentation/media/[momentId]/route.ts', import.meta.url))

const TRIP = '11111111-1111-4111-8111-111111111111'
const OTHER_TRIP = '22222222-2222-4222-8222-222222222222'
const OK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EVENT_ONLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_TRIPS_MOMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const token = generateShareToken()

function tables(status: 'active' | 'revoked' = 'active', publicEnabled = true): Record<string, Row[]> {
  return {
    shared_presentations: [{ trip_id: TRIP, scope_key: 'event', token, status, public_enabled: publicEnabled, approved_public_moment_ids: [OK, OTHER_TRIPS_MOMENT], approved_event_moment_ids: [OK, EVENT_ONLY] }],
    moments: [
      { id: OK, trip_id: TRIP, image_path: `${TRIP}/ok.jpg`, moment_type: 'photo' },
      { id: EVENT_ONLY, trip_id: TRIP, image_path: `${TRIP}/private.jpg`, moment_type: 'photo' },
      { id: OTHER_TRIPS_MOMENT, trip_id: OTHER_TRIP, image_path: `${OTHER_TRIP}/x.jpg`, moment_type: 'photo' },
    ],
    trip_members: [{ trip_id: TRIP, profile_id: 'member', role: 'player' }],
  }
}

async function call(path: string, params: Record<string, string>, t: Record<string, Row[]>, user: { id: string } | null = null) {
  const GET = await loadGet(path)
  const db = new FakeDb({ tables: t })
  setHarness({ admin: db, sessionClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, storage: db.storage, from: (n: string) => db.from(n) }) })
  const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve(params) })
  return { res, db }
}

test('public media: approved photo redirects to a short-lived signed URL, no-store', async () => {
  const { res } = await call(PUBLIC_ROUTE, { token, momentId: OK }, tables())
  assert.equal(res.status, 302)
  assert.match(res.headers.get('location') ?? '', /ttl=600$/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
})

test('public media: event-only media is never served publicly', async () => {
  const { res, db } = await call(PUBLIC_ROUTE, { token, momentId: EVENT_ONLY }, tables())
  assert.equal(res.status, 404); assert.equal(db.storageSigned.length, 0)
})

test('public media: revoked, unknown and malformed tokens all return the same 404', async () => {
  for (const [tk, t] of [[token, tables('revoked')], [generateShareToken(), tables()], ['short', tables()], ['x'.repeat(43) + '/', tables()]] as const) {
    const { res, db } = await call(PUBLIC_ROUTE, { token: tk, momentId: OK }, t)
    assert.equal(res.status, 404); assert.equal(db.storageSigned.length, 0)
  }
})

test('public media: a moment from another event is refused even if listed', async () => {
  const { res, db } = await call(PUBLIC_ROUTE, { token, momentId: OTHER_TRIPS_MOMENT }, tables())
  assert.equal(res.status, 404); assert.equal(db.storageSigned.length, 0)
})

test('public media: non-uuid moment id is rejected before any lookup', async () => {
  const { res, db } = await call(PUBLIC_ROUTE, { token, momentId: '../../etc' }, tables())
  assert.equal(res.status, 404); assert.equal(db.calls.length, 0)
})

test('member media: signed-out is refused, non-member gets 404, member gets event-only media', async () => {
  assert.equal((await call(MEMBER_ROUTE, { tripId: TRIP, momentId: EVENT_ONLY }, tables(), null)).res.status, 401)
  assert.equal((await call(MEMBER_ROUTE, { tripId: TRIP, momentId: EVENT_ONLY }, tables(), { id: 'stranger' })).res.status, 404)
  const ok = await call(MEMBER_ROUTE, { tripId: TRIP, momentId: EVENT_ONLY }, tables(), { id: 'member' })
  assert.equal(ok.res.status, 302)
  assert.equal(ok.res.headers.get('cache-control'), 'no-store')
})

test('member media: not served after revoke, and not for media outside the approved set', async () => {
  assert.equal((await call(MEMBER_ROUTE, { tripId: TRIP, momentId: EVENT_ONLY }, tables('revoked'), { id: 'member' })).res.status, 404)
  assert.equal((await call(MEMBER_ROUTE, { tripId: TRIP, momentId: OTHER_TRIPS_MOMENT }, tables(), { id: 'member' })).res.status, 404)
})

import { readFileSync } from 'node:fs'
test('source check: public surfaces never read event-only data', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  for (const rel of ['../../app/s/[token]/page.tsx', '../../app/api/s/[token]/m/[momentId]/route.ts', '../../components/memories/SharedPresentationViewer.tsx']) {
    const src = read(rel)
    assert.ok(!/event_deck|approved_event_moment_ids/.test(src), `${rel} must not touch event-only data`)
  }
  assert.ok(!/public_deck|approved_public_moment_ids/.test(read('../../app/(app)/trips/[tripId]/presentation/page.tsx')), 'member page uses the event deck only')
  // the public page must not select tokens/paths for anything but its own lookup
  assert.ok(!/image_path|createSignedUrl/.test(read('../../app/s/[token]/page.tsx')))
})

test('public media: event-members-only publication (public sharing off) serves nothing publicly, but members still get media', async () => {
  const off = await call(PUBLIC_ROUTE, { token, momentId: OK }, tables('active', false))
  assert.equal(off.res.status, 404); assert.equal(off.db.storageSigned.length, 0)
  assert.equal((await call(MEMBER_ROUTE, { tripId: TRIP, momentId: OK }, tables('active', false), { id: 'member' })).res.status, 302)
})

test('source check: chat card and watch link read live publication status, not message text or a long cache', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  const card = read('../../components/chat/PresentationCard.tsx')
  assert.ok(/share-presentation/.test(card) && /staleTime: 0/.test(card) && /refetchInterval/.test(card))
  assert.ok(/staleTime: 0/.test(read('../../components/memories/WatchPresentationLink.tsx')))
  assert.ok(/invalidateQueries/.test(read('../../components/memories/SharePresentationPanel.tsx')))
})
