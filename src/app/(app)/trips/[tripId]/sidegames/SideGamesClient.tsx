'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface Leader { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null }
interface HistoryEntry { playerName: string; resultValue: number | null; sequenceNumber: number }
interface Competition {
  id: string; compType: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay'; holeNumber: number | null
  currentLeader: Leader | null; leadChangeCount: number; hotlyContested: boolean
  isComplete: boolean; winner: Leader | null; history: HistoryEntry[]
  // Only meaningful for compType === 'powerplay' — a different kind of
  // "result" (best authoritative score, not a submitted leader).
  powerplayBest: { playerId: string; playerName: string; points: number } | null
}
interface SideGamesData {
  competitions: Competition[]
}

const COMP_META: Record<Competition['compType'], { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
  powerplay:     { icon: '⚡', label: 'Powerplay' },
}

export default function SideGamesClient({ tripId, round }: { tripId: string; round: { id: string; name: string; course_name: string | null; status: string } | null }) {
  const { data, isLoading } = useQuery<SideGamesData>({
    queryKey: ['side-games', tripId, round?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${round!.id}/side-games`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    enabled: !!round,
    // Live during an active round — mirrors the leaderboard's own
    // polling condition, no new refresh behaviour invented.
    refetchInterval: round?.status === 'active' ? 8000 : false,
  })

  return (
    <div style={{
      minHeight: '100vh', background: '#faf9f6',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
      padding: '16px 16px 90px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Side Games</span>
      </div>

      {!round ? (
        <EmptyState text="No round has been set up yet." />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
          Loading Side Games…
        </div>
      ) : !data || data.competitions.length === 0 ? (
        <EmptyState text="No Side Competitions or Powerplay are configured for this round." />
      ) : (
        <>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {round.name}{round.course_name ? ` — ${round.course_name}` : ''}
          </div>

          {/* Every configured instance renders as its own card, keyed by
              its own id — two NTPs or two Powerplay holes each get a
              separate card, never merged. Powerplay cards render
              differently inside CompetitionCard (best score, not a
              submitted leader) but are otherwise the same list, same
              loop — not a separate section anymore. */}
          {data.competitions.map(comp => <CompetitionCard key={comp.id} comp={comp} />)}
        </>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <p style={{ fontSize: 36, marginBottom: 10 }}>🎯</p>
      <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, maxWidth: 300, margin: '0 auto', lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  )
}

function CompetitionCard({ comp }: { comp: Competition }) {
  const [expanded, setExpanded] = useState(false)
  const meta = COMP_META[comp.compType]
  const displayed = comp.isComplete ? comp.winner : comp.currentLeader

  // Powerplay is a different kind of card entirely — no leader, no
  // leadership history, just the best authoritative score on this
  // specific hole. Rendered independently per instance (own card, own
  // id), so two Powerplay holes never get merged into one card.
  if (comp.compType === 'powerplay') {
    return (
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#7a5c00' }}>
          {meta.icon} {meta.label}{comp.holeNumber ? ` — Hole ${comp.holeNumber}` : ''}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2, marginBottom: 8 }}>
          2× Stableford Points
        </div>
        {comp.powerplayBest ? (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>
            Best so far: {comp.powerplayBest.playerName} — {comp.powerplayBest.points} pts
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>No scores on this hole yet.</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#7a5c00' }}>
            {meta.icon} {meta.label}{comp.holeNumber ? ` — Hole ${comp.holeNumber}` : ''}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
            {comp.isComplete ? '🏆 Winner' : 'Current leader'}
          </div>
        </div>
        {comp.hotlyContested && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>
            🔥 HOTLY CONTESTED
          </span>
        )}
      </div>

      {displayed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {displayed.momentUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset
            <img src={displayed.momentUrl} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
            {displayed.playerName}{displayed.resultValue != null ? ` — ${displayed.resultValue}m` : ''}
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', marginTop: 8 }}>
          No results yet.
        </div>
      )}

      {comp.leadChangeCount > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}
        >
          {expanded ? '▲ Hide' : '▼'} {comp.leadChangeCount} lead change{comp.leadChangeCount === 1 ? '' : 's'}{comp.hotlyContested ? ' 🔥' : ''}
        </button>
      )}

      {expanded && comp.history.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f1', fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
          {comp.history.map((h, i) => (
            <span key={i}>
              {h.playerName}{h.resultValue != null ? ` ${h.resultValue}m` : ''}
              {i < comp.history.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
