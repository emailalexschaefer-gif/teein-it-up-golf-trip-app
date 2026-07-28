'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface GroupPlayer { name: string; holesPlayed: number; finished: boolean; hasMismatch: boolean; waitingForMarker: boolean }
interface GroupProgress {
  groupId: string; groupName: string; playerCount: number; currentHole: number
  status: 'scoring' | 'waiting' | 'reconciliation' | 'finished' | 'needs_attention'
  players: GroupPlayer[]
}
interface Alert { severity: 'red' | 'gold' | 'green' | 'grey'; text: string }
interface TimelineEntry { text: string; at: string }
interface TournamentData {
  roundName: string; scoringFormat: string; roundStatus: string; totalHoles: number
  health: { level: 'green' | 'gold' | 'red'; text: string }
  summary: { players: number; groups: number; scoringNow: number; finishedCount: number; awaitingReconciliation: number; completionPct: number }
  groups: GroupProgress[]
  alerts: Alert[]
  timeline: TimelineEntry[]
  stats: { birdies: number; pars: number; bogeys: number; avgStableford: number; bestHole: { number: number; avgPts: number } | null; hardestHole: { number: number; avgPts: number } | null }
}

const STATUS_META: Record<GroupProgress['status'], { icon: string; label: string; color: string; bg: string }> = {
  scoring:          { icon: '🟢', label: 'Scoring',          color: '#16a34a', bg: '#dcfce7' },
  waiting:          { icon: '🟡', label: 'Awaiting Marker',  color: '#a1791f', bg: '#fdf3d9' },
  reconciliation:   { icon: '🟡', label: 'Reconciliation',   color: '#a1791f', bg: '#fdf3d9' },
  needs_attention:  { icon: '🔴', label: 'Needs Attention',  color: '#dc2626', bg: '#fef2f2' },
  finished:         { icon: '⚪', label: 'Finished',         color: '#6b7280', bg: '#f3f4f6' },
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
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery<TournamentData>({
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

  async function handleClose() {
    setClosing(true); setCloseError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/close`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setCloseError(body.error ?? 'Could not close the round.'); return }
      router.refresh()
      refetch()
    } catch {
      setCloseError('Could not close the round.')
    } finally {
      setClosing(false)
    }
  }

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Loading tournament control…</div>
  }
  if (error || !data) {
    return <div style={{ textAlign: 'center', padding: '32px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Couldn&apos;t load tournament data. It&apos;ll retry automatically.</div>
  }

  const healthBg = data.health.level === 'green' ? '#f0fdf4' : data.health.level === 'gold' ? '#fdf3d9' : '#fef2f2'
  const healthBorder = data.health.level === 'green' ? '#bbf7d0' : data.health.level === 'gold' ? '#e8c96a' : '#fecaca'
  const healthIcon = data.health.level === 'green' ? '🟢' : data.health.level === 'gold' ? '🟡' : '🔴'

  return (
    <div>
      {/* ── 2.1 Tournament Health ─────────────────────────────────────── */}
      <div style={{ background: healthBg, border: `1.5px solid ${healthBorder}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22 }}>{healthIcon}</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>{data.health.text}</span>
      </div>

      {/* ── 2.5 Organiser Close Round — only when genuinely ready ───────── */}
      {roundStatus === 'active' && data.summary.completionPct === 100 && data.summary.awaitingReconciliation === 0 && (
        <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>🟢</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14.5, fontWeight: 800, color: '#14532d' }}>Tournament Ready to Close</span>
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

      {/* ── 2.2 Tournament Summary ────────────────────────────────────── */}
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
                    {g.status === 'finished' ? 'Finished' : `Hole ${g.currentHole}`} · {g.playerCount} player{g.playerCount === 1 ? '' : 's'}
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
                      <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, color: '#14532d', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginRight: 8 }}>
                        {p.finished ? 'Finished' : `Thru ${p.holesPlayed}`}
                      </div>
                      {p.hasMismatch && <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>⚠ mismatch</span>}
                      {!p.hasMismatch && p.waitingForMarker && <span style={{ fontSize: 10, fontWeight: 700, color: '#a1791f' }}>waiting</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── 2.4 Organiser Alerts ──────────────────────────────────────── */}
      <SectionTitle>Alerts</SectionTitle>
      <div style={{ marginBottom: 14 }}>
        {data.alerts.map((a, i) => {
          const c = ALERT_COLOR[a.severity]
          return (
            <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 12px', marginBottom: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: c.text }}>
              {a.text}
            </div>
          )
        })}
      </div>

      {/* ── 2.5 Tournament Timeline ───────────────────────────────────── */}
      <SectionTitle>Timeline</SectionTitle>
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 14, overflow: 'hidden' }}>
        {data.timeline.length === 0 && <EmptyNote>No confirmed scores yet.</EmptyNote>}
        {data.timeline.map((t, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', borderBottom: i < data.timeline.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#14532d' }}>{t.text}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', flexShrink: 0, marginLeft: 8 }}>{relativeTime(t.at)}</span>
          </div>
        ))}
      </div>

      {/* ── 2.6 Quick Actions — only real, existing destinations ───────── */}
      <SectionTitle>Quick Actions</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <Link href={`/trips/${tripId}/rounds/${roundId}/markers`} style={actionLinkStyle}>
          Review Marker Assignments →
        </Link>
        <Link href={`/trips/${tripId}/leaderboard`} style={actionLinkStyle}>
          View Leaderboard →
        </Link>
      </div>

      {/* ── 2.7 Live Statistics ───────────────────────────────────────── */}
      <SectionTitle>Live Statistics</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        <StatCard label="Birdies" value={data.stats.birdies} />
        <StatCard label="Pars" value={data.stats.pars} />
        <StatCard label="Bogeys" value={data.stats.bogeys} />
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
                {g.status === 'finished' ? '—' : `H${g.currentHole}`}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: meta.color, width: 90, textAlign: 'center' }}>
                {meta.icon} {meta.label}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', width: 40, textAlign: 'right' }}>
                {g.status === 'finished' ? '✓' : ''}
              </span>
            </div>
          )
        })}
      </div>
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
