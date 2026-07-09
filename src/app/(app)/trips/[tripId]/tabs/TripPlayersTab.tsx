'use client'

import { useState } from 'react'
import { initials, avatarColor, cn } from '@/lib/utils'
import type { TripData, TripMemberRow } from '../TripDetailClient'

interface Props { trip: TripData; currentUserId: string; isOrganiser: boolean; onRefresh: () => void }

export default function TripPlayersTab({ trip, currentUserId, isOrganiser, onRefresh }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  const organiser = trip.trip_members.find(m => m.role === 'organiser')
  const players   = trip.trip_members.filter(m => m.role === 'player')
  const expected  = trip.expected_players ?? 0
  const remaining = expected > 0 ? Math.max(0, expected - players.length) : null

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
      {/* Registration stat strip */}
      <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-4">
        <div className="flex divide-x divide-surface-subtle text-center">
          <div className="flex-1 px-3">
            <p className="text-3xl font-black text-brand-600">{players.length}</p>
            <p className="text-xs text-text-muted mt-0.5">Joined</p>
          </div>
          {expected > 0 && (
            <>
              <div className="flex-1 px-3">
                <p className="text-3xl font-black text-text">{expected}</p>
                <p className="text-xs text-text-muted mt-0.5">Expected</p>
              </div>
              <div className="flex-1 px-3">
                <p className={cn('text-3xl font-black', (remaining ?? 0) > 0 ? 'text-amber-500' : 'text-green-500')}>{remaining}</p>
                <p className="text-xs text-text-muted mt-0.5">Remaining</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Organiser */}
      {organiser && (
        <section>
          <p className="s-label">Organiser</p>
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-4">
            <PlayerRow member={organiser} currentUserId={currentUserId} />
          </div>
        </section>
      )}

      {/* Players */}
      <section>
        <p className="s-label">Players ({players.length})</p>
        {players.length === 0 ? (
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-8 text-center">
            <p className="text-4xl mb-3">👥</p>
            <p className="font-semibold text-text mb-1">No players yet</p>
            <p className="text-sm text-text-muted">Share your invite code to get started.</p>
          </div>
        ) : (
          <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle divide-y divide-surface-subtle overflow-hidden">
            {players.map(member => (
              <div key={member.id} className="px-4 py-3 flex items-center gap-3">
                <PlayerRow member={member} currentUserId={currentUserId} flex />
                {isOrganiser && member.profile_id !== currentUserId && (
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

function PlayerRow({ member, currentUserId, flex }: { member: TripMemberRow; currentUserId: string; flex?: boolean }) {
  const name  = member.profiles?.full_name || 'Player'
  const isYou = member.profile_id === currentUserId
  return (
    <div className={cn('flex items-center gap-3', flex && 'flex-1 min-w-0')}>
      {member.profiles?.avatar_url ? (
        <img src={member.profiles.avatar_url} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-white font-bold text-white text-sm"
          style={{ backgroundColor: avatarColor(member.profile_id) }}
        >
          {initials(name)}
        </div>
      )}
      <div className={cn(flex && 'min-w-0')}>
        <p className="font-semibold text-text truncate">
          {name}{isYou && <span className="text-text-subtle text-xs ml-1">(you)</span>}
        </p>
        <p className="text-xs text-text-muted capitalize">{member.role}</p>
      </div>
    </div>
  )
}
