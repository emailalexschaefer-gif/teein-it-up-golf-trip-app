'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface EventMessage {
  id: string
  message_type: string
  recipient_type: 'all' | 'group' | 'player'
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

export default function EventMessages({ tripId, isOrganiser }: { tripId: string; isOrganiser: boolean }) {
  const queryClient = useQueryClient()
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

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

  async function handleSend() {
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
    setDraft('')
    setComposing(false)
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

  return (
    <div>
      {isOrganiser && (
        <div style={{ marginBottom: 16 }}>
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
                <button onClick={handleSend} disabled={sending || !draft.trim()} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: sending ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.6 : 1 }}>
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
            No announcements yet. Organiser messages and group notifications will appear here.
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
              {m.is_pinned && '📌 '}{recipientLabel(m)} · {relativeTime(m.created_at)}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>{m.message}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>— {m.sender?.full_name ?? 'Organiser'}</p>
        </div>
      ))}
    </div>
  )
}
