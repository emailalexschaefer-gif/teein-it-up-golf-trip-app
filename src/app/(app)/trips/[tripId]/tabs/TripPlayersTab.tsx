'use client'

import { useState } from 'react'
import { initials, avatarColor, cn } from '@/lib/utils'
import type { TripData, TripMemberRow } from '../TripDetailClient'

interface Props { trip: TripData; currentUserId: string; isOrganiser: boolean; onRefresh: () => void }

export default function TripPlayersTab({ trip, currentUserId, isOrganiser, onRefresh }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  const organiserMember = trip.trip_members.find(m => m.role === 'organiser')
  const players         = trip.trip_members.filter(m => m.role === 'player')

  // If organiser is also playing, include them in the player count and player list
  const organiserIsPlaying = trip.organiser_is_playing ?? false
  const displayPlayers = organiserIsPlaying && organiserMember
    ? [organiserMember, ...players]
    : players

  const expected  = trip.expected_players ?? 0
  // Player count includes the organiser if they're playing
  const playerCount = organiserIsPlaying ? players.length + 1 : players.length
  const remaining = expected > 0 ? Math.max(0, expected - playerCount) : null

  async function removePlayer(member: TripMemberRow) {
    if (!confirm(`Remove ${member.profiles?.full_name ?? 'this player'}?`)) return
    setRemoving(member.id)
    try {
      const res = await fetch(`/api/trips/${trip.id}/members/${member.id}`, { method: 'DELETE' })
      if (res.ok) onRefresh()
      else { const d = await res.json(); alert(d.error ?? 'Failed') }
    } finally { setRemoving(null) }
  }

  return (
    <div className="space-y-4">

      {/* ── Registration stat strip ───────────────────────────────── */}
      <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-4">
        <div className="flex divide-x divide-surface-subtle text-center">
          <div className="flex-1 px-3">
            <p className="text-3xl font-black" style={{ color: '#1a4731' }}>{playerCount}</p>
            <p className="text-xs text-text-muted mt-0.5">Joined</p>
          </div>
          {expected > 0 && (
            <>
              <div className="flex-1 px-3">
                <p className="text-3xl font-black text-text">{expected}</p>
                <p className="text-xs text-text-muted mt-0.5">Expected</p>
              </div>
              <div className="flex-1 px-3">
                <p className={cn('text-3xl font-black', (remaining ?? 0) > 0 ? 'text-amber-500' : 'text-green-600')}>{remaining}</p>
                <p className="text-xs text-text-muted mt-0.5">Remaining</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Organiser ────────────────────────────────────────────── */}
      {organiserMember && (
        <section>
          <p className="s-label">
            Organiser
            {organiserIsPlaying && (
              <span style={{ color: '#2d7a52', marginLeft: 6, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
                ✓ also playing
              </span>
            )}
          </p>
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-4">
            <PlayerRow member={organiserMember} currentUserId={currentUserId} roleOverride={organiserIsPlaying ? 'Organiser · Player' : undefined} />
          </div>
        </section>
      )}

      {/* ── Players ──────────────────────────────────────────────── */}
      <section>
        <p className="s-label">
          Players ({playerCount})
          {organiserIsPlaying && organiserMember && (
            <span style={{ color: '#7a7260', marginLeft: 6, textTransform: 'none', letterSpacing: 0, fontSize: 10, fontWeight: 400 }}>
              incl. organiser
            </span>
          )}
        </p>
        {displayPlayers.length === 0 ? (
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-8 text-center">
            <p className="text-4xl mb-3">👥</p>
            <p className="font-semibold text-text mb-1">No players yet</p>
            <p className="text-sm text-text-muted">Share your invite code to get started.</p>
          </div>
        ) : (
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle divide-y divide-surface-subtle overflow-hidden">
            {displayPlayers.map(member => (
              <div key={member.id} className="px-4 py-3 flex items-center gap-3">
                <PlayerRow
                  member={member}
                  currentUserId={currentUserId}
                  flex
                  roleOverride={member.role === 'organiser' ? 'Organiser · Player' : undefined}
                />
                {/* Only show remove for actual player rows, not the organiser-as-player */}
                {isOrganiser && member.role === 'player' && member.profile_id !== currentUserId && (
                  <button
                    disabled={removing === member.id}
                    onClick={() => removePlayer(member)}
                    className="flex-shrink-0 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-40 ml-auto"
                  >
                    {removing === member.id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PlayerRow({
  member, currentUserId, flex, roleOverride,
}: {
  member: TripMemberRow; currentUserId: string; flex?: boolean; roleOverride?: string
}) {
  const name  = member.profiles?.full_name || 'Player'
  const isYou = member.profile_id === currentUserId
  const color = avatarColor(member.profile_id)

  return (
    <div className={cn('flex items-center gap-3', flex && 'flex-1 min-w-0')}>
      {member.profiles?.avatar_url ? (
        <img src={member.profiles.avatar_url} alt={name}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          style={{ border: '2px solid rgba(255,255,255,0.22)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)' }} />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white text-sm"
          style={{ backgroundColor: color, border: '2px solid rgba(255,255,255,0.22)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)' }}
        >
          {initials(name)}
        </div>
      )}
      <div className={cn(flex && 'min-w-0')}>
        <p className="font-semibold text-text truncate" style={{ fontFamily: 'var(--font-body)' }}>
          {name}{isYou && <span className="text-text-muted text-xs ml-1">(you)</span>}
        </p>
        <p className="text-xs text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
          {roleOverride ?? (member.role === 'organiser' ? 'Organiser' : 'Player')}
        </p>
      </div>
    </div>
  )
}
