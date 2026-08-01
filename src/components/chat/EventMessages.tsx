'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface EventMessage {
  id: string
  sender_user_id: string
  message_type: string
  recipient_type: 'all' | 'group' | 'player'
  recipient_group_id: string | null
  message: string
  is_pinned: boolean
  created_at: string
  sender: { full_name: string } | null
  recipient_group: { name: string } | null
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString()
}

function recipientLabel(m: EventMessage): string {
  if (m.recipient_type === 'all') return 'All players'
  if (m.recipient_type === 'group') return m.recipient_group?.name ?? 'Group'
  return 'Direct message'
}

function kindLabel(m: EventMessage): string {
  if (m.message_type === 'announcement') return 'Announcement'
  if (m.message_type === 'group_notification' || m.message_type === 'player_notification') return 'Notification'
  return 'Chat'
}

export default function EventMessages({
  tripId, isOrganiser, myGroupId, myGroupName,
}: { tripId: string; isOrganiser: boolean; myGroupId: string | null; myGroupName: string | null }) {
  const queryClient = useQueryClient()

  // Organiser announcement composer — unchanged from before this pass.
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Ordinary participant chat composer — new, available to any confirmed
  // member, not gated on isOrganiser. Audience is fixed to "My Group" for
  // now (no per-trip setting exists yet to enable event-wide participant
  // chat), matching "Everyone, only where enabled" with nothing enabling
  // it currently.
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')

  const { data, isLoading, error, refetch } = useQuery<{ messages: EventMessage[] }>({
    queryKey: ['event-messages', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/messages`)
      if (!res.ok) throw new Error('Could not load messages.')
      return res.json()
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  })

  // Mark as read once the list has actually loaded — this is what the
  // bottom-nav unread dot checks against. A simple localStorage timestamp,
  // not a new database table, since a per-user read-receipt table is more
  // infrastructure than this pass's "validate the concept" scope needs.
  if (data && data.messages.length > 0 && typeof window !== 'undefined') {
    window.localStorage.setItem(`chat-last-read-${tripId}`, data.messages[0].created_at)
  }

  async function handleSendAnnouncement() {
    if (!draft.trim()) return
    setSending(true)
    setSendError('')
    const res = await fetch(`/api/trips/${tripId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientType: 'all', message: draft.trim() }),
    })
    const resData = await res.json().catch(() => ({}))
    setSending(false)
    if (!res.ok) { setSendError(resData.error ?? 'Could not send announcement.'); return }
    // Show immediately, don't wait for the next fetch cycle. The
    // subsequent invalidate below replaces this with the authoritative
    // server list on its own schedule — same real id, so no duplicate.
    if (resData.sentMessage) {
      queryClient.setQueryData<{ messages: EventMessage[] }>(['event-messages', tripId], (old) =>
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You' }, recipient_group: null }, ...old.messages] } : { messages: [resData.sentMessage] }
      )
    }
    setDraft('')
    setComposing(false)
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

  async function handleSendChat() {
    if (!chatDraft.trim() || !myGroupId) return
    setChatSending(true)
    setChatError('')
    const res = await fetch(`/api/trips/${tripId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientType: 'group', recipientGroupId: myGroupId, message: chatDraft.trim(), messageType: 'chat_message' }),
    })
    const resData = await res.json().catch(() => ({}))
    setChatSending(false)
    if (!res.ok) { setChatError(resData.error ?? "Message couldn't be sent. Please try again."); return }
    if (resData.sentMessage) {
      queryClient.setQueryData<{ messages: EventMessage[] }>(['event-messages', tripId], (old) =>
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You' }, recipient_group: myGroupName ? { name: myGroupName } : null }, ...old.messages] } : { messages: [resData.sentMessage] }
      )
    }
    setChatDraft('')
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

  return (
    <div>
      {isOrganiser && (
        <div style={{ marginBottom: 12 }}>
          {!composing ? (
            <button
              onClick={() => setComposing(true)}
              style={{
                width: '100%', padding: 12, borderRadius: 10, background: '#14532d', color: '#fff',
                border: 'none', fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📢 Send Event Announcement
            </button>
          ) : (
            <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 12 }}>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Write an announcement for all players…"
                rows={3}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }}
              />
              {sendError && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{sendError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={handleSendAnnouncement} disabled={sending || !draft.trim()} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: sending ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.6 : 1 }}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
                <button onClick={() => { setComposing(false); setDraft(''); setSendError('') }} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ordinary participant chat — available to everyone with a group,
          fixed audience "My Group" (no event-wide toggle exists yet). */}
      {myGroupId && (
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Chat · {myGroupName ?? 'My Group'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={chatDraft}
              onChange={e => setChatDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !chatSending) handleSendChat() }}
              placeholder="Message your group…"
              style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13 }}
            />
            <button
              onClick={handleSendChat}
              disabled={chatSending || !chatDraft.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: chatSending ? 'default' : 'pointer', opacity: chatSending || !chatDraft.trim() ? 0.6 : 1 }}
            >
              {chatSending ? '…' : 'Send'}
            </button>
          </div>
          {chatError && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{chatError}</p>}
        </div>
      )}

      {isLoading && <p style={{ textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Loading…</p>}
      {error && (
        <div style={{ textAlign: 'center', padding: '24px 16px' }}>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, marginBottom: 10 }}>
            Messages are temporarily unavailable.
          </p>
          <button
            onClick={() => refetch()}
            style={{ padding: '8px 18px', borderRadius: 10, background: '#ffffff', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      )}
      {data && data.messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>💬</p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
            No messages yet. Announcements, notifications, and group chat will appear here.
          </p>
        </div>
      )}
      {data && data.messages.map(m => (
        <div key={m.id} style={{
          background: m.is_pinned ? '#fdf3d9' : '#ffffff',
          border: m.is_pinned ? '1px solid #e8c96a' : '1px solid #eceae3',
          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}>
              {m.is_pinned && '📌 '}{kindLabel(m)} · {recipientLabel(m)} · {relativeTime(m.created_at)}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>{m.message}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            — <Link href={`/trips/${tripId}/players/${m.sender_user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>{m.sender?.full_name ?? 'Organiser'}</Link>
          </p>
        </div>
      ))}
    </div>
  )
}
