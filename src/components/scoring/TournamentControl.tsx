'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PlayingPartnerStatus from './PlayingPartnerStatus'
import MomentViewer, { type MomentViewerData } from '@/components/moments/MomentViewer'
import MakersBreakers from './MakersBreakers'

interface GroupPlayer {
  playerId: string; name: string; holesPlayed: number; finished: boolean; hasMismatch: boolean; waitingForMarker: boolean
  confirmationState: 'scoring' | 'review_required' | 'ready_to_confirm' | 'confirmed'; submittedAt: string | null
}

// The four required per-player states for My HQ's player list, per the
// explicit spec — 'waitingForMarker' collapses into 'Scoring' here (a
// player still mid-round, whether or not their marker has caught up, is
// still "Scoring" from the organiser's point of view; the distinct
// "waiting" detail remains visible via holesPlayed/Thru N beside it).
const CONFIRMATION_STATE_META: Record<GroupPlayer['confirmationState'], { label: string; color: string }> = {
  scoring:          { label: 'Scoring', color: '#9ca3af' },
  review_required:  { label: '⚠ Review required', color: '#dc2626' },
  ready_to_confirm: { label: 'Ready to confirm', color: '#a1791f' },
  confirmed:        { label: '✓ Confirmed', color: '#16a34a' },
}
interface GroupProgress {
  groupId: string; groupName: string; playerCount: number; currentHole: number
  status: 'scoring' | 'waiting' | 'reconciliation' | 'finished' | 'finished_needs_review' | 'needs_attention'
  players: GroupPlayer[]
}
interface Alert { severity: 'red' | 'gold' | 'green' | 'grey'; kind: 'group'; text: string }
interface MismatchAlert {
  severity: 'red'; kind: 'mismatch'
  playerName: string; markerName: string; groupName: string; groupId: string | null
  hole: number; playerScore: string; markerScore: string; at: string
}
interface StoryEntry { icon: string; text: string; at: string; imageUrl?: string }
// Discriminated timeline item — 'system' entries (golf milestones, group
// finishes, leader changes) stay compact text-only rows exactly as
// before; 'moment' entries carry the actual image so it can be rendered
// inline, per the explicit "display the actual photo, not just an
// activity-log line" requirement. One shared type/renderer for both "The
// Story" and "Event Story" below, rather than two parallel
// implementations of the same card.
//
// Sprint 9 — a 'system' item can now ALSO optionally carry an imageUrl:
// a Side Competition leadership-change event ("Darren takes NTP lead —
// 0.8m") that has a linked Moment surfaces that photo inline with the
// fact itself, rather than as two separate timeline rows. Still
// text-only when imageUrl is absent — the vast majority of golf
// milestones — so this doesn't change how any existing system event
// renders.
type TimelineItem =
  | { kind: 'system'; icon: string; text: string; at: string; imageUrl?: string }
  | { kind: 'moment'; at: string; imageUrl: string | null; caption: string | null; playerName: string; holeNumber: number | null }
interface LeaderboardSnapshotRow { position: number; playerId: string; name: string; totalPts: number; holesPlayed: number; finished: boolean }
interface TournamentData {
  roundName: string; courseName: string | null; scoringFormat: string; roundStatus: string; totalHoles: number
  health: { level: 'green' | 'gold' | 'red'; text: string; topMismatch?: MismatchAlert }
  summary: { players: number; groups: number; scoringNow: number; finishedCount: number; awaitingReconciliation: number; completionPct: number }
  groups: GroupProgress[]
  alerts: Alert[]
  mismatchAlerts: MismatchAlert[]
  leaderboardSnapshot: LeaderboardSnapshotRow[]
  story: StoryEntry[]
  highlights: string[]
  stats: { birdies: number; eagles: number; pars: number; bogeys: number; holeInOnes: number; avgStableford: number; bestHole: { number: number; avgPts: number } | null; hardestHole: { number: number; avgPts: number } | null }
}

