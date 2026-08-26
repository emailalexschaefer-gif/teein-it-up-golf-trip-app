'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import MomentViewer, { type MomentViewerData } from '@/components/moments/MomentViewer'

// Same reasoning and same risk as SelfMarkerScoreShell.tsx's identical
// change — MomentCapture's own import chain reaches the genuinely
// unverified react-easy-crop dependency; ssr: false removes it from
// server rendering regardless of whether it's confirmed as a root
// cause anywhere specifically, since it's the correct pattern for a
// browser-only library either way.
const MomentCapture = dynamic(() => import('@/components/moments/MomentCapture'), { ssr: false })

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
  // Item 4 — the Moment's actual subject (Marnie), distinct from
  // sender_user_id (Alex, the uploader/capturer). Only meaningful when
  // kind === 'moment'.
  momentPlayerName?: string | null
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
type Kind = 'announcement' | 'notification' | 'chat' | 'publicPost' | 'moment'

function kindOf(m: EventMessage): Kind {
  if (m.message_type === 'announcement') return 'announcement'
  if (m.message_type === 'group_notification' || m.message_type === 'player_notification') return 'notification'
  if (m.message_type === 'moment') return 'moment'
  if (m.message_type === 'chat_message' && (m.recipient_type === 'all' || m.recipient_type === 'event')) return 'publicPost'
  return 'chat'
}

const KIND_META: Record<Kind, { icon: string; label: string; bg: string; border: string; labelColor: string }> = {
  announcement: { icon: '🟢', label: 'Announcement', bg: '#ffffff', border: '#eceae3', labelColor: '#16a34a' },
  notification: { icon: '🔔', label: 'Notification', bg: '#ffffff', border: '#eceae3', labelColor: '#a1791f' },
  chat:         { icon: '💬', label: 'Group Message', bg: '#ffffff', border: '#eceae3', labelColor: '#6b7280' },
  publicPost:   { icon: '💬', label: 'Trip Message', bg: '#ffffff', border: '#eceae3', labelColor: '#1e3a5f' },
  moment:       { icon: '📷', label: 'Moment', bg: '#fdf3d9', border: '#e8c96a', labelColor: '#a1791f' },
}

