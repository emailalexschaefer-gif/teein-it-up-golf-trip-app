'use client'

import { useEffect, useState } from 'react'

/**
 * Starting Grid — shown instead of the plain Players Joined roster once
 * the focus round's own setup_released flag is true (Package 2 —
 * updated from the earlier trip-wide trips.groups_released, since
 * release is genuinely per-round: Round 1 can be released/live while
 * Round 2 is still being prepared). This component itself is unaware
 * of the flag either way — gating happens in the parent
 * (PlayerHomeCard) before this even renders. Reuses three
 * already-existing, already-proven endpoints — no parallel data model:
 *  - /members (admin-backed roster, same source as the player card modal)
 *  - /rounds/[roundId]/group-tee-times (Priority 2's round-specific times)
 *  - /rounds/[roundId]/starting-holes (Priority 5's shotgun architecture)
 * Player cards stay tappable via the same onSelectPlayer callback
 * PlayerHomeCard already wires its profile modal through.
 */
interface Member { profile_id: string; group_id: string | null; role: string; profiles: { full_name: string; avatar_url: string | null; handicap?: number | null; golf_club?: string | null; occupation?: string | null } | null }
export interface GroupInfo { id: string; name?: string; tee_time?: string | null }

export default function StartingGrid({
  tripId, roundId, groups, onSelectPlayer,
}: {
  tripId: string; roundId: string; groups: GroupInfo[]
  onSelectPlayer: (m: Member) => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [teeTimes, setTeeTimes] = useState<Record<string, string | null>>({})
  const [startType, setStartType] = useState<'standard' | 'shotgun'>('standard')
  const [startingHoleNumber, setStartingHoleNumber] = useState<1 | 10>(1)
  const [startingHoles, setStartingHoles] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/trips/${tripId}/members`).then(r => r.ok ? r.json() : null),
      fetch(`/api/trips/${tripId}/rounds/${roundId}/group-tee-times`).then(r => r.ok ? r.json() : null),
      fetch(`/api/trips/${tripId}/rounds/${roundId}/starting-holes`).then(r => r.ok ? r.json() : null),
    ]).then(([membersBody, teeTimesBody, startingHolesBody]) => {
      if (cancelled) return
      if (membersBody?.members) setMembers(membersBody.members)
      if (teeTimesBody?.teeTimes) {
        const map: Record<string, string | null> = {}
        for (const t of teeTimesBody.teeTimes as { group_id: string; tee_time: string | null }[]) map[t.group_id] = t.tee_time
        setTeeTimes(map)
      }
      if (startingHolesBody) {
        setStartType(startingHolesBody.startType === 'shotgun' ? 'shotgun' : 'standard')
        setStartingHoleNumber(startingHolesBody.startingHoleNumber === 10 ? 10 : 1)
        const map: Record<string, number> = {}
        for (const h of (startingHolesBody.startingHoles ?? []) as { group_id: string; starting_hole: number }[]) map[h.group_id] = h.starting_hole
        setStartingHoles(map)
      }
    }).catch(() => { /* leaves whatever partial state resolved — a group missing its tee time just shows without one, not an error screen */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId, roundId])

  if (loading) return null

  const byGroup = new Map<string, Member[]>()
  for (const m of members) {
    if (!m.group_id) continue
    if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, [])
    byGroup.get(m.group_id)!.push(m)
  }
  // P1 fix — the organiser's simple Groups screen sets tee_time
  // directly on trip_groups (confirmed by reading TripGroupsTab.tsx's
  // own query), which is a completely different field from the
  // round-specific override table (round_group_tee_times) this
  // component fetches via /group-tee-times. A round with no
  // round-specific override set — the common case, since that's a more
  // advanced per-round feature most organisers never touch — meant
  // teeTimes[g.id] was always empty here even though the organiser's
  // own screen plainly showed a time. Round-specific override still
  // wins when it exists (matches the same hierarchy already
  // established for the countdown: round-specific first, then the
  // simpler trip-wide value) — this doesn't remove or replace that
  // override, it just adds the missing fallback for when it isn't set.
  function resolveTeeTime(groupId: string): string | null {
    return teeTimes[groupId] ?? groups.find(g => g.id === groupId)?.tee_time ?? null
  }

  // Groups ordered by tee time where set (matching Leaders Last's own
  // convention — earliest first, unset sorts last), falling back to
  // whatever order trip.trip_groups already provided.
  const orderedGroups = [...groups].sort((a, b) => {
    const ta = resolveTeeTime(a.id), tb = resolveTeeTime(b.id)
    if (ta && tb) return ta.localeCompare(tb)
    if (ta) return -1
    if (tb) return 1
    return 0
  })

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Starting Grid
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {orderedGroups.map((g, i) => {
          const groupMembers = byGroup.get(g.id) ?? []
          if (groupMembers.length === 0) return null
          const teeTime = resolveTeeTime(g.id)
          const hole = startingHoles[g.id]
          return (
            <div key={g.id}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 800, color: '#a1791f', marginBottom: 6 }}>
                {g.name ?? `Group ${i + 1}`}
                {/* 1 Sep field-test bundle — "Starting Grid must show
                    actual starting hole." Was a hardcoded "Hole 1"
                    literal, shown for every non-shotgun round
                    regardless of its actual configuration — a back-
                    nine round would correctly open live scoring on
                    Hole 10 while this still claimed Hole 1. Now reads
                    the same authoritative starting_hole_number column
                    live scoring itself uses (holeSequence.ts), via the
                    starting-holes endpoint this component already
                    calls — no second inference path. */}
                {teeTime && <span> · ⏰ {formatTeeTime(teeTime)}</span>}
                {startType === 'shotgun' && hole != null && <span> · Start Hole {hole}</span>}
                {startType !== 'shotgun' && <span> · Hole {startingHoleNumber}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {groupMembers.map(m => (
                  <button
                    key={m.profile_id}
                    onClick={() => onSelectPlayer(m)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', border: '1px solid #eceae3',
                      borderRadius: 10, padding: '7px 10px', width: '100%', textAlign: 'left', cursor: 'pointer',
                    }}
                  >
                    {m.profiles?.avatar_url ? (
                      <img src={m.profiles.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11,
                      }}>
                        {(m.profiles?.full_name ?? '?').trim().split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?'}
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
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
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
