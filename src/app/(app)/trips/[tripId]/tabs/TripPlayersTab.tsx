'use client'

import { useState } from 'react'
import { initials, avatarColor, cn } from '@/lib/utils'
import type { TripData, TripMemberRow } from '../TripDetailClient'
import { WizardNav } from './TripOverviewTab'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'
interface Props {
  trip: TripData; currentUserId: string; isOrganiser: boolean
  onRefresh: () => void; onTabChange: (t: Tab) => void
}

export default function TripPlayersTab({ trip, currentUserId, isOrganiser, onRefresh, onTabChange }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  const organiserMember    = trip.trip_members.find(m => m.role === 'organiser')
  const players            = trip.trip_members.filter(m => m.role === 'player')
  const organiserIsPlaying = trip.organiser_is_playing ?? false

  // When organiser is playing, include them in the player list
  const displayPlayers: TripMemberRow[] = organiserIsPlaying && organiserMember
    ? [organiserMember, ...players]
    : players

  const expected    = trip.expected_players ?? 0
  const playerCount = organiserIsPlaying ? players.length + 1 : players.length
  const remaining   = expected > 0 ? Math.max(0, expected - playerCount) : null

  async function removePlayer(member: TripMemberRow) {
    if (!confirm(`Remove ${member.profiles?.full_name ?? 'this player'}?`)) return
    setRemoving(member.id)
    try {
      const res = await fetch(`/api/trips/${trip.id}/members/${member.id}`, { method: 'DELETE' })
      if (res.ok) onRefresh()
      else { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Failed') }
    } finally { setRemoving(null) }
  }

  return (
    <div className="space-y-4">

      {/* ── Stat strip ───────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className={cn('flex text-center', expected > 0 ? 'divide-x' : '')} style={{ borderColor: '#ede0c4' }}>
          <div className="flex-1 px-3">
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#1a4731' }}>{playerCount}</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>Joined</p>
          </div>
          {expected > 0 && (
            <>
              <div className="flex-1 px-3">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#1a1a16' }}>{expected}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>Expected</p>
              </div>
              <div className="flex-1 px-3">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: (remaining ?? 0) > 0 ? '#d97706' : '#1a4731' }}>
                  {remaining}
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>Remaining</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Guidance if no players yet ───────────────────────────────── */}
      {playerCount === 0 && isOrganiser && (
        <div style={{
          background: '#fffbeb', border: '1.5px solid #fcd34d',
          borderRadius: 12, padding: '12px 14px',
          fontFamily: 'var(--font-body)', fontSize: 12, color: '#92400e',
        }}>
          No players have joined yet. You can still create groups now or return later.
        </div>
      )}

      {/* ── Organiser ────────────────────────────────────────────────── */}
      {organiserMember && (
        <section>
          <p className="s-label" style={{ marginBottom: 8 }}>
            Organiser{organiserIsPlaying ? ' · also playing' : ''}
          </p>
          <div className="card">
            <PlayerRow
              member={organiserMember} currentUserId={currentUserId}
              roleLabel={organiserIsPlaying ? 'Organiser · Player' : 'Organiser'}
            />
          </div>
        </section>
      )}

      {/* ── Players ──────────────────────────────────────────────────── */}
      <section>
        <p className="s-label" style={{ marginBottom: 8 }}>
          Players ({playerCount}){organiserIsPlaying ? ' · incl. organiser' : ''}
        </p>
        {displayPlayers.length === 0 ? (
          <div className="card p-8 text-center">
            <p style={{ fontSize: 32, marginBottom: 8 }}>👥</p>
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>No players yet</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Share the invite link from the trip header.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {displayPlayers.map((member, i) => (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? '1px solid #ede0c4' : 'none' }}
              >
                <PlayerRow
                  member={member} currentUserId={currentUserId}
                  roleLabel={member.role === 'organiser' ? 'Organiser · Player' : undefined}
                  flex
                />
                {isOrganiser && member.role === 'player' && member.profile_id !== currentUserId && (
                  <button
                    disabled={removing === member.id}
                    onClick={() => removePlayer(member)}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444',
                      background: 'none', border: 'none', cursor: 'pointer',
                      flexShrink: 0, marginLeft: 'auto', opacity: removing === member.id ? 0.4 : 1,
                    }}
                  >
                    {removing === member.id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <WizardNav onBack={() => onTabChange('overview')} backLabel="← Overview" onNext={() => onTabChange('groups')} nextLabel="Create Playing Groups →" />
    </div>
  )
}

function PlayerRow({
  member, currentUserId, flex, roleLabel,
}: {
  member: TripMemberRow; currentUserId: string; flex?: boolean; roleLabel?: string
}) {
  const name  = member.profiles?.full_name || 'Player'
  const isYou = member.profile_id === currentUserId
  const color = avatarColor(member.profile_id)
  return (
    <div className={cn('flex items-center gap-3', flex && 'flex-1 min-w-0')}>
      {member.profiles?.avatar_url ? (
        <img src={member.profiles.avatar_url} alt={name}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          style={{ border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }} />
      ) : (
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white text-sm"
          style={{ backgroundColor: color, border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          {initials(name)}
        </div>
      )}
      <div className={cn(flex && 'min-w-0')}>
        <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13 }} className="truncate">
          {name}{isYou && <span style={{ color: '#7a7260', fontSize: 11, marginLeft: 4 }}>(you)</span>}
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>
          {roleLabel ?? (member.role === 'organiser' ? 'Organiser' : 'Player')}
        </p>
      </div>
    </div>
  )
}
