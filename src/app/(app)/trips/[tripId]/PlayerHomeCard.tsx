'use client'

import Link from 'next/link'
import type { TripData } from './TripDetailClient'

interface Props {
  trip: TripData
  currentUserId: string
}

function formatTeeTime(teeTime: string | null): string | null {
  if (!teeTime) return null
  // tee_time is typically stored as HH:MM(:SS); render as a friendly 12h time.
  const [hStr, mStr] = teeTime.split(':')
  const h = Number(hStr)
  if (Number.isNaN(h)) return teeTime
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mStr} ${period}`
}

function formatLabel(format: string): string {
  return format.charAt(0).toUpperCase() + format.slice(1).replace(/_/g, ' ')
}

export default function PlayerHomeCard({ trip, currentUserId }: Props) {
  const me = trip.trip_members.find(m => m.profile_id === currentUserId)
  const myGroup = me?.group_id ? trip.trip_groups?.find(g => g.id === me.group_id) : undefined

  // Focus on the most relevant round: the active one if there is one,
  // otherwise the earliest upcoming one, otherwise the most recently
  // completed one — always exactly one round's status to act on, not a
  // list of tabs to interpret.
  const rounds = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))
  const activeRound = rounds.find(r => r.status === 'active')
  const upcomingRound = rounds.find(r => r.status === 'upcoming')
  const completedRounds = rounds.filter(r => r.status === 'completed')
  const focusRound = activeRound ?? upcomingRound ?? completedRounds[completedRounds.length - 1]

  return (
    <div className="-mx-4 -mt-5 pb-20 md:pb-0">
      <div style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 60%, #236040 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '20px 16px 24px',
      }}>
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: 'rgba(245,230,184,0.55)', letterSpacing: 0.3,
          display: 'inline-block', marginBottom: 10,
        }}>← My Events</Link>

        <div style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, letterSpacing: -0.3 }}>
          {trip.name}
        </div>
        {trip.location && (
          <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13, marginTop: 4 }}>
            📍 {trip.location}
          </div>
        )}
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        {/* Status card — everything a player needs to know at a glance,
            nothing they need to configure. */}
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #eceae3', boxShadow: '0 4px 18px rgba(0,0,0,0.08)', padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>✅</span>
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#16a34a' }}>Joined</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {myGroup && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d' }}>
                <span>👥</span><span>{myGroup.name}</span>
              </div>
            )}
            {focusRound?.tee_time && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d' }}>
                <span>⏰</span><span>Tee time {formatTeeTime(focusRound.tee_time)}</span>
              </div>
            )}
            {focusRound && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d' }}>
                <span>🏌️</span><span>{formatLabel(focusRound.scoring_format)}</span>
              </div>
            )}
          </div>

          {/* Round status / primary action — the one thing a player
              actually needs to do or know right now. */}
          {!focusRound && (
            <div style={{ textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>
              The organiser hasn&apos;t set up a round yet.
            </div>
          )}
          {focusRound?.status === 'upcoming' && (
            <div style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#a1791f' }}>
                🟡 Waiting for organiser to start {focusRound.name}
              </span>
            </div>
          )}
          {focusRound?.status === 'active' && (
            <Link
              href={`/trips/${trip.id}/rounds/${focusRound.id}`}
              style={{
                display: 'block', textAlign: 'center', padding: 16, borderRadius: 12,
                background: 'linear-gradient(135deg,#2d7a52,#16a34a)', color: '#fff',
                fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 16, textDecoration: 'none',
                boxShadow: '0 4px 16px rgba(22,163,74,0.3)',
              }}
            >
              ▶ Start Scoring
            </Link>
          )}
          {focusRound?.status === 'completed' && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
                ✓ {focusRound.name} complete
              </span>
            </div>
          )}
        </div>

        {/* The only two destinations a player needs beyond the bottom
            nav's own Leaderboard/Side Games/Chat/Scorecard — no Players/
            Groups/Rounds tabs, no setup tools. */}
        <Link href={`/trips/${trip.id}/leaderboard`} style={{
          display: 'block', textAlign: 'center', padding: 13, borderRadius: 10,
          background: '#ffffff', border: '1.5px solid #d1d5db', marginBottom: 8,
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', textDecoration: 'none',
        }}>
          View Leaderboard
        </Link>
      </div>
    </div>
  )
}
