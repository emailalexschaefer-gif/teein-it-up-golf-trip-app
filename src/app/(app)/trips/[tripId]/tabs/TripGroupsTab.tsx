'use client'

import { useState, useEffect } from 'react'
import { initials, cn } from '@/lib/utils'
import { groupsRequired } from '@/types/app'
import type { TripData, TripMemberRow } from '../TripDetailClient'

interface TripGroup { id: string; name: string; tee_time: string | null; sort_order: number }

interface Props {
  trip:        TripData
  isOrganiser: boolean
  onRefresh:   () => void
}

export default function TripGroupsTab({ trip, isOrganiser, onRefresh }: Props) {
  const [groups, setGroups]     = useState<TripGroup[]>([])
  const [loading, setLoading]   = useState(true)
  const [generating, setGen]    = useState(false)
  const [editingId, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')

  const players   = trip.trip_members.filter((m) => m.role === 'player')
  const numGroups = groupsRequired(trip.expected_players ?? 0, trip.players_per_group ?? 4)

  useEffect(() => {
    fetchGroups()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

  async function fetchGroups() {
    setLoading(true)
    const res = await fetch(`/api/trips/${trip.id}/groups`)
    if (res.ok) setGroups(await res.json())
    setLoading(false)
  }

  async function generateGroups() {
    if (!confirm(`This will delete existing groups and create ${numGroups} new ones. Continue?`)) return
    setGen(true)
    const res = await fetch(`/api/trips/${trip.id}/groups/generate`, { method: 'POST' })
    if (res.ok) await fetchGroups()
    else { const d = await res.json(); alert(d.error) }
    setGen(false)
  }

  async function saveEdit(groupId: string) {
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: editName, tee_time: editTime || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      setGroups((gs) => gs.map((g) => g.id === groupId ? updated : g))
    }
    setEditing(null)
  }

  async function deleteGroup(groupId: string, name: string) {
    if (!confirm(`Delete "${name}"? Players will be unassigned.`)) return
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, { method: 'DELETE' })
    if (res.ok) setGroups((gs) => gs.filter((g) => g.id !== groupId))
  }

  async function assignMember(memberId: string, groupId: string | null) {
    await fetch(`/api/trips/${trip.id}/members/${memberId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ group_id: groupId }),
    })
    onRefresh()
  }

  async function addGroup() {
    const name = `Group ${groups.length + 1}`
    const res  = await fetch(`/api/trips/${trip.id}/groups`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    })
    if (res.ok) {
      const newGroup = await res.json()
      setGroups((gs) => [...gs, newGroup])
    }
  }

  const membersByGroup = (groupId: string) =>
    players.filter((m) => (m.group_id ?? null) === groupId)

  const unassigned = players.filter((m) => !(m.group_id) || !groups.find((g) => g.id === m.group_id))

  // Sort groups by tee time
  const sortedGroups = [...groups].sort((a, b) => {
    if (!a.tee_time && !b.tee_time) return a.sort_order - b.sort_order
    if (!a.tee_time) return 1
    if (!b.tee_time) return -1
    return a.tee_time.localeCompare(b.tee_time)
  })

  if (loading) {
    return <div className="py-12 text-center text-text-muted text-sm">Loading groups…</div>
  }

  return (
    <div className="space-y-5">

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      {isOrganiser && (
        <div className="flex gap-2">
          {numGroups > 0 && (
            <button
              onClick={generateGroups} disabled={generating}
              className="flex-1 bg-brand-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating…' : `Auto-generate ${numGroups} groups`}
            </button>
          )}
          <button
            onClick={addGroup}
            className="bg-surface-subtle text-text text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-surface transition-colors"
          >
            + Add group
          </button>
        </div>
      )}

      {/* ── Groups ──────────────────────────────────────────────────────── */}
      {sortedGroups.length === 0 ? (
        <div className="rounded-2xl bg-surface-subtle p-8 text-center">
          <p className="text-sm font-medium text-text mb-1">No groups yet</p>
          {isOrganiser && numGroups > 0 && (
            <p className="text-xs text-text-muted">
              Tap "Auto-generate {numGroups} groups" to create groups automatically,
              or add them one by one.
            </p>
          )}
          {!isOrganiser && <p className="text-xs text-text-muted">Groups haven't been created yet.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedGroups.map((group) => {
            const members = membersByGroup(group.id)
            const isEditing = editingId === group.id

            return (
              <div key={group.id} className="rounded-2xl bg-white border border-surface-subtle overflow-hidden">
                {/* Group header */}
                <div className="px-4 py-3 bg-surface-muted flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 text-sm font-semibold bg-white border border-surface-subtle rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />
                      <input
                        type="time" value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="w-28 text-sm bg-white border border-surface-subtle rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-600"
                        placeholder="Tee time"
                      />
                      <button onClick={() => saveEdit(group.id)}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-700">Save</button>
                      <button onClick={() => setEditing(null)}
                        className="text-xs text-text-muted hover:text-text">Cancel</button>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-sm text-text flex-1">{group.name}</p>
                      {group.tee_time && (
                        <span className="text-xs font-mono text-brand-600 bg-brand-50 px-2 py-0.5 rounded-lg">
                          ⏱ {group.tee_time}
                        </span>
                      )}
                      {isOrganiser && (
                        <>
                          <button
                            onClick={() => { setEditing(group.id); setEditName(group.name); setEditTime(group.tee_time ?? '') }}
                            className="text-xs text-text-muted hover:text-brand-600 transition-colors"
                          >Edit</button>
                          <button
                            onClick={() => deleteGroup(group.id, group.name)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors"
                          >Delete</button>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Members in this group */}
                <div className="divide-y divide-surface-subtle">
                  {members.map((m) => (
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                      <MiniAvatar member={m} />
                      <span className="text-sm text-text flex-1">{m.profiles?.full_name ?? 'Player'}</span>
                      {isOrganiser && (
                        <button
                          onClick={() => assignMember(m.id, null)}
                          className="text-xs text-text-muted hover:text-red-500 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {members.length === 0 && (
                    <p className="px-4 py-2.5 text-xs text-text-subtle italic">Empty</p>
                  )}
                </div>

                {/* Add player to group dropdown */}
                {isOrganiser && unassigned.length > 0 && (
                  <div className="px-4 py-2 border-t border-surface-subtle bg-surface-muted/50">
                    <select
                      className="w-full text-xs bg-white border border-surface-subtle rounded-lg px-2 py-1.5 text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-600"
                      value=""
                      onChange={(e) => { if (e.target.value) assignMember(e.target.value, group.id) }}
                    >
                      <option value="">+ Add player…</option>
                      {unassigned.map((m) => (
                        <option key={m.id} value={m.id}>{m.profiles?.full_name ?? 'Player'}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Unassigned players ────────────────────────────────────────── */}
      {unassigned.length > 0 && groups.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
            Unassigned ({unassigned.length})
          </p>
          <div className="rounded-2xl bg-white border border-surface-subtle divide-y divide-surface-subtle">
            {unassigned.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                <MiniAvatar member={m} />
                <span className="text-sm text-text flex-1">{m.profiles?.full_name ?? 'Player'}</span>
                {isOrganiser && groups.length > 0 && (
                  <select
                    className="text-xs bg-white border border-surface-subtle rounded-lg px-2 py-1.5 text-text-muted focus:outline-none"
                    value=""
                    onChange={(e) => { if (e.target.value) assignMember(m.id, e.target.value) }}
                  >
                    <option value="">Assign to…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MiniAvatar({ member }: { member: TripMemberRow }) {
  const name = member.profiles?.full_name || '?'
  return member.profiles?.avatar_url ? (
    <img src={member.profiles.avatar_url} alt={name}
      className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
  ) : (
    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
      <span className="text-[10px] font-bold text-brand-600">{initials(name)}</span>
    </div>
  )
}
