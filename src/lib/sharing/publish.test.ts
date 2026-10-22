import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishSnapshot, revokePublication, postChatOnce, SCOPE_KEY } from './publish'
import { parsePresentationChatMessage } from './chatMessage'
import type { getAdmin } from './server'

type Row = Record<string, unknown>
type Admin = ReturnType<typeof getAdmin>

// Minimal in-memory Supabase-like store with the unique partial index and the
// event_messages CHECK behaviour the real tables have.
class Mem {
  tables: Record<string, Row[]> = { shared_presentations: [], event_messages: [] }
  failMessageInsert = false
  private nextId = 1
  from(t: string) { return new Q(this, t) }
  newId() { return `row-${this.nextId++}` }
}
class Q {
  private f: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Row = {}
  constructor(private db: Mem, private t: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.f.push(r => r[c] === v); return this }
  is(c: string, v: unknown) { this.f.push(r => (r[c] ?? null) === v); return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  maybeSingle() { return this.run(true) }
  single() { return this.run(true) }
  then<A, B = never>(a?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, b?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run(false).then(a, b) }
  private async run(single: boolean): Promise<{ data: unknown; error: { code?: string } | null }> {
    const rows = this.db.tables[this.t]
    if (this.op === 'insert') {
      if (this.t === 'event_messages' && this.db.failMessageInsert) return { data: null, error: { code: '500' } }
      const row = { id: this.db.newId(), chat_message_id: null, revoked_at: null, ...this.payload }
      if (this.t === 'shared_presentations' && rows.some(r => r.trip_id === row.trip_id && r.scope_key === row.scope_key && r.status === 'active' && row.status === 'active')) return { data: null, error: { code: '23505' } }
      rows.push(row)
      return { data: single ? row : [row], error: null }
    }
    const hit = rows.filter(r => this.f.every(fn => fn(r)))
    if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: single ? (hit[0] ?? null) : hit, error: null } }
    return { data: single ? (hit[0] ?? null) : hit, error: null }
  }
}

const input = (record: Row = {}) => ({ tripId: 't1', userId: 'org', eventName: 'Lappen Invitational', origin: 'https://app.example', record: { title: 'Lappen Invitational', event_deck: { slides: [] }, public_deck: { slides: [] }, ...record } })
const asAdmin = (m: Mem) => m as unknown as Admin
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

test('first publish creates one active row, an unguessable token and exactly one Chat message', async () => {
  const m = new Mem()
  const r = await publishSnapshot(asAdmin(m), input())
  assert.ok(r.ok); if (!r.ok) return
  assert.equal(r.republished, false); assert.equal(r.version, 1); assert.equal(r.chatPosted, true)
  assert.equal(m.tables.shared_presentations.length, 1)
  assert.equal((m.tables.shared_presentations[0].token as string).length, 43)
  assert.equal(m.tables.event_messages.length, 1)
  const msg = m.tables.event_messages[0]
  assert.equal(msg.message_type, 'announcement'); assert.equal(msg.recipient_type, 'all'); assert.equal(msg.sender_user_id, 'org')
  assert.equal(parsePresentationChatMessage(msg.message as string)?.token, m.tables.shared_presentations[0].token)
  assert.equal(m.tables.shared_presentations[0].chat_message_id, msg.id)
})

test('repeated clicks / retries / republish never create a second Chat message and keep the same link', async () => {
  const m = new Mem()
  const first = await publishSnapshot(asAdmin(m), input())
  const token = m.tables.shared_presentations[0].token
  for (let i = 0; i < 3; i++) await publishSnapshot(asAdmin(m), input({ title: `v${i}` }))
  assert.equal(m.tables.event_messages.length, 1)
  assert.equal(m.tables.shared_presentations.length, 1)
  assert.equal(m.tables.shared_presentations[0].token, token)
  assert.equal(m.tables.shared_presentations[0].version, 4)
  assert.equal(m.tables.shared_presentations[0].title, 'v2')
  assert.ok(first.ok)
})