export default function EventMessages({
  tripId, isOrganiser: isOrganiserProp, myGroupId, roundId, holeNumber,
}: {
  tripId: string; isOrganiser: boolean; myGroupId: string | null; myGroupName: string | null
  roundId?: string | null; holeNumber?: number | null
}) {
  const queryClient = useQueryClient()

  // Item 1 — Chat role leakage fix. isOrganiserProp is the server-
  // rendered value (correct on the actual request, but see the comment
  // in my-role/route.ts for why a stale client-side router-cache replay
  // could briefly disagree with it). confirmedOrganiser starts at
  // `false` regardless of the prop — a fresh player never renders
  // organiser controls even for an instant while this resolves — and is
  // only ever set `true` once the auth-scoped /my-role fetch actually
  // confirms it. This can only ever narrow the prop's value toward
  // "not organiser", never expand it: even if the prop said true, the
  // UI stays hidden until independently confirmed.
  const [confirmedOrganiser, setConfirmedOrganiser] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!isOrganiserProp) return // nothing to confirm — already correctly hidden
    fetch(`/api/trips/${tripId}/my-role`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body?.role === 'organiser') setConfirmedOrganiser(true) })
      .catch(() => { /* stays false — safe default on any failure */ })
    return () => { cancelled = true }
  }, [tripId, isOrganiserProp])
  const isOrganiser = confirmedOrganiser

  // Organiser announcement composer — unchanged.
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [pinOnSend, setPinOnSend] = useState(false)

  // Participant chat composer (Sprint 6, Part 7: "Players can send
  // Messages"). Product decision (this pass): normal player chat is
  // trip-wide by default — players in the same playing group are
  // physically together, so a group-scoped chat added little value.
  // Always sends recipientType: 'all', reusing the existing Everyone/
  // broadcast infrastructure the organiser announcement composer above
  // already relies on — no new messaging system. (A previous pass left
  // an unused 'group' vs 'all' toggle wired into state with no actual UI
  // control ever rendered for it; removed along with the dead branch,
  // rather than carrying forward a toggle nothing could reach.)
  const [chatDraft, setChatDraft] = useState('')
  const [viewingMoment, setViewingMoment] = useState<MomentViewerData | null>(null)
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')

  // Item 8 — pin/unpin. "Pinning another message replaces the existing
  // pin after a simple confirmation" — the confirm() below is that
  // confirmation; the server enforces the one-pinned-per-trip rule
  // regardless, so this is a UX courtesy, not the actual safety net.
  async function handlePinToggle(messageId: string, pinning: boolean) {
    const alreadyPinned = (data?.messages ?? []).some(m => m.is_pinned)
    if (pinning && alreadyPinned && !window.confirm('Pinning this message will replace the currently pinned message. Continue?')) return
    try {
      const res = await fetch(`/api/trips/${tripId}/messages/${messageId}/pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: pinning }),
      })
      if (!res.ok) throw new Error()
      void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
    } catch { /* silent — the button simply doesn't visibly change if it failed, no destructive state to roll back */ }
  }

  async function handleSendChat() {
    if (!chatDraft.trim()) return
    setChatSending(true)
    setChatError('')
    const res = await fetch(`/api/trips/${tripId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientType: 'all',
        message: chatDraft.trim(), messageType: 'chat_message',
      }),
    })
    const resData = await res.json().catch(() => ({}))
    setChatSending(false)
    if (!res.ok) { setChatError(resData.error ?? "Message couldn't be sent. Please try again."); return }
    if (resData.sentMessage) {
      queryClient.setQueryData<{ messages: EventMessage[] }>(['event-messages', tripId], (old) =>
        old ? { messages: [{ ...resData.sentMessage, sender: { full_name: 'You', role: isOrganiser ? 'organiser' : 'player' }, recipient_group: null }, ...old.messages] } : { messages: [resData.sentMessage] }
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
      // Pin-on-send — reuses the existing Package 1 pin endpoint rather
      // than a separate mechanism; the "one pinned message per trip"
      // rule and its own confirmation-before-replacing behaviour are
      // already enforced there, not duplicated here.
      if (pinOnSend && resData.sentMessage.id) {
        void handlePinToggle(resData.sentMessage.id, true)
      }
    }
    setDraft('')
    setPinOnSend(false)
    setComposing(false)
    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
  }

  return (
    <div>
      {isOrganiser && (
        <div style={{ marginBottom: 10 }}>
          {!composing ? (
            <button
              onClick={() => setComposing(true)}
              style={{
                width: '100%', padding: '13px 12px', borderRadius: 10, background: '#14532d', color: '#fff',
                border: 'none', fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              📢 Send Event Announcement
            </button>
          ) : (
            <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 12, marginBottom: 8 }}>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Write an announcement for all players…"
                rows={3}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }}
              />
              {/* "optional 📌 Pin this announcement" — reuses the same
                  pin endpoint the message-list pin buttons already call,
                  fired right after a successful send rather than a
                  separate action the organiser has to remember to do
                  afterward. */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', cursor: 'pointer' }}>
                <input type="checkbox" checked={pinOnSend} onChange={e => setPinOnSend(e.target.checked)} />
                📌 Pin this announcement
              </label>
              {sendError && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{sendError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={handleSendAnnouncement} disabled={sending || !draft.trim()} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: sending ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.6 : 1 }}>
                  {sending ? 'Sending…' : 'Send Announcement'}
                </button>
                <button onClick={() => { setComposing(false); setDraft(''); setSendError(''); setPinOnSend(false) }} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {/* Layout fix — target order is button/form first, then this
              helper text directly below it (previously the reverse).
              Kept OUTSIDE both branches deliberately — "Do NOT hide the
              Announcement helper text" means it must stay visible while
              composing too, not just in the collapsed state. Text and
              visibility rule unchanged, position only. */}
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Event Announcement · organiser-only, sent to everyone
          </div>
        </div>
      )}

      {/* Item 1 fix — the actual bug: this composer was previously gated
          `!isOrganiser`, meaning organisers got the Announcement
          composer and a separate standalone Moment panel, but ZERO
          normal chat input — "Do not leave organisers with only
          Announcement + giant Moment panel and no normal chat." Now
          shown for both roles, unconditionally — this IS "Trip Chat",
          the same normal experience every player already had, with the
          Moment action compact and inline (MomentCapture's own default
          'closed' stage is already just the small "📷 Moment" pill;
          nothing here forces it open). The organiser's previous
          separate "Capture a Moment" panel is removed entirely — this
          one composer now covers both send-a-message and Moment
          capture for every role, matching the required layout order:
          Event Announcement, then Trip Chat, then the shared feed. */}
      <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: '10px 12px', marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Trip Chat
          </div>
          <MomentCapture tripId={tripId} roundId={roundId} holeNumber={holeNumber} myGroupId={myGroupId} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={chatDraft}
            onChange={e => setChatDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !chatSending) handleSendChat() }}
            placeholder="Message everyone…"
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
        {/* Full error state — only when nothing has ever loaded. If cached
            messages exist, a failed background refetch must never hide
            them behind this; see the small banner below instead. */}
        {error && !data && (
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
        {/* Small, non-blocking banner — a background refresh failed, but
            the cached messages below remain fully visible and usable. */}
        {error && data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', marginBottom: 8, borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#92400e' }}>Couldn&apos;t refresh.</span>
            <button
              onClick={() => refetch()}
              style={{ background: 'none', border: 'none', color: '#92400e', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Retry
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
        {/* Item 8 — the pinned message shown prominently at the top,
            separate from the chronological flow below (which also still
            shows it, highlighted, in its original position — "original
            message can remain in chronological chat"). Only rendered
            when one exists; enforced server-side to be at most one. */}
        {(() => {
          const pinned = (data?.messages ?? []).find(m => m.is_pinned)
          if (!pinned) return null
          return (
            <div style={{
              background: '#fdf3d9', border: '1.5px solid #c9a84c', borderRadius: 12,
              padding: '12px 14px', marginBottom: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
            }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
                📌 Pinned
              </div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>{pinned.message}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#a1791f', marginTop: 3 }}>
                — {pinned.sender?.full_name ?? 'Organiser'}
              </p>
            </div>
          )
        })()}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: meta.labelColor }}>
                  {m.is_pinned && '📌 '}{meta.icon} {meta.label} · {recipientLabel(m)} · {relativeTime(m.created_at)}
                </span>
                {/* Item 8 — Trip Chat pinning. Organiser-only, per
                    "players can read but cannot pin/unpin". A player
                    who isn't the organiser simply never sees this
                    control at all, rather than seeing it disabled. */}
                {isOrganiser && (
                  <button
                    onClick={() => void handlePinToggle(m.id, !m.is_pinned)}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700,
                      color: m.is_pinned ? '#a1791f' : '#9ca3af', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
                    }}
                  >
                    {m.is_pinned ? 'Unpin' : '📌 Pin'}
                  </button>
                )}
              </div>
              {kind === 'moment' && m.momentImageUrl && (
                <button
                  onClick={() => setViewingMoment({ imageUrl: m.momentImageUrl ?? null, caption: m.message, playerName: m.momentPlayerName ?? m.sender?.full_name, holeNumber: m.momentHoleNumber, createdAt: m.created_at })}
                  aria-label="View Moment"
                  style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer', marginBottom: 6 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a
                      signed Supabase Storage URL, not a static asset next/image
                      can optimize */}
                  <img src={m.momentImageUrl} alt="Moment" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                </button>
              )}
              {kind === 'moment' && m.momentHoleNumber && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#a1791f', marginBottom: 2 }}>
                  Hole {m.momentHoleNumber}
                </div>
              )}
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>{m.message}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                {/* Item 4 — for a Moment specifically, the primary
                    attribution is the SUBJECT (momentPlayerName —
                    Marnie), not sender_user_id (Alex, the uploader).
                    Every other message type is completely unchanged —
                    this only branches on kind === 'moment'. When the
                    uploader genuinely differs from the subject (a
                    proxy capture), "Captured by Alex" is shown as
                    secondary provenance, matching the brief's own
                    "if provenance is shown somewhere administrative,
                    it may say Captured by Alex — but the story should
                    not attribute the Moment itself to Alex." */}
                {kind === 'moment' && m.momentPlayerName ? (
                  <>
                    — {m.momentPlayerName}
                    {m.momentPlayerName !== m.sender?.full_name && (
                      <span style={{ marginLeft: 4 }}>· Captured by {m.sender?.full_name ?? 'Unknown participant'}</span>
                    )}
                  </>
                ) : (
                  <>— <Link href={`/trips/${tripId}/players/${m.sender_user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>{m.sender?.full_name ?? 'Unknown participant'}</Link></>
                )}
                {m.sender?.role && <span style={{ color: '#c3c8ce' }}> · {m.sender.role === 'organiser' ? 'Organiser' : m.sender.role === 'player' ? 'Player' : 'Member'}</span>}
              </p>
            </div>
          )
        })}
      </div>

      {viewingMoment && <MomentViewer moment={viewingMoment} onClose={() => setViewingMoment(null)} />}
    </div>
  )
}
