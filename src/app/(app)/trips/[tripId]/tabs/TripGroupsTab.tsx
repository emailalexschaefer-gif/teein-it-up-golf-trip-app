'use client'

import { useState, useEffect } from 'react'
import { initials, avatarColor, cn } from '@/lib/utils'
import { groupsRequired } from '@/types/app'
import type { TripData, TripMemberRow } from '../TripDetailClient'

interface TripGroup { id: string; name: string; tee_time: string | null; sort_order: number }
interface Props { trip: TripData; isOrganiser: boolean; onRefresh: () => void }

export default function TripGroupsTab({ trip, isOrganiser, onRefresh }: Props) {
  const [groups, setGroups]       = useState<TripGroup[]>([])
  const [loading, setLoading]     = useState(true)
  const [generating, setGen]      = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [editingId, setEditing]   = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editTime, setEditTime]   = useState('')
  // For "Add Player" picker — which group is open
  const [addingTo, setAddingTo]   = useState<string | null>(null)
  const [apiError, setApiError]   = useState<string | null>(null)

  const players  = trip.trip_members.filter(m =>
    m.role === 'player' || (m.role === 'organiser' && trip.organiser_is_playing)
  )
  const ppg       = trip.players_per_group ?? 4
  const numGroups = groupsRequired(trip.expected_players, trip.players_per_group)

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
    if (res.ok) { await fetchGroups(); onRefresh() }
    else { const d = await res.json().catch(() => ({})); setApiError(d.error ?? 'Failed to generate groups') }
    setGen(false)
  }

  async function autoAssign(groupList: TripGroup[]) {
    setAssigning(true)
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    await Promise.all(shuffled.map((p, i) =>
      fetch(`/api/trips/${trip.id}/members/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupList[i % groupList.length].id }),
      })
    ))
    setAssigning(false)
    onRefresh()
  }

  async function saveEdit(groupId: string) {
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, tee_time: editTime || null }),
    })
    if (res.ok) setGroups(gs => gs.map(g =>
      g.id === groupId ? { ...g, name: editName, tee_time: editTime || null } : g
    ))
    setEditing(null)
  }

  async function deleteGroup(groupId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? Players will be unassigned.`)) return
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, { method: 'DELETE' })
    if (res.ok) { setGroups(gs => gs.filter(g => g.id !== groupId)); onRefresh() }
  }

  async function addGroup() {
    setApiError(null)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const name = groups.length < 26 ? `Group ${letters[groups.length]}` : `Group ${groups.length + 1}`
    try {
      const res = await fetch(`/api/trips/${trip.id}/groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const g = await res.json()
        setGroups(gs => [...gs, g])
      } else {
        const d = await res.json().catch(() => ({}))
        const msg: string = d.error ?? `HTTP ${res.status}`
        if (msg.includes('trip_groups') || msg.includes('relation') || msg.includes('does not exist')) {
          setApiError('Groups table not set up yet. Run migration 011 in Supabase SQL Editor, then refresh.')
        } else {
          setApiError(`Could not create group: ${msg}`)
        }
      }
    } catch (err) {
      setApiError(`Network error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  async function assign(memberId: string, groupId: string | null) {
    await fetch(`/api/trips/${trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId }),
    })
    setAddingTo(null)
    onRefresh()
  }

  const membersByGroup = (gid: string) => players.filter(m => (m.group_id ?? null) === gid)
  const unassigned = players.filter(m => !m.group_id || !groups.find(g => g.id === m.group_id))

  const sortedGroups = [...groups].sort((a, b) => {
    if (!a.tee_time && !b.tee_time) return a.sort_order - b.sort_order
    if (!a.tee_time) return 1; if (!b.tee_time) return -1
    return a.tee_time.localeCompare(b.tee_time)
  })

  const allAssigned  = players.length > 0 && unassigned.length === 0
  const allHaveTimes = groups.length > 0 && groups.every(g => g.tee_time)

  if (loading) return (
    <div className="py-16 flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      <p className="text-sm text-text-muted">Loading groups…</p>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* API error display */}
      {apiError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">{apiError}</p>
          <button onClick={() => setApiError(null)} className="text-xs text-red-500 underline mt-2">Dismiss</button>
        </div>
      )}

      {/* ── No groups: guided setup card ──────────────────────────────── */}
      {groups.length === 0 && isOrganiser && (
        <div className="bg-brand-950 rounded-3xl p-6 space-y-4">
          <div className="text-center">
            <p className="text-4xl mb-3">⛳</p>
            <p className="text-white font-black text-xl">Create Playing Groups</p>
            {numGroups > 0 ? (
              <p className="text-white/60 text-sm mt-1.5">
                {trip.expected_players} players ÷ {ppg} per group
                {' = '}<span className="text-gold-400 font-bold">{numGroups} groups</span>
              </p>
            ) : (
              <p className="text-white/60 text-sm mt-1.5">
                Set player capacity in Overview to auto-calculate group size.
              </p>
            )}
          </div>
          {numGroups > 0 && (
            <button
              onClick={generateGroups} disabled={generating}
              className="w-full bg-gold-500 hover:bg-gold-400 text-brand-950 font-black py-4 rounded-2xl text-base transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating…' : `Generate ${numGroups} Groups →`}
            </button>
          )}
          <button onClick={addGroup}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-2xl text-sm transition-colors">
            + Add group manually
          </button>
        </div>
      )}

      {/* ── Progress summary ─────────────────────────────────────────── */}
      {groups.length > 0 && (
        <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle p-4">
          <div className="flex divide-x divide-surface-subtle text-center">
            <SummaryCell value={`${players.length - unassigned.length}/${players.length}`} label="Players Assigned" ok={allAssigned} warn={!allAssigned && players.length > 0} />
            <SummaryCell value={`${groups.filter(g => membersByGroup(g.id).length > 0).length}/${groups.length}`} label="Groups Filled" ok={allAssigned} />
            <SummaryCell value={`${groups.filter(g => g.tee_time).length}/${groups.length}`} label="Tee Times" ok={allHaveTimes} warn={!allHaveTimes} />
          </div>
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────── */}
      {groups.length > 0 && isOrganiser && (
        <div className="flex gap-2 flex-wrap">
          {unassigned.length > 0 && (
            <button onClick={() => autoAssign(groups)} disabled={assigning}
              className="flex-1 bg-brand-600 text-white font-bold py-3 rounded-xl text-sm hover:bg-brand-700 transition-colors disabled:opacity-50">
              {assigning ? 'Assigning…' : `Auto-assign ${unassigned.length} player${unassigned.length !== 1 ? 's' : ''} →`}
            </button>
          )}
          <button onClick={addGroup}
            className="bg-ivory border border-surface-subtle text-text font-semibold px-4 py-3 rounded-xl text-sm hover:bg-cream-100 transition-colors">
            + Group
          </button>
          {numGroups > 0 && (
            <button onClick={generateGroups} disabled={generating}
              className="bg-ivory border border-surface-subtle text-text-muted px-4 py-3 rounded-xl text-sm hover:bg-cream-100 transition-colors disabled:opacity-50">
              Regenerate
            </button>
          )}
        </div>
      )}

      {/* ── All done banner ──────────────────────────────────────────── */}
      {allAssigned && allHaveTimes && (
        <div className="bg-brand-600 rounded-2xl p-4 text-center">
          <p className="text-white font-black text-lg">All groups ready ✓</p>
          <p className="text-white/70 text-sm mt-0.5">Mark as "Groups Ready" from the Overview tab</p>
        </div>
      )}

      {/* ── PLAYING GROUPS — demo layout ─────────────────────────────── */}
      {sortedGroups.length > 0 && (
        <section>
          {/* Demo: "PLAYING GROUPS" as a section label */}
          <p className="s-label" style={{marginBottom:14}}>Playing Groups</p>

          <div className="space-y-5">
            {sortedGroups.map((group) => {
              const members = membersByGroup(group.id)
              const isEdit  = editingId === group.id
              const isFull  = members.length >= ppg
              const isAdding = addingTo === group.id

              return (
                <div key={group.id}>
                  {/* Demo: group label OUTSIDE the card */}
                  <div className="flex items-center justify-between mb-2">
                    {isEdit ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          value={editName} onChange={e => setEditName(e.target.value)}
                          className="text-xs font-bold uppercase tracking-wider bg-transparent border-b border-brand-400 text-text-muted focus:outline-none w-28"
                        />
                        <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                          className="text-xs bg-white border border-surface-subtle rounded-lg px-2 py-0.5 focus:outline-none text-gold-600" />
                        <button onClick={() => saveEdit(group.id)} className="text-xs font-bold text-brand-600 ml-1">Save</button>
                        <button onClick={() => setEditing(null)} className="text-xs text-text-muted">✕</button>
                      </div>
                    ) : (
                      <>
                        <p className="s-label">{group.name}</p>
                        <div className="flex items-center gap-3">
                          {group.tee_time && (
                            <span className="text-xs font-bold text-gold-600">
                              ⏱ {group.tee_time}
                            </span>
                          )}
                          {isOrganiser && (
                            <>
                              <button
                                onClick={() => { setEditing(group.id); setEditName(group.name); setEditTime(group.tee_time ?? '') }}
                                className="text-xs text-text-subtle hover:text-brand-600 transition-colors"
                              >
                                {group.tee_time ? 'Edit' : 'Set tee time'}
                              </button>
                              <button onClick={() => deleteGroup(group.id, group.name)}
                                className="text-xs text-red-400 hover:text-red-600 transition-colors">
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Demo: bordered card containing player rows */}
                  <div className="bg-ivory rounded-2xl shadow-card border border-surface-subtle overflow-hidden">
                    {members.map((m, i) => (
                      <div key={m.id}
                        className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-surface-subtle')}>
                        <PlayerAvatar member={m} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-text text-sm">{m.profiles?.full_name ?? 'Player'}</p>
                          <p className="text-xs text-text-subtle">HCP —</p>
                        </div>
                        {isOrganiser ? (
                          <button
                            onClick={() => assign(m.id, null)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                            title="Remove from group"
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex-shrink-0">
                            ✓ Added
                          </span>
                        )}
                      </div>
                    ))}

                    {members.length === 0 && (
                      <div className="px-4 py-4 text-center">
                        <p className="text-sm text-text-subtle italic">No players assigned yet</p>
                      </div>
                    )}

                    {/* Add Player button — inside the card at the bottom */}
                    {isOrganiser && !isFull && (
                      <div className={cn('border-t border-surface-subtle', members.length === 0 && 'border-t-0')}>
                        {isAdding ? (
                          /* Player picker — shown inline when "Add Player" is pressed */
                          <div className="p-3 space-y-1">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Select a player</p>
                              <button onClick={() => setAddingTo(null)} className="text-xs text-text-subtle hover:text-text">✕ Cancel</button>
                            </div>
                            {unassigned.length === 0 ? (
                              <p className="text-xs text-text-subtle text-center py-2">No unassigned players</p>
                            ) : (
                              unassigned.map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => assign(m.id, group.id)}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand-50 transition-colors text-left"
                                >
                                  <PlayerAvatar member={m} small />
                                  <span className="text-sm font-medium text-text">{m.profiles?.full_name ?? 'Player'}</span>
                                </button>
                              ))
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingTo(group.id)}
                            className="w-full flex items-center justify-center gap-2 py-3 text-brand-600 font-semibold text-sm hover:bg-brand-50 transition-colors"
                          >
                            + Add Player
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Unassigned pool — shown below groups ─────────────────────── */}
      {unassigned.length > 0 && groups.length > 0 && (
        <section>
          <p className="s-label" style={{color:"#b45309"}}>
            Unassigned Players ({unassigned.length})
          </p>
          <div className="bg-ivory rounded-2xl shadow-card border border-amber-200 overflow-hidden">
            {unassigned.map((m, i) => (
              <div key={m.id}
                className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-surface-subtle')}>
                <PlayerAvatar member={m} />
                <span className="text-sm font-semibold text-text flex-1">{m.profiles?.full_name ?? 'Player'}</span>
                {isOrganiser && (
                  <select
                    className="text-sm border border-brand-200 text-brand-600 bg-white rounded-xl px-3 py-1.5 focus:outline-none font-medium"
                    value="" onChange={e => { if (e.target.value) assign(m.id, e.target.value) }}
                  >
                    <option value="">Assign →</option>
                    {sortedGroups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({membersByGroup(g.id).length}/{ppg})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PlayerAvatar({ member, small }: { member: TripMemberRow; small?: boolean }) {
  const name  = member.profiles?.full_name || '?'
  const color = avatarColor(member.profile_id)
  const size  = small ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return member.profiles?.avatar_url ? (
    <img src={member.profiles.avatar_url} alt={name}
      className={cn('rounded-full object-cover flex-shrink-0 ring-2 ring-white', size)} />
  ) : (
    <div
      className={cn('rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-white font-bold text-white', size)}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </div>
  )
}

function SummaryCell({ value, label, ok, warn }: { value: string; label: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className="flex-1 text-center px-3">
      <p className={cn('text-2xl font-black', ok ? 'text-green-600' : warn ? 'text-amber-500' : 'text-text')}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  )
}
