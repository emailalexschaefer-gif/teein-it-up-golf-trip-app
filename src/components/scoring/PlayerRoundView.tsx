'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import MomentViewer, { type MomentViewerData } from '@/components/moments/MomentViewer'

interface MyRoundData {
  hasScorecard: boolean
  roundName: string
  roundStatus: string
  scoringFormat?: string
  status?: 'waiting_for_round' | 'active' | 'review_required' | 'complete' | 'published'
  playingHandicap?: number
  holesPlayed?: number; totalHoles?: number; finished?: boolean
  totalPts?: number; front9Pts?: number; back9Pts?: number
  position?: number; totalPlayers?: number
  birdies?: number; eagles?: number; holeInOnes?: number
  bestHole?: { number: number; pts: number } | null
  mismatches?: { hole: number; playerScore: string; markerScore: string }[]
  waitingForMarker?: boolean
  groupName?: string | null; groupMembers?: string[]; markerName?: string | null
  story?: { icon: string; text: string }[]
}

const STATUS_META: Record<string, { icon: string; title: string; color: string; bg: string }> = {
  waiting_for_round: { icon: '🟡', title: 'Waiting for the round to start', color: '#a1791f', bg: '#fdf3d9' },
  active:            { icon: '🟢', title: 'Round in progress',              color: '#16a34a', bg: '#f0fdf4' },
  review_required:   { icon: '🔴', title: 'Your score needs review',        color: '#dc2626', bg: '#fef2f2' },
  complete:          { icon: '✅', title: 'Your scoring is complete',       color: '#16a34a', bg: '#f0fdf4' },
  published:         { icon: '🏆', title: 'Results are ready',              color: '#a1791f', bg: '#fdf3d9' },
}

