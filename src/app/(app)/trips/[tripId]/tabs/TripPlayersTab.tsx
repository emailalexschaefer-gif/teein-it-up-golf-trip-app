'use client'

import { useState } from 'react'
import { initials, cn } from '@/lib/utils'
import type { TripData, TripMemberRow } from '../TripDetailClient'

interface Props {
  trip:          TripData
  currentUserId: string
  isOrganiser:   boolean
  onRefresh:     () => void
}

export default function TripPlayersTab({ trip, currentUserId, isOrganiser, onRefresh }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  const organiser = trip.trip_members.find((m) => m.role === 'organiser')
  const players   = trip.trip_members.filter((m) => m.role === 'player')

  const expectedPlayers  = trip.expected_players ?? 0
  const joined           = players.length
  const remaining        = expectedPlayers > 0 ? Math.max(0, expectedPlayers - joined) : null

  async function removePlayer(member: TripMemberRow) {
    if (!confirm(`Remove ${member.profiles?.full_name ?? 'this player'} from the trip?`)) return
    setRemoving(member.id)
    try {
      const res = await fetch(`/api/trips/${trip.id}/members/${member.id}`, { method: 'DELETE' })
      if (res.ok) onRefresh()
      else { const d = await res.json(); alert(d.error ?? 'Failed to remove player') }
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Registration summary */}
      <div className="rounded-2xl bg-white border border-surface-subtle p-4">
        <div className="flex gap-4 text-center">
          <div className="flex-1">
            <p className="text-2xl font-bold text-brand-600">{joined}</p>
            <p className="text-xs text-text-muted">Players joined</p>
          </div>
          {expectedPlayers > 0 && (
            <>
              <div className="w-px bg-surface-subtle" />
              <div className="flex-1">
                <p className="text-2xl font-bold text-text">{expectedPlayers}</p>
                <p className="text-xs text-text-muted">Expected</p>
              </div>
              <div className="w-px bg-surface-subtle" />
              <div className="flex-1">
                <p className="text-2xl font-bold text-text-muted">{remaining}</p>
                <p className="text-xs text-text-muted">Remaining</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Organiser */}
      {organiser && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Organiser</p>
          <div className="rounded-2xl bg-white border border-surface-subtle p-4">
            <PlayerRow member={organiser} currentUserId={currentUserId} />
          </div>
        </section>
      )}

      {/* Players */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          Players ({players.length})
        </p>
        {players.length === 0 ? (
          <div className="rounded-2xl bg-surface-subtle p-6 text-center">
            <p className="text-sm text-text-muted">No players yet — share the invite link to get started.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-surface-subtle divide-y divide-surface-subtle">
            {players.map((member) => (
              <div key={member.id} className="px-4 py-3 flex items-center gap-3">
                <PlayerRow member={member} currentUserId={currentUserId} inline />
                {isOrganiser && member.profile_id !== currentUserId && (
                  <button
                    disabled={removing === member.id}
                    onClick={() => removePlayer(member)}
                    className="ml-auto flex-shrink-0 text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
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

function PlayerRow({ member, currentUserId, inline }: {
  member: TripMemberRow; currentUserId: string; inline?: boolean
}) {
  const name = member.profiles?.full_name || 'Player'
  const isYou = member.profile_id === currentUserId

  return (
    <div className={cn('flex items-center gap-3', inline && 'flex-1 min-w-0')}>
      {member.profiles?.avatar_url ? (
        <img src={member.profiles.avatar_url} alt={name}
          className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-brand-600">{initials(name)}</span>
        </div>
      )}
      <div className={cn(inline && 'min-w-0')}>
        <p className="text-sm font-medium text-text truncate">
          {name}{isYou && <span className="text-text-subtle text-xs ml-1">(you)</span>}
        </p>
        <p className="text-xs text-text-muted capitalize">{member.role}</p>
      </div>
    </div>
  )
}
