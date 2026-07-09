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
  const [assigning, setAssigning] = useState(false)
  const [editingId, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')

  const players  = trip.trip_members.filter((m) => m.role === 'player')
  const numGroups = groupsRequired(trip.expected_players, trip.players_per_group)
  const ppg = trip.players_per_group ?? 4

  useEffect(() => { fetchGroups() }, [trip.id]) // eslint-disable-line

  async function fetchGroups() {
    setLoading(true)
    const res = await fetch(`/api/trips/${trip.id}/groups`)
    if (res.ok) setGroups(await res.json())
    setLoading(false)
  }

  async function generateGroups() {
    setGen(true)
    const res = await fetch(`/api/trips/${trip.id}/groups/generate`, { method: 'POST' })
    if (res.ok) await fetchGroups()
    else { const d = await res.json(); alert(d.error) }
    setGen(false)
    onRefresh()
  }

  async function autoAssign(groupList: TripGroup[]) {
    setAssigning(true)
    // Shuffle players then assign in order
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    const updates = shuffled.map((p, i) => {
      const group = groupList[i % groupList.length]
      return fetch(`/api/trips/${trip.id}/members/${p.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ group_id: group.id }),
      })
    })
    await Promise.all(updates)
    setAssigning(false)
    onRefresh()
  }

  async function saveEdit(groupId: string) {
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, tee_time: editTime || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      setGroups((gs) => gs.map((g) => g.id === groupId ? updated : g))
    }
    setEditing(null)
  }

  async function deleteGroup(groupId: string) {
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, { method: 'DELETE' })
    if (res.ok) {
      setGroups((gs) => gs.filter((g) => g.id !== groupId))
      onRefresh()
    }
  }

  async function addGroup() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const name = groups.length < 26
      ? `Group ${letters[groups.length]}`
      : `Group ${groups.length + 1}`
    const res = await fetch(`/api/trips/${trip.id}/groups`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const newGroup = await res.json()
      setGroups((gs) => [...gs, newGroup])
    }
  }

  async function assignMember(memberId: string, groupId: string | null) {
    await fetch(`/api/trips/${trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId }),
    })
    onRefresh()
  }

  const membersByGroup = (groupId: string) =>
    players.filter((m) => (m.group_id ?? null) === groupId)

  const unassigned = players.filter(
    (m) => !m.group_id || !groups.find((g) => g.id === m.group_id)
  )

  const assignedCount = players.length - unassigned.length
  const allAssigned   = players.length > 0 && unassigned.length === 0
  const groupsWithTime = groups.filter((g) => g.tee_time).length
  const allHaveTimes  = groups.length > 0 && groupsWithTime === groups.length

  const sortedGroups = [...groups].sort((a, b) => {
    if (!a.tee_time && !b.tee_time) return a.sort_order - b.sort_order
    if (!a.tee_time) return 1
    if (!b.tee_time) return -1
    return a.tee_time.localeCompare(b.tee_time)
  })

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-text-muted">Loading groups…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Progress summary (once groups exist) ──────────────────────── */}
      {groups.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard
            value={`${groups.filter(g => membersByGroup(g.id).length > 0).length}/${groups.length}`}
            label="Groups filled"
            done={allAssigned}
          />
          <SummaryCard
            value={`${assignedCount}/${players.length}`}
            label="Players assigned"
            done={allAssigned}
          />
          <SummaryCard
            value={`${unassigned.length}`}
            label="Unassigned"
            done={unassigned.length === 0}
            warn={unassigned.length > 0}
          />
        </div>
      )}

      {/* ── No groups yet: guided prompt ──────────────────────────────── */}
      {groups.length === 0 && isOrganiser && (
        <div className="rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-6 text-center space-y-4">
          <div>
            <p className="text-2xl mb-1">⛳</p>
            <p className="font-semibold text-text">Ready to create groups?</p>
            {numGroups > 0 ? (
              <p className="text-sm text-text-muted mt-1">
                {trip.expected_players} players ÷ {ppg} per group = <strong className="text-brand-600">{numGroups} groups</strong>
              </p>
            ) : (
              <p className="text-sm text-text-muted mt-1">
                Set expected players on the Overview tab to calculate group size automatically.
              </p>
            )}
          </div>
          {numGroups > 0 && (
            <button
              onClick={generateGroups} disabled={generating}
              className="w-full bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {generating ? 'Creating groups…' : `Generate ${numGroups} groups`}
            </button>
          )}
          <button
            onClick={addGroup}
            className="w-full bg-white border border-brand-200 text-brand-600 font-medium py-2.5 rounded-xl hover:bg-brand-50 transition-colors text-sm"
          >
            + Add group manually
          </button>
        </div>
      )}

      {/* ── Groups exist: action bar ───────────────────────────────────── */}
      {groups.length > 0 && isOrganiser && (
        <div className="flex gap-2 flex-wrap">
          {unassigned.length > 0 && (
            <button
              onClick={() => autoAssign(groups)} disabled={assigning}
              className="flex-1 bg-brand-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {assigning ? 'Assigning…' : `Auto-assign ${unassigned.length} player${unassigned.length !== 1 ? 's' : ''}`}
            </button>
          )}
          {allAssigned && !allHaveTimes && (
            <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-700 text-center font-medium">
              Next: set tee times for each group ↓
            </div>
          )}
          {allAssigned && allHaveTimes && (
            <div className="flex-1 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700 text-center font-medium">
              ✓ All players assigned · All tee times set
            </div>
          )}
          <button
            onClick={addGroup}
            className="bg-surface-subtle text-text text-sm font-medium px-3 py-2.5 rounded-xl hover:bg-surface transition-colors"
          >
            + Group
          </button>
          {numGroups > 0 && (
            <button
              onClick={generateGroups} disabled={generating}
              className="bg-surface-subtle text-text-muted text-sm px-3 py-2.5 rounded-xl hover:bg-surface transition-colors disabled:opacity-50"
            >
              {generating ? '…' : 'Regenerate'}
            </button>
          )}
        </div>
      )}

      {/* ── Unassigned player pool ─────────────────────────────────────── */}
      {unassigned.length > 0 && groups.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-2">
            Unassigned players ({unassigned.length})
          </p>
          <div className="rounded-2xl bg-white border border-amber-200 divide-y divide-surface-subtle">
            {unassigned.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                <MiniAvatar member={m} />
                <span className="text-sm text-text flex-1">{m.profiles?.full_name ?? 'Player'}</span>
                {isOrganiser && (
                  <select
                    className="text-sm bg-white border border-brand-200 text-brand-600 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600"
                    value=""
                    onChange={(e) => { if (e.target.value) assignMember(m.id, e.target.value) }}
                  >
                    <option value="">Assign to group…</option>
                    {sortedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}{g.tee_time ? ` · ${g.tee_time}` : ''}
                        {' '}({membersByGroup(g.id).length}/{ppg})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Groups ────────────────────────────────────────────────────── */}
      {sortedGroups.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Groups ({groups.length})
          </p>
          {sortedGroups.map((group) => {
            const members   = membersByGroup(group.id)
            const isEditing = editingId === group.id
            const isFull    = members.length >= ppg

            return (
              <div key={group.id} className={cn(
                'rounded-2xl bg-white border overflow-hidden',
                isFull ? 'border-green-200' : 'border-surface-subtle'
              )}>
                {/* Group header */}
                <div className={cn(
                  'px-4 py-3 flex items-center gap-2',
                  isFull ? 'bg-green-50' : 'bg-surface-muted'
                )}>
                  {isEditing ? (
                    <>
                      <input
                        value={editName} onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 text-sm font-semibold bg-white border border-surface-subtle rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />
                      <input
                        type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                        className="w-28 text-sm bg-white border border-surface-subtle rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />
                      <button onClick={() => saveEdit(group.id)} className="text-xs font-semibold text-brand-600">Save</button>
                      <button onClick={() => setEditing(null)} className="text-xs text-text-muted">Cancel</button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text">{group.name}</p>
                        <p className="text-xs text-text-muted">{members.length}/{ppg} players</p>
                      </div>
                      {group.tee_time ? (
                        <span className="text-xs font-mono font-semibold text-brand-600 bg-brand-50 px-2 py-1 rounded-lg">
                          {group.tee_time}
                        </span>
                      ) : isOrganiser ? (
                        <button
                          onClick={() => { setEditing(group.id); setEditName(group.name); setEditTime('') }}
                          className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                        >
                          Set tee time
                        </button>
                      ) : null}
                      {isOrganiser && (
                        <div className="flex gap-2 ml-1">
                          <button
                            onClick={() => { setEditing(group.id); setEditName(group.name); setEditTime(group.tee_time ?? '') }}
                            className="text-xs text-text-muted hover:text-brand-600 transition-colors"
                          >Edit</button>
                          <button
                            onClick={() => deleteGroup(group.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors"
                          >✕</button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Members */}
                <div className="divide-y divide-surface-subtle">
                  {members.map((m) => (
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                      <MiniAvatar member={m} />
                      <span className="text-sm text-text flex-1 truncate">{m.profiles?.full_name ?? 'Player'}</span>
                      {isOrganiser && (
                        <button
                          onClick={() => assignMember(m.id, null)}
                          className="text-xs text-text-subtle hover:text-red-500 transition-colors flex-shrink-0"
                          title="Remove from group"
                        >✕</button>
                      )}
                    </div>
                  ))}
                  {members.length === 0 && (
                    <p className="px-4 py-3 text-xs text-text-subtle italic">No players yet</p>
                  )}
                </div>

                {/* Add player dropdown — only shown if not full and there are unassigned */}
                {isOrganiser && !isFull && unassigned.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-surface-subtle bg-surface-muted/40">
                    <select
                      className="w-full text-sm bg-white border border-surface-subtle rounded-xl px-3 py-2 text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-600"
                      value=""
                      onChange={(e) => { if (e.target.value) assignMember(e.target.value, group.id) }}
                    >
                      <option value="">+ Add player to this group…</option>
                      {unassigned.map((m) => (
                        <option key={m.id} value={m.id}>{m.profiles?.full_name ?? 'Player'}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Full indicator */}
                {isFull && (
                  <div className="px-4 py-2 bg-green-50 border-t border-green-100">
                    <p className="text-xs text-green-600 font-medium text-center">✓ Group full</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Completion prompt ──────────────────────────────────────────── */}
      {allAssigned && allHaveTimes && isOrganiser && (
        <div className="rounded-2xl bg-brand-600 text-white p-5 text-center space-y-2">
          <p className="font-bold text-lg">All groups ready 🎉</p>
          <p className="text-brand-100 text-sm">
            {players.length} players across {groups.length} groups · Tee times set
          </p>
          <p className="text-brand-200 text-xs mt-1">
            Mark the trip as "Groups Ready" from the Overview tab when you're happy.
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ value, label, done, warn }: { value: string; label: string; done?: boolean; warn?: boolean }) {
  return (
    <div className={cn(
      'rounded-2xl border p-3 text-center',
      done ? 'bg-green-50 border-green-200' : warn ? 'bg-amber-50 border-amber-200' : 'bg-white border-surface-subtle'
    )}>
      <p className={cn('text-xl font-bold', done ? 'text-green-600' : warn ? 'text-amber-600' : 'text-text')}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  )
}

function MiniAvatar({ member }: { member: TripMemberRow }) {
  const name = member.profiles?.full_name || '?'
  return member.profiles?.avatar_url ? (
    <img src={member.profiles.avatar_url} alt={name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
  ) : (
    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
      <span className="text-[10px] font-bold text-brand-600">{initials(name)}</span>
    </div>
  )
}
