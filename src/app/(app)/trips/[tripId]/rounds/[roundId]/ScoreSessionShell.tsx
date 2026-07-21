'use client'

import React from 'react'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import { initials, avatarColor } from '@/lib/utils'

interface Scorecard {
  id: string
  player_id: string
  playing_handicap: number
  status: string
  profiles: { id: string; full_name: string; avatar_url: string | null } | null
}

interface Round {
  id: string; name: string; status: string; holes: number
  scoring_format: string; course_name: string | null
  tee_time: string | null; play_date: string
}

interface Props {
  tripId: string; tripName: string; round: Round
  myScorecard: { id: string; playing_handicap: number; status: string } | null
  allScorecards: Scorecard[]; isOrganiser: boolean; currentUserId: string
}

export default function ScoreSessionShell({ tripId, tripName, round, myScorecard, allScorecards, isOrganiser, currentUserId }: Props) {
  const formattedDate = new Date(round.play_date + 'T00:00:00')
    .toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 0 32px' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(160deg, #0f2d1c 0%, #1a4731 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '16px 18px 14px',
        marginBottom: 16,
      }}>
        <Link href={`/trips/${tripId}`} style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.55)', textDecoration: 'none', marginBottom: 8, display: 'block' }}>
          ← {tripName}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#e8c96a', animation: 'pulse 2s infinite',
          }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#e8c96a', letterSpacing: 1.5, textTransform: 'uppercase' }}>Round in Progress</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, margin: '6px 0 2px' }}>
          {round.name}
        </h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.6)' }}>{formattedDate}</span>
          {round.tee_time && <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>⏱ {round.tee_time}</span>}
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.6)' }}>⛳ {round.holes} holes</span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.6)', textTransform: 'capitalize' }}>Stableford</span>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Ready state */}
        <div style={{
          background: '#f0fdf4', border: '1.5px solid #86efac',
          borderRadius: 14, padding: '18px 18px', marginBottom: 18, textAlign: 'center',
        }}>
          <p style={{ fontSize: 36, marginBottom: 6 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: '#166534', marginBottom: 4 }}>
            Your round is ready to score
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534', opacity: 0.8 }}>
            {round.course_name ? `${round.course_name} · ` : ''}{round.holes} holes · Stableford
          </p>
        </div>

        {/* Player's own scorecard */}
        {myScorecard && (
          <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#7a7260', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Your Scorecard</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#1a1a16' }}>Playing Handicap</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Locked at round start</p>
              </div>
              <div style={{
                background: 'linear-gradient(135deg, #1a4731, #0f2d1c)',
                borderRadius: 10, padding: '8px 16px', textAlign: 'center',
              }}>
                <p style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
                  {myScorecard.playing_handicap}
                </p>
                <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 }}>HCP</p>
              </div>
            </div>
          </div>
        )}

        {/* All players */}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#7a7260', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
          Players in this round
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {allScorecards.map(sc => {
            const name = sc.profiles?.full_name ?? 'Player'
            const isMe = sc.player_id === currentUserId
            return (
              <div key={sc.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: isMe ? 'rgba(26,71,49,0.06)' : '#ffffff',
                border: `1.5px solid ${isMe ? '#1a4731' : '#ede0c4'}`,
                borderRadius: 12, padding: '10px 14px',
              }}>
                <Avatar name={name} size="sm" />
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: isMe ? 700 : 500, color: '#1a1a16' }}>
                    {name}{isMe ? ' (You)' : ''}
                  </p>
                </div>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', background: '#f2e8d0', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                  HCP {sc.playing_handicap}
                </span>
              </div>
            )
          })}
        </div>

        {/* Sprint 5B placeholder */}
        <div style={{
          background: 'linear-gradient(135deg, #c9a84c, #e8c96a, #c9a84c)',
          borderRadius: 14, padding: '16px 20px', textAlign: 'center',
          boxShadow: '0 4px 16px rgba(201,168,76,0.4)', opacity: 0.5,
          cursor: 'not-allowed',
        }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, color: '#0f2d1c' }}>
            Enter Scores — Coming in Sprint 5B
          </p>
        </div>

        <Link href={`/trips/${tripId}`} style={{
          display: 'block', textAlign: 'center', marginTop: 16,
          fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textDecoration: 'none',
        }}>
          ← Return to trip
        </Link>
      </div>
    </div>
  )
}
