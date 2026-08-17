'use client'

import { useEffect, useState } from 'react'

/**
 * Deployment A — the "at most, passive visibility of pairing status"
 * allowance. Read-only by construction: reuses the existing markers GET
 * (unchanged, still the same endpoint MarkerReviewClient used to read
 * from) but this component never calls the POST/regenerate mutation —
 * there is no button, form, or action anywhere in this file that could
 * reassign a pairing. An organiser can see who's paired with whom and
 * who's still unpaired; changing it is deliberately the player's own
 * job now (their Playing Partner selection screen), not reachable from
 * here.
 */
interface Group { groupId: string; groupName: string; players: { playerId: string; fullName: string }[] }
interface Assignment { player_id: string; marker_player_id: string }

export default function PlayingPartnerStatus({ tripId, roundId }: { tripId: string; roundId: string }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${roundId}/markers`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body) { setGroups(body.groups ?? []); setAssignments(body.assignments ?? []) } })
      .catch(() => { /* leaves the section empty rather than showing stale/wrong status */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId, roundId])

  if (loading || groups.length === 0) return null

  const partnerOf = new Map(assignments.map(a => [a.player_id, a.marker_player_id]))
  const nameById = new Map(groups.flatMap(g => g.players).map(p => [p.playerId, p.fullName]))

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Playing Partner status
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {groups.map(g => (
          <div key={g.groupId} style={{ background: '#ffffff', borderRadius: 10, border: '1px solid #eceae3', padding: '8px 12px' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#14532d', marginBottom: 3 }}>{g.groupName}</div>
            {g.players.map(p => {
              const partnerId = partnerOf.get(p.playerId)
              return (
                <div key={p.playerId} style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260' }}>
                  {p.fullName} — {partnerId ? `paired with ${nameById.get(partnerId) ?? 'a player'}` : 'awaiting selection'}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