export default function PlayerRoundView({
  tripId, roundId, roundStatus, roundName, courseName, playDate, teeTime, groupsReleased,
}: {
  tripId: string; roundId: string; roundStatus: string
  roundName?: string; courseName?: string | null; playDate?: string; teeTime?: string | null; groupsReleased?: boolean
}) {
  const { data, isLoading, error, refetch } = useQuery<MyRoundData>({
    queryKey: ['my-round', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/my-round`)
      if (!res.ok) throw new Error('Could not load your round.')
      return res.json()
    },
    refetchInterval: roundStatus === 'active' ? 8000 : false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  if (isLoading) return <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Loading your round…</div>
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, marginBottom: 10 }}>Your round is temporarily unavailable.</p>
        <button onClick={() => refetch()} style={{ padding: '8px 18px', borderRadius: 10, background: '#ffffff', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d', cursor: 'pointer' }}>Try Again</button>
      </div>
    )
  }

  // Deployment 1 — pre-event My Round preview. Deliberately gated on
  // roundStatus (the round's own lifecycle state, always meaningful)
  // rather than data.hasScorecard/data.status — an upcoming round can
  // have no scorecard, a scorecard with no scores, or anything in
  // between depending on exactly when the organiser ran Begin Round's
  // setup, but none of that matters here: nothing worth showing as
  // "live" can exist yet either way, so every upcoming round gets the
  // same honest preview rather than a different dead-state message per
  // internal detail. Previously this was two separate negative
  // messages ("You're not in this round yet...", "Your organiser is
  // preparing...") depending on exactly that internal state.
  if (roundStatus === 'upcoming') {
    return (
      <PreEventMyRound
        roundName={roundName ?? data.roundName} courseName={courseName} playDate={playDate} teeTime={teeTime}
        groupName={groupsReleased ? data.groupName : null}
      />
    )
  }

  if (!data.hasScorecard) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px' }}>
        <p style={{ fontSize: 32, marginBottom: 8 }}>⛳</p>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>You&apos;re not in this round yet. Your organiser is preparing groups, tee times and scorecards.</p>
      </div>
    )
  }

  const meta = STATUS_META[data.status ?? 'waiting_for_round']

  return (
    <div>
      {/* 1. Status / next action */}
      <div style={{ background: meta.bg, border: `1.5px solid ${meta.color}33`, borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: data.status === 'review_required' || data.status === 'active' || data.status === 'complete' || data.status === 'published' ? 10 : 0 }}>
          <span style={{ fontSize: 20 }}>{meta.icon}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>{meta.title}</span>
        </div>
        {data.status === 'waiting_for_round' && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#6b7280' }}>Your organiser is preparing groups, tee times and scorecards.</p>
        )}
        {data.status === 'review_required' && data.mismatches && data.mismatches.length > 0 && (
          <>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 8 }}>
              Hole {data.mismatches[0].hole} · Marker mismatch
            </p>
            <Link href={`/trips/${tripId}/rounds/${roundId}?hole=${data.mismatches[0].hole}`} style={{ display: 'block', textAlign: 'center', padding: 11, borderRadius: 10, background: '#dc2626', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
              Review Score →
            </Link>
          </>
        )}
        {data.status === 'active' && (
          <Link href={`/trips/${tripId}/rounds/${roundId}`} style={{ display: 'block', textAlign: 'center', padding: 11, borderRadius: 10, background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Continue Scoring →
          </Link>
        )}
        {data.status === 'complete' && (
          <Link href={`/trips/${tripId}/leaderboard`} style={{ display: 'block', textAlign: 'center', padding: 11, borderRadius: 10, background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            View Live Leaderboard →
          </Link>
        )}
        {data.status === 'published' && (
          <Link href={`/trips/${tripId}/leaderboard`} style={{ display: 'block', textAlign: 'center', padding: 11, borderRadius: 10, background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            View Final Results →
          </Link>
        )}
      </div>

      {/* 2. Personal score snapshot */}
      {data.holesPlayed !== undefined && data.holesPlayed > 0 && (
        <>
          <SectionLabel>How you&apos;re going</SectionLabel>
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
              <Stat label="Points" value={data.totalPts ?? 0} big />
              <Stat label="Thru" value={`${data.holesPlayed}/${data.totalHoles ?? 18}`} big />
              <Stat label="Position" value={data.position ? `${data.position}/${data.totalPlayers}` : '—'} big />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', borderTop: '1px solid #f3f4f1', paddingTop: 10, marginBottom: 10 }}>
              <span>Front 9: <strong style={{ color: '#14532d' }}>{data.front9Pts ?? 0}</strong></span>
              <span>Back 9: <strong style={{ color: '#14532d' }}>{data.back9Pts ?? 0}</strong></span>
              <span>HCP: <strong style={{ color: '#14532d' }}>{data.playingHandicap}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280' }}>
              {(data.birdies ?? 0) > 0 && <span>⛳ {data.birdies} birdie{data.birdies === 1 ? '' : 's'}</span>}
              {(data.eagles ?? 0) > 0 && <span>🦅 {data.eagles} eagle{data.eagles === 1 ? '' : 's'}</span>}
              {(data.holeInOnes ?? 0) > 0 && <span>🏆 {data.holeInOnes} hole-in-one{data.holeInOnes === 1 ? '' : 's'}</span>}
              {data.bestHole && <span>Best: H{data.bestHole.number} ({data.bestHole.pts} pts)</span>}
            </div>
          </div>
        </>
      )}

      {/* 3. Personal alerts — only issues affecting this player */}
      {data.mismatches && data.mismatches.length > 0 && data.status !== 'review_required' && (
        <>
          <SectionLabel>Needs your attention</SectionLabel>
          <div style={{ marginBottom: 16 }}>
            {data.mismatches.map(m => (
              <Link key={m.hole} href={`/trips/${tripId}/rounds/${roundId}?hole=${m.hole}`} style={{ display: 'block', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 6, textDecoration: 'none' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#dc2626' }}>Hole {m.hole} — mismatch, tap to fix →</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* My Group */}
      {data.groupName && (
        <>
          <SectionLabel>My Group</SectionLabel>
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 14, marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', marginBottom: 4 }}>{data.groupName}</div>
            {data.groupMembers && data.groupMembers.length > 0 && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#6b7280', marginBottom: data.markerName ? 4 : 0 }}>
                {data.groupMembers.join(', ')}
              </div>
            )}
            {data.markerName && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>Playing Partner: {data.markerName}</div>
            )}
          </div>
        </>
      )}

      {/* 5. My Golf Story — personal milestones only */}
      {data.story && data.story.length > 0 && (
        <>
          <SectionLabel>What happened today</SectionLabel>
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            {data.story.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: i < data.story!.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#14532d' }}>{s.text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 6. My Moments — Sprint 6, Part 5. Only this player's own captured
          Moments, thumbnail + caption + hole + time. A separate query
          from the round-summary one above, since Moments can span the
          whole trip, not just this round. */}
      <MyMoments tripId={tripId} />
    </div>
  )
}

function MyMoments({ tripId }: { tripId: string }) {
  const [viewing, setViewing] = useState<MomentViewerData | null>(null)
  const { data: momentsData } = useQuery<{ moments: { id: string; caption: string | null; hole_number: number | null; created_at: string; imageUrl: string | null }[] }>({
    queryKey: ['my-moments', tripId],
    queryFn: async () => {
      // This component only knows tripId/roundId, not its own user id —
      // resolve it client-side first, then filter server-side via
      // ?playerId= (the moments GET route already supports this filter),
      // rather than fetching everyone's moments and filtering in the
      // browser.
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { moments: [] }
      const res = await fetch(`/api/trips/${tripId}/moments?playerId=${user.id}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 30000,
  })

  if (!momentsData || momentsData.moments.length === 0) return null

  return (
    <>
      <SectionLabel>My Moments</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {momentsData.moments.map(m => (
          <div key={m.id} style={{ width: 104, background: '#ffffff', borderRadius: 10, border: '1px solid #eceae3', overflow: 'hidden' }}>
            {m.imageUrl && (
              <button
                onClick={() => setViewing({ imageUrl: m.imageUrl, caption: m.caption, holeNumber: m.hole_number, createdAt: m.created_at })}
                aria-label="View Moment"
                style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a
                    signed Supabase Storage URL, not a static asset */}
                <img src={m.imageUrl} alt="Moment" style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
              </button>
            )}
            <div style={{ padding: '5px 6px' }}>
              {m.hole_number && <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#a1791f' }}>Hole {m.hole_number}</div>}
              {m.caption && <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#14532d', lineHeight: 1.3 }}>{m.caption}</div>}
            </div>
          </div>
        ))}
      </div>
      {viewing && <MomentViewer moment={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#a1791f', marginBottom: 8 }}>
      {children}
    </div>
  )
}

/**
 * Deployment 1 — pre-event My Round preview. Only previews sections
 * that genuinely exist below in this same file once the round is live
 * — "How you're going" (Performance stats), My Group, "What happened
 * today" (Golf Story), My Moments — deliberately not a "Side Games"
 * card, since My Round has no dedicated Side Games section of its own
 * (that's its own separate tab); inventing one here would violate "Do
 * NOT invent fake features merely to fill space."
 */
function PreEventMyRound({
  roundName, courseName, playDate, teeTime, groupName,
}: { roundName?: string; courseName?: string | null; playDate?: string; teeTime?: string | null; groupName?: string | null }) {
  const formattedDate = playDate
    ? new Date(`${playDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null
  const formattedTime = teeTime ? formatTeeTime(teeTime) : null

  return (
    <div>
      <div style={{ background: 'linear-gradient(135deg,#0f2d1c,#1a4731)', borderRadius: 16, padding: '18px 18px', marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(245,230,184,0.6)', marginBottom: 4 }}>
          {roundName ?? 'Round'} · Upcoming
        </div>
        {courseName && <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#fff' }}>{courseName}</div>}
        {(formattedDate || formattedTime) && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(245,230,184,0.75)', marginTop: 4 }}>
            {[formattedDate, formattedTime].filter(Boolean).join(' · ')}
          </div>
        )}
        {groupName && (
          <div style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 20, background: 'rgba(232,201,106,0.15)', border: '1px solid rgba(232,201,106,0.4)' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#e8c96a' }}>{groupName}</span>
          </div>
        )}
      </div>

      <SectionLabel>📊 My Performance</SectionLabel>
      <PreviewCard>Your Stableford score and round statistics will build here as you play.</PreviewCard>

      <SectionLabel>👥 My Group</SectionLabel>
      <PreviewCard>{groupName ? `You're playing in ${groupName}.` : 'Your playing group will appear here once the organiser releases it.'}</PreviewCard>

      <SectionLabel>📖 What Happened Today</SectionLabel>
      <PreviewCard>Your scoring highlights and milestones will be captured here as your round unfolds.</PreviewCard>

      <SectionLabel>📸 My Moments</SectionLabel>
      <PreviewCard>Photos and memorable moments you capture during the round will appear here.</PreviewCard>
    </div>
  )
}

function PreviewCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px dashed #d9c9a3', padding: 16, marginBottom: 16 }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', lineHeight: 1.5 }}>{children}</p>
    </div>
  )
}

function formatTeeTime(teeTime: string): string {
  const [hStr, mStr] = teeTime.split(':')
  const h = Number(hStr)
  if (Number.isNaN(h)) return teeTime
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mStr} ${period}`
}

function Stat({ label, value, big }: { label: string; value: string | number; big?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: big ? 20 : 16, fontWeight: 800, color: '#14532d' }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}