const STATUS_META: Record<GroupProgress['status'], { icon: string; label: string; color: string; bg: string }> = {
  scoring:               { icon: '🟢', label: 'Scoring',                  color: '#16a34a', bg: '#dcfce7' },
  waiting:               { icon: '🟡', label: 'Awaiting Marker',          color: '#a1791f', bg: '#fdf3d9' },
  reconciliation:        { icon: '🔴', label: 'Review Required',          color: '#dc2626', bg: '#fef2f2' },
  needs_attention:       { icon: '🔴', label: 'Needs Attention',          color: '#dc2626', bg: '#fef2f2' },
  finished:              { icon: '⚪', label: 'Finished',                 color: '#6b7280', bg: '#f3f4f6' },
  finished_needs_review: { icon: '🔴', label: 'Finished — Review Required', color: '#dc2626', bg: '#fef2f2' },
}

const ALERT_COLOR: Record<Alert['severity'], { text: string; bg: string; border: string }> = {
  red:  { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  gold: { text: '#a1791f', bg: '#fdf3d9', border: '#e8c96a' },
  green:{ text: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  grey: { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export default function TournamentControl({ tripId, roundId, roundStatus }: { tripId: string; roundId: string; roundStatus: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [notifyTarget, setNotifyTarget] = useState<MismatchAlert | null>(null)
  const [notifyDraft, setNotifyDraft] = useState('')
  const [notifySending, setNotifySending] = useState(false)
  const [notifyError, setNotifyError] = useState('')
  const [notifySent, setNotifySent] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState<{ playerId: string; playerName: string } | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockSending, setUnlockSending] = useState(false)
  const [unlockError, setUnlockError] = useState('')

  async function sendUnlock() {
    if (!unlockTarget || !unlockReason.trim()) { setUnlockError('A reason is required.'); return }
    setUnlockSending(true)
    setUnlockError('')
    const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scorecards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock', playerId: unlockTarget.playerId, reason: unlockReason.trim() }),
    })
    const resData = await res.json().catch(() => ({}))
    setUnlockSending(false)
    if (!res.ok) { setUnlockError(resData.error ?? 'Could not unlock this scorecard.'); return }
    setUnlockTarget(null)
    void queryClient.invalidateQueries({ queryKey: ['tournament', tripId, roundId] })
  }

  function openNotify(alert: MismatchAlert) {
    setNotifyTarget(alert)
    setNotifyDraft(`${alert.groupName}: Hole ${alert.hole} has been flagged for score review. Please check the scores for ${alert.playerName} before results are finalised.`)
    setNotifyError('')
    setNotifySent(false)
  }

  async function sendNotify() {
    if (!notifyTarget || !notifyDraft.trim()) return
    setNotifySending(true)
    setNotifyError('')
    const res = await fetch(`/api/trips/${tripId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientType: notifyTarget.groupId ? 'group' : 'all',
        recipientGroupId: notifyTarget.groupId ?? undefined,
        message: notifyDraft.trim(),
      }),
    })
    const resData = await res.json().catch(() => ({}))
    setNotifySending(false)
    if (!res.ok) { setNotifyError(resData.error ?? 'Could not send notification.'); return }
    setNotifySent(true)
    setTimeout(() => setNotifyTarget(null), 1200)
  }
  const [closing, setClosing] = useState(false)
  const [showMakersBreakers, setShowMakersBreakers] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery<TournamentData>({
    queryKey: ['tournament', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/tournament`)
      if (!res.ok) throw new Error('Could not load tournament data.')
      return res.json()
    },
    // Same interval and same conditions as the leaderboard — no new
    // polling behavior invented for this screen.
    refetchInterval: roundStatus === 'active' ? 8000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  })

  // "The Story" (below) previously showed only golf milestones computed
  // server-side (data.story) — a player-posted Moment never appeared
  // there, only in the separate "Event Story" section further down the
  // page, which already merges moments correctly. Root cause: no
  // filtering bug (the /moments endpoint itself is already correctly
  // trip-scoped by RLS only, not filtered by sender/organiser_id — any
  // trip member's Moment is returned), it's simply that this first,
  // most-visible section was never wired to include moments at all.
  // Fetches THIS round's moments specifically (?roundId=), matching this
  // section's own stated scope ("the story of the ROUND") — deliberately
  // a different, more specific query than Event Story's unscoped
  // trip-wide ['moments', tripId] fetch below, so past rounds' moments
  // don't leak into a single round's story.
  const { data: roundMomentsData } = useQuery<{ moments: Moment[] }>({
    queryKey: ['moments', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/moments?roundId=${roundId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 10000,
    refetchOnWindowFocus: true,
  })

  async function handleClose() {
    setClosing(true); setCloseError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/close`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setCloseError(body.error ?? 'Could not close the round.'); return }
      // Trigger sequence: Finish Round -> Reconcile -> Makers & Breakers
      // -> Present Side Games/Round Winners. router.refresh()/refetch()
      // still run immediately so the underlying data is fresh by the
      // time the organiser dismisses the overlay — Makers & Breakers
      // itself does its own independent fetch of the now-completed
      // round's data via the highlights API route.
      setShowMakersBreakers(true)
      router.refresh()
      refetch()
    } catch {
      setCloseError('Could not close the round.')
    } finally {
      setClosing(false)
    }
  }

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Loading My HQ…</div>
  }
  if (showMakersBreakers) {
    // Takes over the whole My HQ view temporarily — matches the brief's
    // explicit sequence (Finish Round -> Reconcile -> Makers & Breakers
    // -> Present Side Games/Round Winners), not a modal layered on top
    // of the normal My HQ content underneath.
    return (
      <MakersBreakers
        tripId={tripId} roundId={roundId}
        onProceedToResults={() => setShowMakersBreakers(false)}
      />
    )
  }
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>
          Couldn&apos;t load My HQ data. It&apos;ll retry automatically.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            padding: '8px 18px', borderRadius: 10, background: '#ffffff', border: '1.5px solid #d1d5db',
            fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d',
            cursor: isFetching ? 'default' : 'pointer', opacity: isFetching ? 0.6 : 1,
          }}
        >
          {isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  const healthBg = data.health.level === 'green' ? '#f0fdf4' : data.health.level === 'gold' ? '#fdf3d9' : '#fef2f2'
  const healthBorder = data.health.level === 'green' ? '#bbf7d0' : data.health.level === 'gold' ? '#e8c96a' : '#fecaca'
  const healthIcon = data.health.level === 'green' ? '🟢' : data.health.level === 'gold' ? '🟡' : '🔴'

  return (
    <div>
      {/* ── 1. Event Health ───────────────────────────────────────────── */}
      <div style={{ background: healthBg, border: `1.5px solid ${healthBorder}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{healthIcon}</span>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: '#9ca3af', textTransform: 'uppercase' }}>Event Health</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>{data.health.text}</div>
          </div>
        </div>
        {data.health.topMismatch && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>
              {data.health.topMismatch.playerName} — Hole {data.health.topMismatch.hole}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 8 }}>
              {data.health.topMismatch.groupName} · Marker mismatch
            </div>
            <Link href={`/trips/${tripId}/rounds/${roundId}?hole=${data.health.topMismatch.hole}`} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#dc2626', textDecoration: 'none' }}>
              Review now →
            </Link>
          </div>
        )}
        {!data.health.topMismatch && data.mismatchAlerts.length > 1 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <a href="#alerts-section" style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#dc2626', textDecoration: 'none' }}>
              View affected players →
            </a>
          </div>
        )}
      </div>

      {/* ── 2.5 Organiser Close Round — only when genuinely ready ───────── */}
      {roundStatus === 'active' && data.summary.completionPct === 100 && data.summary.awaitingReconciliation === 0 && (
        <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>🟢</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14.5, fontWeight: 800, color: '#14532d' }}>Round Ready to Close</span>
          </div>
          {closeError && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{closeError}</div>
          )}
          <button
            onClick={handleClose}
            disabled={closing}
            style={{
              width: '100%', padding: 12, borderRadius: 10, border: 'none',
              background: closing ? '#9ca3af' : 'linear-gradient(135deg,#2d7a52,#16a34a)',
              color: '#fff', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
              cursor: closing ? 'not-allowed' : 'pointer',
            }}
          >
            {closing ? 'Closing…' : 'Close Round'}
          </button>
        </div>
      )}

      {/* ── 2.2 Round Summary ────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 14, padding: '14px 16px', marginBottom: 14, boxShadow: '0 4px 18px rgba(20,83,45,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 16, fontWeight: 800 }}>{data.roundName}</span>
          <span style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 11, fontWeight: 700 }}>{data.scoringFormat}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[
            ['Players', data.summary.players], ['Groups', data.summary.groups], ['Scoring', data.summary.scoringNow],
            ['Finished', data.summary.finishedCount], ['Reconciling', data.summary.awaitingReconciliation], ['Complete', `${data.summary.completionPct}%`],
          ].map(([label, value]) => (
            <div key={label as string} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 18, fontWeight: 800 }}>{value}</div>
              <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.6)', fontSize: 9.5 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${data.summary.completionPct}%`, background: '#e8c96a', borderRadius: 4, transition: 'width 0.6s ease' }} />
        </div>
      </div>

      {/* ── 2.3 Live Group Progress ───────────────────────────────────── */}
      <SectionTitle>Group Progress</SectionTitle>
      <div style={{ marginBottom: 14 }}>
        {data.groups.length === 0 && <EmptyNote>No groups yet.</EmptyNote>}
        {data.groups.map(g => {
          const meta = STATUS_META[g.status]
          const isOpen = expandedGroup === g.groupId
          return (
            <div key={g.groupId} style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedGroup(isOpen ? null : g.groupId)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, color: '#14532d' }}>{g.groupName}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>
                    {(g.status === 'finished' || g.status === 'finished_needs_review') ? 'Finished' : `Hole ${g.currentHole}`} · {g.playerCount} player{g.playerCount === 1 ? '' : 's'}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 12, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                  {meta.icon} {meta.label}
                </span>
                <span style={{ color: '#d1d5db', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div style={{ borderTop: '1px solid #eceae3' }}>
                  {g.players.map(p => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #f3f4f1' }}>
                      <Link href={`/trips/${tripId}/players/${p.playerId}`} style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, color: '#14532d', fontWeight: 600, textDecoration: 'none' }}>{p.name}</Link>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginRight: 8 }}>
                        {p.finished ? 'Finished' : `Thru ${p.holesPlayed}`}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: CONFIRMATION_STATE_META[p.confirmationState].color,
                      }}>
                        {CONFIRMATION_STATE_META[p.confirmationState].label}
                      </span>
                      {p.confirmationState === 'confirmed' && (
                        <button
                          onClick={() => { setUnlockTarget({ playerId: p.playerId, playerName: p.name }); setUnlockReason(''); setUnlockError('') }}
                          style={{ marginLeft: 8, background: 'none', border: 'none', color: '#9ca3af', fontFamily: 'var(--font-body)', fontSize: 10, textDecoration: 'underline', cursor: 'pointer' }}
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── 2.4 Organiser Alerts ──────────────────────────────────────── */}
      <div id="alerts-section">
        <SectionTitle>Alerts</SectionTitle>
      </div>
      <div style={{ marginBottom: 14 }}>
        {data.mismatchAlerts.map((m, i) => (
          <div key={`mismatch-${i}`} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>
              Marker mismatch
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: '#14532d' }}>
              {m.playerName} — Hole {m.hole}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', marginTop: 2 }}>
              Player score: <strong>{m.playerScore}</strong> &nbsp; Marker score ({m.markerName}): <strong>{m.markerScore}</strong>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              {m.groupName}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <Link href={`/trips/${tripId}/rounds/${roundId}?hole=${m.hole}`} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#dc2626', textDecoration: 'none' }}>
                Review Score →
              </Link>
              <button onClick={() => openNotify(m)} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#a1791f', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Notify Group →
              </button>
            </div>
          </div>
        ))}
        {data.alerts.map((a, i) => {
          const c = ALERT_COLOR[a.severity]
          return (
            <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 12px', marginBottom: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: c.text }}>
              {a.text}
            </div>
          )
        })}
      </div>

      {/* ── Notify Group composer — pre-populated, editable, per the
          explicit flow: Notify Group -> composer -> Send/Cancel. ────────── */}
      {notifyTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#ffffff', borderRadius: '16px 16px 0 0', padding: 16, width: '100%' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
              Notify {notifyTarget.groupName}
            </div>
            <textarea
              value={notifyDraft}
              onChange={e => setNotifyDraft(e.target.value)}
              rows={4}
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }}
            />
            {notifyError && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{notifyError}</p>}
            {notifySent && <p style={{ color: '#16a34a', fontSize: 12, marginTop: 6, fontFamily: 'var(--font-body)', fontWeight: 700 }}>✓ Notification sent</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={sendNotify} disabled={notifySending || notifySent || !notifyDraft.trim()} style={{ flex: 1, padding: 12, borderRadius: 10, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: notifySending || notifySent ? 0.6 : 1 }}>
                {notifySending ? 'Sending…' : notifySent ? 'Sent ✓' : 'Send Notification'}
              </button>
              <button onClick={() => setNotifyTarget(null)} style={{ flex: 1, padding: 12, borderRadius: 10, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Organiser unlock/override — explicit action, required reason,
          confirmation warning, per Package 6's audit requirements. Resets
          the player's confirmation on success (handled server-side). ── */}
      {unlockTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#ffffff', borderRadius: '16px 16px 0 0', padding: 16, width: '100%' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
              Unlock {unlockTarget.playerName}&apos;s scorecard?
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>
              This player confirmed their final scores. Unlocking allows them to
              make a correction, but they&apos;ll need to confirm again before
              results can include their scorecard. This action is recorded.
            </div>
            <textarea
              value={unlockReason}
              onChange={e => setUnlockReason(e.target.value)}
              placeholder="Reason for unlocking (required)"
              rows={3}
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }}
            />
            {unlockError && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{unlockError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={sendUnlock}
                disabled={unlockSending || !unlockReason.trim()}
                style={{ flex: 1, padding: 12, borderRadius: 10, background: '#dc2626', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: unlockSending ? 'default' : 'pointer', opacity: unlockSending || !unlockReason.trim() ? 0.6 : 1 }}
              >
                {unlockSending ? 'Unlocking…' : 'Unlock Scorecard'}
              </button>
              <button onClick={() => setUnlockTarget(null)} disabled={unlockSending} style={{ flex: 1, padding: 12, borderRadius: 10, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Today's Highlights — post-round only, real numbers only ────── */}
      {data.highlights.length > 0 && (
        <>
          <SectionTitle>Today&apos;s Highlights</SectionTitle>
          <div style={{ background: 'linear-gradient(135deg,#fdf3d9,#fbe8bc)', borderRadius: 14, border: '1px solid #e8c96a', padding: '14px 16px', marginBottom: 14 }}>
            {data.highlights.map((h, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#5a4310', marginBottom: i < data.highlights.length - 1 ? 8 : 0 }}>
                {h}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Leaderboard Snapshot — top 5 only, never the full board ────── */}
      <SectionTitle>Leaderboard Snapshot</SectionTitle>
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 8, overflow: 'hidden' }}>
        {data.leaderboardSnapshot.length === 0 && <EmptyNote>No scores yet.</EmptyNote>}
        {data.leaderboardSnapshot.map((row, i) => (
          <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < data.leaderboardSnapshot.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
            <span style={{ width: 20, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: row.position <= 3 ? '#a1791f' : '#9ca3af' }}>{row.position}</span>
            <Link href={`/trips/${tripId}/players/${row.playerId}`} style={{ flex: 1, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', textDecoration: 'none' }}>{row.name}</Link>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>{row.finished ? 'Finished' : `Thru ${row.holesPlayed}`}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#14532d' }}>{row.totalPts} pts</span>
          </div>
        ))}
      </div>
      <Link href={`/trips/${tripId}/leaderboard`} style={{ ...actionLinkStyle, textAlign: 'center', marginBottom: 14, display: 'block' }}>
        View Full Leaderboard →
      </Link>

      {/* ── Side Games Snapshot — placeholder only, no data model exists
          yet, so no fabricated statuses. Matches how Moments is handled:
          a real, honest "not yet available" state, not a broken button. ── */}
      <SectionTitle>Side Games Snapshot</SectionTitle>
      <Link href={`/trips/${tripId}/sidegames`} style={{ display: 'block', background: '#f3f4f6', border: '1px dashed #d1d5db', borderRadius: 12, padding: '12px 14px', marginBottom: 14, textDecoration: 'none', textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>Not set up for this round yet — tap to open Side Games</span>
      </Link>

      {/* ── The Story — milestones only, never every hole or every score.
          Rebuilt from real entered_at timestamps (see the API route) —
          lead changes, hole-in-ones, review moments, group finishes,
          not an activity log. Also merges in this round's Moments
          (any trip member's, not just the organiser's — see
          roundMomentsData above), chronologically alongside the golf
          milestones, so a player-posted Moment shows up here too, not
          only in Event Story further down. ───────────────────────────── */}
      {/* ── Round Story header — the beginning of "each round is a
          chapter" (Event Story architecture). Uses data already in this
          response (roundName/courseName) — no new query. Deliberately
          minimal: just names which round's chapter this is; the actual
          multi-round/trip-level Event Story view stays out of scope for
          this pass, per the explicit "prepare, don't overbuild"
          instruction. ─────────────────────────────────────────────────── */}
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 13, fontWeight: 800, letterSpacing: 0.3, marginBottom: 6, textTransform: 'uppercase' }}>
        {data.roundName}{data.courseName ? ` — ${data.courseName}` : ''}
      </div>
      <SectionTitle>The Story</SectionTitle>
      {(() => {
        const roundMomentItems: TimelineItem[] = (roundMomentsData?.moments ?? []).map(m => ({
          kind: 'moment', at: m.created_at, imageUrl: m.imageUrl, caption: m.caption,
          playerName: m.playerName, holeNumber: m.hole_number,
        }))
        const systemItems: TimelineItem[] = data.story.map(s => ({ kind: 'system', icon: s.icon, text: s.text, at: s.at, imageUrl: s.imageUrl }))
        const storyCombined: TimelineItem[] = [...systemItems, ...roundMomentItems].sort((a, b) => b.at.localeCompare(a.at))
        if (storyCombined.length === 0) return <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 14, overflow: 'hidden' }}><EmptyNote>The story of the round will appear here as it unfolds.</EmptyNote></div>
        return <div style={{ marginBottom: 14 }}><StoryTimelineList items={storyCombined} /></div>
      })()}

      {/* Deployment A — passive-only pairing visibility, replacing the
          removed active reassignment link above. */}
      <PlayingPartnerStatus tripId={tripId} roundId={roundId} />

      {/* ── Quick Actions — only real, existing destinations ───────────── */}
      <SectionTitle>Quick Actions</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {/* Deployment A — "Review Marker Assignments" (an active
            reassign/regenerate workflow) removed from the normal round
            setup path entirely, per explicit instruction: organiser
            involvement in pairing is now limited to group creation and,
            at most, passive visibility — this link was the one place an
            organiser could actively override a player's own pairing
            choice, which the new player-led Playing Partner model
            deliberately doesn't want happening through routine
            navigation. The underlying route/page still exist (not
            deleted), simply no longer linked from here. */}
        <Link href={`/trips/${tripId}`} style={actionLinkStyle}>
          Edit Groups →
        </Link>
        <Link href={`/trips/${tripId}/leaderboard`} style={actionLinkStyle}>
          View Leaderboard →
        </Link>
      </div>

      {/* ── Live Statistics ───────────────────────────────────────────── */}
      <SectionTitle>Live Statistics</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        <StatCard label="Birdies" value={data.stats.birdies} />
        <StatCard label="Eagles" value={data.stats.eagles} />
        <StatCard label="Hole-in-ones" value={data.stats.holeInOnes} />
        <StatCard label="Avg Stableford" value={data.stats.avgStableford} />
        <StatCard label="Best Hole" value={data.stats.bestHole ? `H${data.stats.bestHole.number}` : '—'} sub={data.stats.bestHole ? `${data.stats.bestHole.avgPts} pts avg` : undefined} />
        <StatCard label="Hardest Hole" value={data.stats.hardestHole ? `H${data.stats.hardestHole.number}` : '—'} sub={data.stats.hardestHole ? `${data.stats.hardestHole.avgPts} pts avg` : undefined} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', borderRadius: 10, background: '#f3f4f6', border: '1px dashed #d1d5db' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af' }}>Longest Drive</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Coming in Sprint 5D</div>
        </div>
        <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', borderRadius: 10, background: '#f3f4f6', border: '1px dashed #d1d5db' }}>

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af' }}>Nearest Pin</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Coming in Sprint 5D</div>
        </div>
      </div>

      {/* ── 2.8 Group Map — compact operational table ────────────────── */}
      <SectionTitle>Group Map</SectionTitle>
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {data.groups.map((g, i) => {
          const meta = STATUS_META[g.status]
          return (
            <div key={g.groupId} style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderBottom: i < data.groups.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>{g.groupName}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', width: 60, textAlign: 'center' }}>
                {(g.status === 'finished' || g.status === 'finished_needs_review') ? '—' : `H${g.currentHole}`}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: meta.color, width: 90, textAlign: 'center' }}>
                {meta.icon} {meta.label}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', width: 40, textAlign: 'right' }}>
                {(g.status === 'finished' || g.status === 'finished_needs_review') ? '✓' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* ── Event Story — Sprint 6. Merges the Golf Story milestones
          already computed above ("The Story" section, unchanged) with
          real captured Moments, chronologically. Golf Story records
          scores/leader-changes/milestones; Event Story records people,
          celebrations, and memories — two separate timelines that
          combine here into one, per the brief's own product principle.
          Moments are fetched once via their own query (not folded into
          the tournament query), so this section can refresh
          independently without recomputing the checkpoint-replay logic. */}
      <SectionTitle>Event Story</SectionTitle>
      <EventStorySection tripId={tripId} golfStory={data.story} />
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#a1791f', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '16px 14px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>
      {children}
    </div>
  )
}

/**
 * Shared timeline renderer for both "The Story" (this round) and "Event
 * Story" (whole trip) — one implementation, per the explicit "reuse
 * existing components" instruction, rather than two copies of the same
 * card markup. 'system' items stay compact (icon + text + time); 'moment'
 * items get visual prominence: the actual image inline, tappable into
 * the same shared MomentViewer every other surface uses. `limit` caps how
 * many rows render (Event Story shows more history than The Story).
 */
function StoryTimelineList({ items, limit }: { items: TimelineItem[]; limit?: number }) {
  const [viewing, setViewing] = useState<MomentViewerData | null>(null)
  const visible = typeof limit === 'number' ? items.slice(0, limit) : items

  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      {visible.map((item, i) => {
        const isLast = i === visible.length - 1
        if (item.kind === 'moment') {
          return (
            <div key={i} style={{ padding: '10px 14px', borderBottom: isLast ? 'none' : '1px solid #f3f4f1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>📷</span>
                <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d' }}>
                  {item.playerName} shared a Moment
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{relativeTime(item.at)}</span>
              </div>
              {item.imageUrl && (
                <button
                  onClick={() => setViewing({ imageUrl: item.imageUrl, caption: item.caption, playerName: item.playerName, holeNumber: item.holeNumber, createdAt: item.at })}
                  aria-label="View Moment"
                  style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset */}
                  <img src={item.imageUrl} alt="Moment" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                </button>
              )}
              {item.caption && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', marginTop: 6, lineHeight: 1.4 }}>{item.caption}</p>
              )}
            </div>
          )
        }
        return (
          <div key={i} style={{ padding: '9px 14px', borderBottom: isLast ? 'none' : '1px solid #f3f4f1' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#14532d' }}>{item.text}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', flexShrink: 0, marginLeft: 8 }}>{relativeTime(item.at)}</span>
            </div>
            {/* Sprint 9 — a Side Competition leadership event with a
                linked Moment surfaces the actual photo right here,
                inline with the fact, rather than as a separate row.
                Tappable into the same shared MomentViewer everything
                else uses. */}
            {item.imageUrl && (
              <button
                onClick={() => setViewing({ imageUrl: item.imageUrl!, caption: null, playerName: null, holeNumber: null, createdAt: item.at })}
                aria-label="View photo"
                style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer', marginTop: 8 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset */}
                <img src={item.imageUrl} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              </button>
            )}
          </div>
        )
      })}
      {viewing && <MomentViewer moment={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 10, border: '1px solid #eceae3', padding: '10px 6px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#14532d' }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#9ca3af', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#c9a84c', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

const actionLinkStyle: CSSProperties = {
  display: 'block', padding: '12px 14px', borderRadius: 10,
  background: '#ffffff', border: '1.5px solid #d1d5db',
  fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: '#14532d',
  textDecoration: 'none',
}

interface Moment {
  id: string; caption: string | null; hole_number: number | null; created_at: string
  imageUrl: string | null; playerName: string
}

function EventStorySection({ tripId, golfStory }: { tripId: string; golfStory: StoryEntry[] }) {
  const { data } = useQuery<{ moments: Moment[] }>({
    queryKey: ['moments', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/moments`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 30000,
  })

  const momentItems: TimelineItem[] = (data?.moments ?? []).map(m => ({
    kind: 'moment', at: m.created_at, imageUrl: m.imageUrl, caption: m.caption,
    playerName: m.playerName, holeNumber: m.hole_number,
  }))
  const systemItems: TimelineItem[] = golfStory.map(s => ({ kind: 'system', icon: s.icon, text: s.text, at: s.at, imageUrl: s.imageUrl }))

  // Merge the two timelines and sort chronologically — Golf Story
  // (scores/milestones) and Moments (people/memories) are computed
  // independently, per the brief's own "two separate timelines" framing,
  // and only combined here for display.
  const combined: TimelineItem[] = [...systemItems, ...momentItems].sort((a, b) => b.at.localeCompare(a.at))

  if (combined.length === 0) {
    return (
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '24px 16px', textAlign: 'center' }}>
        <p style={{ fontSize: 28, marginBottom: 8 }}>📸</p>
        <p style={{ fontFamily: 'var(--font-body)', color: '#14532d', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          The story of the event will appear here
        </p>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 12.5, lineHeight: 1.5 }}>
          Round milestones and Moments captured in Chat will appear together, chronologically.
        </p>
      </div>
    )
  }

  return <StoryTimelineList items={combined} limit={20} />
}
