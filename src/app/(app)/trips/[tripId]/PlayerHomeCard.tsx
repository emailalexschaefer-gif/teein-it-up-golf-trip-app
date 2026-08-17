'use client'

import { useState } from 'react'
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

/**
 * Players Joined — social proof on the waiting-for-organiser screen.
 * Deliberately reads trip.trip_members directly (the exact same prop
 * TripDetailClient already passes down, and the exact same canonical
 * data the organiser Players tab and My Events count are being fixed to
 * use below) — no separate fetch, no separate source of truth to drift
 * out of sync with those two. Read-only by construction: this component
 * has no button, form, or mutation anywhere in it, for any role — the
 * "read-only for normal players, no remove/edit controls" requirement
 * isn't a permission check to get right, there's simply nothing here
 * that could edit anything regardless of who's viewing it.
 */
function PlayersJoinedSection({ trip }: { trip: TripData }) {
  const [showAll, setShowAll] = useState(false)
  // Roster shows every joined member, including the organiser as a
  // person — players should be able to see who's running the event
  // even if the organiser isn't playing themselves. The COUNT in the
  // heading is deliberately a different, narrower number: the exact
  // same formula already established in TripDetailClient.tsx and the
  // dashboard's player_count (role='player' members, plus the organiser
  // only if organiser_is_playing) — this is the actual fix requested,
  // so this screen's number can never drift from the event card or the
  // organiser Players tab. Showing every member in the roster while
  // counting only true players in the heading isn't an inconsistency —
  // "Players Joined (12)" and "12 players" on the event card describe
  // the same 12 people; the roster just also happens to show the
  // organiser underneath that count when they're not one of the 12.
  const roster = trip.trip_members
  const playerCount = trip.trip_members.filter(m => m.role === 'player').length + (trip.organiser_is_playing ? 1 : 0)
  const visible = showAll ? roster : roster.slice(0, 8)

  if (roster.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Players Joined ({playerCount})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(m => (
          <div key={m.profile_id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', border: '1px solid #eceae3', borderRadius: 10, padding: '7px 10px' }}>
            {m.profiles?.avatar_url ? (
              <img src={m.profiles.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11,
              }}>
                {initialsOf(m.profiles?.full_name ?? '?')}
              </div>
            )}
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.profiles?.full_name ?? 'Player'}
            </span>
            {m.profiles?.handicap != null && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', fontWeight: 700, flexShrink: 0 }}>
                HCP {m.profiles.handicap}
              </span>
            )}
          </div>
        ))}
      </div>
      {roster.length > 8 && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            display: 'block', width: '100%', marginTop: 8, padding: '8px 0', background: 'none',
            border: 'none', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#a1791f', cursor: 'pointer',
          }}
        >
          {showAll ? 'Show less' : `View all ${roster.length} players`}
        </button>
      )}
    </div>
  )
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
              actually needs to do or know right now. Event-complete
              takes priority over "this round is complete" — trip.status
              is the authoritative signal (set automatically, once, when
              the last round closes — see close/route.ts), not derived
              from focusRound alone, since focusRound would say the same
              "complete" thing for an in-between round too. */}
          {trip.status === 'completed' ? (
            <Link
              href={`/trips/${trip.id}/results`}
              style={{
                display: 'block', textAlign: 'center', padding: 16, borderRadius: 12,
                background: 'linear-gradient(135deg,#14532d,#1a6b3a)', color: '#fff',
                fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 15, textDecoration: 'none',
                boxShadow: '0 4px 16px rgba(20,83,45,0.3)',
              }}
            >
              🏆 View Final Results
            </Link>
          ) : (
            <>
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
              <PlayersJoinedSection trip={trip} />
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
            </>
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
