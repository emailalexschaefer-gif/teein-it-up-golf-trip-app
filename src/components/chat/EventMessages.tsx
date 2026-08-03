'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import MomentCapture from '@/components/moments/MomentCapture'

interface EventMessage {
  id: string
  sender_user_id: string
  message_type: string
  recipient_type: 'all' | 'event' | 'group' | 'player'
  recipient_group_id: string | null
  message: string
  is_pinned: boolean
  created_at: string
  sender: { full_name: string; role: string | null } | null
  recipient_group: { name: string } | null
  momentImageUrl?: string | null
  momentHoleNumber?: number | null
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
  if (m.recipient_type === 'all' || m.recipient_type === 'event') return 'Everyone'
  if (m.recipient_type === 'group') return m.recipient_group?.name ?? 'Group'
  return 'Direct message'
}

// Visual differentiation by message kind — Sprint 6 reinstates ordinary
// participant chat (Part 7: "Players can send Messages") alongside the
// new Moment type, on top of the existing announcement/notification
// distinction.
type Kind = 'announcement' | 'notification' | 'chat' | 'moment'

function kindOf(m: EventMessage): Kind {
  if (m.message_type === 'announcement') return 'announcement'
  if (m.message_type === 'group_notification' || m.message_type === 'player_notification') return 'notification'
  if (m.message_type === 'moment') return 'moment'
  return 'chat'
}

const KIND_META: Record<Kind, { icon: string; label: string; bg: string; border: string; labelColor: string }> = {
  announcement: { icon: '🟢', label: 'Announcement', bg: '#ffffff', border: '#eceae3', labelColor: '#16a34a' },
  notification: { icon: '🔔', label: 'Notification', bg: '#ffffff', border: '#eceae3', labelColor: '#a1791f' },
  chat:         { icon: '💬', label: 'Chat', bg: '#ffffff', border: '#eceae3', labelColor: '#6b7280' },
  moment:       { icon: '📷', label: 'Moment', bg: '#fdf3d9', border: '#e8c96a', labelColor: '#a1791f' },
}

export default function EventMessages({
  tripId, isOrganiser, myGroupId, myGroupName, roundId, holeNumber,
}: {
  tripId: string; isOrganiser: boolean; myGroupId: string | null; myGroupName: string | null
  roundId?: string | null; holeNumber?: number | null
}) {
  const queryClient = useQueryClient()

  // Organiser announcement composer — unchanged.
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Reinstated participant chat composer (Sprint 6, Part 7: "Players can
  // send Messages"). Fixed to "My Group" audience — same reasoning as
  // before: no per-trip setting exists yet to enable event-wide
  // participant chat.
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')

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
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You', role: isOrganiser ? 'organiser' : 'player' }, recipient_group: myGroupName ? { name: myGroupName } : null }, ...old.messages] } : { messages: [resData.sentMessage] }
      )
    }
    setChatDraft('')
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

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
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You', role: 'organiser' }, recipient_group: null }, ...old.messages] } : { messages: [resData.sentMessage] }
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

      {myGroupId && (
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Chat · {myGroupName ?? 'My Group'}
            </div>
            <MomentCapture tripId={tripId} roundId={roundId} holeNumber={holeNumber} myGroupId={myGroupId} />
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
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: meta.labelColor }}>
                  {m.is_pinned && '📌 '}{meta.icon} {meta.label} · {recipientLabel(m)} · {relativeTime(m.created_at)}
                </span>
              </div>
              {kind === 'moment' && m.momentImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a
                // signed Supabase Storage URL, not a static asset next/image
                // can optimize
                <img src={m.momentImageUrl} alt="Moment" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, marginBottom: 6 }} />
              )}
              {kind === 'moment' && m.momentHoleNumber && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#a1791f', marginBottom: 2 }}>
                  Hole {m.momentHoleNumber}
                </div>
              )}
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>{m.message}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                — <Link href={`/trips/${tripId}/players/${m.sender_user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>{m.sender?.full_name ?? 'Member'}</Link>
                {m.sender?.role && <span style={{ color: '#c3c8ce' }}> · {m.sender.role === 'organiser' ? 'Organiser' : 'Player'}</span>}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
