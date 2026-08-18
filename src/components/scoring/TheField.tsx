'use client'

import { useEffect, useState } from 'react'
import PlayerCardModal, { initialsOf, type PlayerCardData } from '@/components/shared/PlayerCardModal'

/**
 * "The Field" — the pre-event Leaderboard state. Deliberately a
 * separate component from LiveLeaderboard, not a mode/branch inside
 * it — this has no ranking, no scores, no scorecard expansion; trying
 * to make one component do both would mean threading a bunch of
 * "is this the pre-event unranked case" conditionals through code that
 * already correctly handles the real, harder problem (live scoring,
 * multi-round cumulative standings). LiveLeaderboard itself is
 * completely untouched.
 *
 * Reuses the same admin-backed /api/trips/[tripId]/members endpoint the
 * waiting-room roster and player-card modal already use — one canonical
 * player list, not a fourth query shape for the same underlying data.
 *
 * Regression fix — rows previously had no tap interaction at all (this
 * component never had one to begin with; it's new, not a regression in
 * this specific file, but the missing capability itself is the reported
 * regression). Whole-row tap opens the same shared PlayerCardModal
 * every other player-list surface uses — no competing interaction exists
 * on this screen (no scorecard, no expansion), so the entire row can
 * safely be the tap target.
 */
interface FieldMember { profile_id: string; role: string; profiles: { full_name: string; avatar_url: string | null; handicap?: number | null; golf_club?: string | null; occupation?: string | null } | null }

export default function TheField({ tripId }: { tripId: string }) {
  const [members, setMembers] = useState<FieldMember[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCardData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/members`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body?.members) setMembers(body.members) })
      .catch(() => { /* stays empty — the "field" copy below reads fine even with 0 shown */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId])

  if (loading) return null

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>
          THE FIELD
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: '#a1791f', fontSize: 13, fontWeight: 700, marginTop: 2 }}>
          {members.length} PLAYER{members.length === 1 ? '' : 'S'}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 12.5, marginTop: 6 }}>
          The field is set. The leaderboard comes alive when scoring begins.
        </div>
      </div>

      {/* Deliberately no rank/position column anywhere in this row —
          "DO NOT rank them" is a literal absence, not a hidden/zeroed
          number. Order is whatever /members already returns (joined_at
          ascending) — a stable, neutral ordering, not alphabetical or
          handicap-based, which could otherwise read as an implied
          ranking. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {members.map(m => (
          <button
            key={m.profile_id}
            onClick={() => setSelectedPlayer(m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', border: '1px solid #eceae3',
              borderRadius: 10, padding: '9px 12px', width: '100%', textAlign: 'left', cursor: 'pointer',
            }}
          >
            {m.profiles?.avatar_url ? (
              <img src={m.profiles.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 12,
              }}>
                {initialsOf(m.profiles?.full_name ?? '?')}
              </div>
            )}
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#1a1a16', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.profiles?.full_name ?? 'Player'}
            </span>
            {m.profiles?.handicap != null && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', fontWeight: 700, flexShrink: 0 }}>
                HCP {m.profiles.handicap}
              </span>
            )}
          </button>
        ))}
      </div>

      {selectedPlayer && <PlayerCardModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </div>
  )
}