test('concurrent publishes of an existing publication still post Chat once', async () => {
  const m = new Mem()
  await publishSnapshot(asAdmin(m), input())
  m.tables.shared_presentations[0].chat_message_id = null; m.tables.event_messages.length = 0
  const pubId = m.tables.shared_presentations[0].id as string
  await Promise.all([1, 2, 3, 4].map(() => postChatOnce(asAdmin(m), pubId, 't1', 'org', 'E', 'https://x/s/' + 'a'.repeat(43))))
  assert.equal(m.tables.event_messages.length, 1)
})

test('a failed Chat insert leaves the publication but no message, and the next publish retries it', async () => {
  const m = new Mem(); m.failMessageInsert = true
  const r = await quiet(() => publishSnapshot(asAdmin(m), input()))
  assert.ok(r.ok); if (!r.ok) return
  assert.equal(r.chatPosted, false); assert.equal(m.tables.event_messages.length, 0)
  assert.equal(m.tables.shared_presentations[0].chat_message_id, null)
  m.failMessageInsert = false
  const again = await publishSnapshot(asAdmin(m), input())
  assert.ok(again.ok && again.chatPosted); assert.equal(m.tables.event_messages.length, 1)
})

test('revoke deactivates; publishing again makes a NEW token and message; the old token is never reactivated', async () => {
  const m = new Mem()
  await publishSnapshot(asAdmin(m), input())
  const oldToken = m.tables.shared_presentations[0].token
  assert.deepEqual(await revokePublication(asAdmin(m), 't1', SCOPE_KEY), { ok: true, revoked: true })
  assert.equal(m.tables.shared_presentations[0].status, 'revoked')
  assert.deepEqual(await revokePublication(asAdmin(m), 't1', SCOPE_KEY), { ok: true, revoked: false })
  const r = await publishSnapshot(asAdmin(m), input())
  assert.ok(r.ok)
  assert.equal(m.tables.shared_presentations.length, 2)
  const active = m.tables.shared_presentations.filter(p => p.status === 'active')
  assert.equal(active.length, 1); assert.notEqual(active[0].token, oldToken)
  assert.equal(m.tables.shared_presentations.find(p => p.token === oldToken)?.status, 'revoked')
  assert.equal(m.tables.event_messages.length, 2)
})

test('losing the unique-index race returns 409 and creates no message', async () => {
  const m = new Mem()
  // Simulate another request inserting between our SELECT and INSERT.
  const real = m.from.bind(m)
  let injected = false
  m.from = (t: string) => {
    const q = real(t)
    if (t === 'shared_presentations' && !injected) {
      injected = true
      return new Proxy(q, { get(target, prop, recv) { if (prop === 'maybeSingle') return () => { m.tables.shared_presentations.push({ id: 'race', trip_id: 't1', scope_key: 'event', status: 'active', token: 'z'.repeat(43), version: 1, chat_message_id: null }); return Promise.resolve({ data: null, error: null }) }; return Reflect.get(target, prop, recv) } })
    }
    return q
  }
  const r = await quiet(() => publishSnapshot(asAdmin(m), input()))
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.status, 409)
  assert.equal(m.tables.event_messages.length, 0)
})

test('switching public sharing off keeps the same token (members unaffected) and flips the flag the public routes check; on again restores the same link', async () => {
  const m = new Mem()
  await publishSnapshot(asAdmin(m), input({ public_enabled: true }))
  const token = m.tables.shared_presentations[0].token
  await publishSnapshot(asAdmin(m), input({ public_enabled: false }))
  assert.equal(m.tables.shared_presentations[0].public_enabled, false)
  assert.equal(m.tables.shared_presentations[0].status, 'active')
  assert.equal(m.tables.shared_presentations[0].token, token)
  await publishSnapshot(asAdmin(m), input({ public_enabled: true }))
  assert.equal(m.tables.shared_presentations[0].public_enabled, true)
  assert.equal(m.tables.shared_presentations[0].token, token)
  assert.equal(m.tables.event_messages.length, 1)
})
