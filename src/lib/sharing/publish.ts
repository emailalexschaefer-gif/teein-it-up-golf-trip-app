// Release 3S -- the write side of publishing, kept separate from the route so
// it can be tested against an in-memory database. Guarantees:
//  * one ACTIVE publication per event (also enforced by a unique partial index)
//  * republish replaces the snapshot with a single UPDATE and keeps the token
//  * exactly one Chat message per publication, even with retries/double clicks
//  * revoke is permanent for that token; publishing again makes a NEW token
import { randomUUID } from 'node:crypto'
import { generateShareToken } from './token'
import { buildPresentationChatMessage, sharePath } from './chatMessage'
import type { getAdmin } from './server'

export const SCOPE_KEY = 'event'
type Admin = ReturnType<typeof getAdmin>

export interface PublishInput {
  tripId: string
  userId: string
  eventName: string
  origin: string
  record: Record<string, unknown>
}
export type PublishResult =
  | { ok: true; republished: boolean; version: number; publicUrl: string; chatPosted: boolean }
  | { ok: false; status: number; error: string }

interface ActiveRow { id: string; token: string; version: number; chat_message_id: string | null }
const COLS = 'id, token, version, chat_message_id'

export async function publishSnapshot(admin: Admin, input: PublishInput): Promise<PublishResult> {
  const { tripId, userId, eventName, origin, record } = input
  const found = await admin.from('shared_presentations').select(COLS).eq('trip_id', tripId).eq('scope_key', SCOPE_KEY).eq('status', 'active').maybeSingle()
  let active = (found.data as ActiveRow | null) ?? null
  let republished = false

  if (active) {
    const upd = await admin.from('shared_presentations').update({ ...record, version: active.version + 1 }).eq('id', active.id).eq('status', 'active').select(COLS).maybeSingle()
    if (upd.error || !upd.data) return { ok: false, status: 500, error: 'Publishing failed. Nothing was changed — please try again.' }
    active = upd.data as ActiveRow
    republished = true
  } else {
    const ins = await admin.from('shared_presentations').insert({ trip_id: tripId, scope_key: SCOPE_KEY, token: generateShareToken(), status: 'active', version: 1, ...record }).select(COLS).single()
    if (ins.error || !ins.data) {
      if (ins.error?.code === '23505') return { ok: false, status: 409, error: 'A presentation was just published by someone else. Please reload and publish again to update it.' }
      console.error('[share-presentation] insert failed', { code: ins.error?.code, tripId })
      return { ok: false, status: 500, error: 'Publishing failed. Nothing was published — please try again.' }
    }
    active = ins.data as ActiveRow
  }

  const publicUrl = `${origin}${sharePath(active.token)}`
  const chatPosted = await postChatOnce(admin, active.id, tripId, userId, eventName, publicUrl)
  return { ok: true, republished, version: active.version, publicUrl, chatPosted }
}

/** Claim-then-insert: only one concurrent caller can flip chat_message_id NULL -> id. */
export async function postChatOnce(admin: Admin, publicationId: string, tripId: string, userId: string, eventName: string, publicUrl: string): Promise<boolean> {
  const existing = await admin.from('shared_presentations').select('chat_message_id').eq('id', publicationId).maybeSingle()
  if (existing.data?.chat_message_id) return true
  const messageId = randomUUID()
  const claim = await admin.from('shared_presentations').update({ chat_message_id: messageId }).eq('id', publicationId).is('chat_message_id', null).select('id')
  if (claim.error) return false
  if (!claim.data || claim.data.length === 0) return true // someone else holds the claim and is posting
  const row = { id: messageId, trip_id: tripId, sender_user_id: userId, message_type: 'announcement', recipient_type: 'all', message: buildPresentationChatMessage(eventName, publicUrl) }
  let res = await admin.from('event_messages').insert(row)
  if (res.error && res.error.code === '23514') res = await admin.from('event_messages').insert({ ...row, recipient_type: 'event' })
  if (res.error) {
    console.error('[share-presentation] chat post failed', { code: res.error.code, tripId })
    await admin.from('shared_presentations').update({ chat_message_id: null }).eq('id', publicationId).eq('chat_message_id', messageId)
    return false
  }
  return true
}

export async function revokePublication(admin: Admin, tripId: string, scopeKey: string): Promise<{ ok: true; revoked: boolean } | { ok: false }> {
  const res = await admin.from('shared_presentations').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('trip_id', tripId).eq('scope_key', scopeKey).eq('status', 'active').select('id')
  if (res.error) return { ok: false }
  return { ok: true, revoked: ((res.data ?? []) as unknown[]).length > 0 }
}
