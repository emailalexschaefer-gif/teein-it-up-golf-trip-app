'use client'

import { useEffect, useRef, useState } from 'react'
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
  if (m.recipient_type === 'all') return 'Everyone'
  if (m.recipient_type === 'group') return m.recipient_group?.name ?? 'Group'
  return 'Direct message'
}

// Visual differentiation by message kind (per explicit feedback): makes
// it immediately obvious why some messages are read-only (announcements/
// notifications) versus historical player chat from before the group-
// reply composer was removed, rather than all three looking identical.
type Kind = 'announcement' | 'notification' | 'historical_chat'

function kindOf(m: EventMessage): Kind {
  if (m.message_type === 'announcement') return 'announcement'
  if (m.message_type === 'group_notification' || m.message_type === 'player_notification') return 'notification'
  return 'historical_chat'
}

const KIND_META: Record<Kind, { icon: string; label: string; bg: string; border: string; labelColor: string }> = {
  announcement:     { icon: '🟢', label: 'Announcement', bg: '#ffffff', border: '#eceae3', labelColor: '#16a34a' },
  notification:     { icon: '🔔', label: 'Notification', bg: '#ffffff', border: '#eceae3', labelColor: '#a1791f' },
  historical_chat:  { icon: '💬', label: 'Previous Conversation', bg: '#f7f6f1', border: '#e5e2d9', labelColor: '#9ca3af' },
}

export default function EventMessages({
  tripId, isOrganiser,
}: { tripId: string; isOrganiser: boolean }) {
  const queryClient = useQueryClient()

  // Organiser announcement composer — unchanged.
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Restored per explicit instruction: keep this in and evaluate it in
  // real use — remove later only if it proves fiddly in practice, not
  // pre-emptively. Tracks whether new messages have arrived while the
  // person is scrolled away from the top, showing a subtle indicator
  // rather than silently reordering content under them or yanking them
  // away from something they're reading.
  const [newSinceScroll, setNewSinceScroll] = useState(false)
  const listTopRef = useRef<HTMLDivElement>(null)
  const previousFirstIdRef = useRef<string | null>(null)
  const isNearTopRef = useRef(true)

  const { data, isLoading, error, refetch } = useQuery<{ messages: EventMessage[] }>({
    queryKey: ['event-messages', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/messages`)
      if (!res.ok) throw new Error('Could not load messages.')
      return res.json()
    },
    // Chat should feel live while open — 4s sits in the requested 3-5s
    // range. React Query already pauses interval refetching when the tab
    // isn't visible and stops entirely once this component unmounts
    // (leaving Chat), so no extra visibility/mount bookkeeping is needed
    // for "stop polling when Chat is not open."
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  })

  // Mark as read once the list has actually loaded — this is what the
  // bottom-nav unread dot checks against.
  if (data && data.messages.length > 0 && typeof window !== 'undefined') {
    window.localStorage.setItem(`chat-last-read-${tripId}`, data.messages[0].created_at)
  }

  // New-message detection: compare this fetch's newest id to the last
  // one we saw. If the person is scrolled away from the top, show a
  // subtle indicator instead of silently reordering content under them.
  useEffect(() => {
    if (!data || data.messages.length === 0) return
    const newestId = data.messages[0].id
    if (previousFirstIdRef.current && previousFirstIdRef.current !== newestId && !isNearTopRef.current) {
      setNewSinceScroll(true)
    }
    previousFirstIdRef.current = newestId
  }, [data])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    isNearTopRef.current = e.currentTarget.scrollTop < 80
    if (isNearTopRef.current) setNewSinceScroll(false)
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
    if (resData.sentMessage) {
      queryClient.setQueryData<{ messages: EventMessage[] }>(['event-messages', tripId], (old) =>
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You' }, recipient_group: null }, ...old.messages] } : { messages: [resData.sentMessage] }
      )
    }
    setDraft('')
    setComposing(false)
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

  return (
    <div>
      {isOrganiser && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Event Announcement · organiser-only, sent to everyone
          </div>
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

      {/* No player-facing composer here, deliberately — group notifications
          and event announcements are operational broadcasts, not a group
          conversation thread. Players read; only organisers send. */}

      {newSinceScroll && (
        <button
          onClick={() => { listTopRef.current?.scrollIntoView({ behavior: 'smooth' }); setNewSinceScroll(false) }}
          style={{
            display: 'block', width: '100%', textAlign: 'center', padding: 8, borderRadius: 10, marginBottom: 8,
            background: '#fdf3d9', border: '1px solid #e8c96a', color: '#a1791f',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          ↑ New messages
        </button>
      )}

      <div ref={listTopRef} onScroll={handleScroll} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
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
              No messages yet. Announcements and group notifications will appear here.
            </p>
          </div>
        )}
        {data && data.messages.map(m => {
          const kind = kindOf(m)
          const meta = KIND_META[kind]
          return (
            <div key={m.id} style={{
              background: m.is_pinned ? '#fdf3d9' : meta.bg,
              border: `1px solid ${m.is_pinned ? '#e8c96a' : meta.border}`,
              borderRadius: 12, padding: '10px 14px', marginBottom: 8,
              boxShadow: kind === 'historical_chat' ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: meta.labelColor }}>
                  {m.is_pinned && '📌 '}{meta.icon} {meta.label}{kind !== 'historical_chat' ? ` · ${recipientLabel(m)}` : ''} · {relativeTime(m.created_at)}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: kind === 'historical_chat' ? '#6b7280' : '#14532d', lineHeight: 1.5 }}>{m.message}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                — <Link href={`/trips/${tripId}/players/${m.sender_user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>{m.sender?.full_name ?? 'Organiser'}</Link>
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
