'use client'

import React, { useState, useEffect } from 'react'
import { initials, avatarColor, formatHandicap, cn } from '@/lib/utils'
import { groupsRequired } from '@/types/app'
import type { TripData, TripMemberRow } from '../TripDetailClient'
import { WizardNav } from './TripOverviewTab'

interface TripGroup { id: string; name: string; tee_time: string | null; sort_order: number }
type Tab = 'overview' | 'players' | 'groups' | 'rounds'
interface Props { trip: TripData; isOrganiser: boolean; onRefresh: () => void; onTabChange: (t: Tab) => void }

// Resolve effective handicap: trip-specific first, then profile fallback
function effectiveHcp(m: TripMemberRow): number | null {
  if (m.playing_handicap !== null && m.playing_handicap !== undefined) return m.playing_handicap
  if (m.profiles?.handicap !== null && m.profiles?.handicap !== undefined) return m.profiles.handicap
  return null
}

function hcpLabel(m: TripMemberRow): string {
  return formatHandicap(m.playing_handicap, m.profiles?.handicap)
}

function hcpColor(m: TripMemberRow): string {
  const hcp = effectiveHcp(m)
  if (hcp === null) return '#a89e88'   // not provided — muted
  if (m.playing_handicap !== null && m.playing_handicap !== undefined) return '#1a4731'  // trip-specific — green
  return '#7a7260'  // profile fallback — grey-green
}

function roleLabel(m: TripMemberRow): string {
  return m.role === 'organiser' ? 'Organiser · Player' : 'Player'
}

export default function TripGroupsTab({ trip, isOrganiser, onRefresh, onTabChange }: Props) {
  const [groups, setGroups]     = useState<TripGroup[]>([])
  const [loading, setLoading]   = useState(true)
  const [generating, setGen]    = useState(false)
  const [assigning, setAssign]  = useState(false)
  const [editingId, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const players = trip.trip_members.filter(m =>
    m.role === 'player' || (m.role === 'organiser' && (trip.organiser_is_playing ?? false))
  )
  const ppg       = trip.players_per_group ?? 4
  const numGroups = groupsRequired(trip.expected_players, trip.players_per_group)

  useEffect(() => { loadGroups() }, [trip.id]) // eslint-disable-line

  async function loadGroups() {
    setLoading(true)
    const res = await fetch(`/api/trips/${trip.id}/groups`)
    if (res.ok) {
      setGroups(await res.json())
    } else {
      const d = await res.json().catch(() => ({}))
      const msg: string = d.error ?? ''
      console.error('[TripGroupsTab] loadGroups error:', msg)
      setApiError('Couldn\'t load groups. Please refresh the page or try again.')
    }
    setLoading(false)
  }

  async function generateGroups() {
    setApiError(null); setGen(true)
    const res = await fetch(`/api/trips/${trip.id}/groups/generate`, { method: 'POST' })
    if (res.ok) { await loadGroups(); onRefresh() }
    else { const d = await res.json().catch(() => ({})); setApiError(d.error ?? 'Failed to generate groups') }
    setGen(false)
  }

  async function addGroup() {
    setApiError(null)
    const name = `Playing Group ${groups.length + 1}`
    try {
      const res = await fetch(`/api/trips/${trip.id}/groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const g = await res.json()
        setGroups((gs: TripGroup[]) => [...gs, g])
      } else {
        const d = await res.json().catch(() => ({}))
        const msg: string = d.error ?? `HTTP ${res.status}`
        if (msg.includes('trip_groups') || msg.includes('relation') || msg.includes('does not exist')) {
          setApiError('Couldn\'t load groups. Please refresh the page or contact support.')
        } else {
          setApiError(`Could not create group: ${msg}`)
        }
      }
    } catch (err) {
      setApiError(`Network error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  async function saveEdit(groupId: string) {
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, tee_time: editTime || null }),
    })
    if (res.ok) setGroups((gs: TripGroup[]) => gs.map((g: TripGroup) =>
      g.id === groupId ? { ...g, name: editName, tee_time: editTime || null } : g
    ))
    setEditing(null)
  }

  async function deleteGroup(groupId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? Players will return to the unassigned pool.`)) return
    const res = await fetch(`/api/trips/${trip.id}/groups/${groupId}`, { method: 'DELETE' })
    if (res.ok) { setGroups((gs: TripGroup[]) => gs.filter((g: TripGroup) => g.id !== groupId)); onRefresh() }
  }

  async function autoAssign(groupList: TripGroup[]) {
    setAssign(true)
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    await Promise.all(shuffled.map((p, i) =>
      fetch(`/api/trips/${trip.id}/members/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupList[i % groupList.length].id }),
      })
    ))
    setAssign(false); onRefresh()
  }

  async function assign(memberId: string, groupId: string | null) {
    await fetch(`/api/trips/${trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId }),
    })
    setAddingTo(null); onRefresh()
  }

  const membersByGroup = (gid: string) => players.filter(m => (m.group_id ?? null) === gid)
  const unassigned = players.filter(m => !m.group_id || !groups.find((g: TripGroup) => g.id === m.group_id))
  const sortedGroups = [...groups].sort((a, b) => {
    if (!a.tee_time && !b.tee_time) return a.sort_order - b.sort_order
    if (!a.tee_time) return 1; if (!b.tee_time) return -1
    return a.tee_time.localeCompare(b.tee_time)
  })
  const allAssigned  = players.length > 0 && unassigned.length === 0
  const allHaveTimes = groups.length > 0 && groups.every((g: TripGroup) => g.tee_time)

  if (loading) return (
    <div className="py-16 flex flex-col items-center gap-3">
      <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #d9c9a3', borderTopColor: '#1a4731', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>Loading groups…</p>
    </div>
  )

  return (
    <div className="space-y-4">

      {/* Error banner */}
      {apiError && (
        <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#b91c1c', fontSize: 13, marginBottom: 4 }}>Something went wrong</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#dc2626' }}>{apiError}</p>
          <button onClick={() => setApiError(null)} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, textDecoration: 'underline' }}>Dismiss</button>
        </div>
      )}

      {/* ── No groups: guided setup ──────────────────────────────────── */}
      {groups.length === 0 && isOrganiser && (
        <div style={{
          background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 100%)',
          borderRadius: 18, padding: '24px 20px', textAlign: 'center',
          border: '2px solid rgba(201,168,76,0.3)',
        }}>
          <p style={{ fontSize: 36, marginBottom: 10 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
            Create Playing Groups
          </p>
          {numGroups > 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)', fontSize: 13, marginBottom: 20 }}>
              {trip.expected_players} players ÷ {ppg} per group
              {' = '}<span style={{ color: '#e8c96a', fontWeight: 700 }}>{numGroups} groups</span>
            </p>
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 12, marginBottom: 20 }}>
              You can create groups now and add players later.
            </p>
          )}
          {numGroups > 0 && (
            <button onClick={generateGroups} disabled={generating} style={{
              display: 'block', width: '100%', marginBottom: 10,
              padding: '14px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #c9a84c, #e8c96a)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 800, color: '#0f2d1c',
              boxShadow: '0 4px 16px rgba(201,168,76,0.5)', opacity: generating ? 0.5 : 1,
            }}>
              {generating ? 'Generating…' : `Generate ${numGroups} Playing Groups →`}
            </button>
          )}
          <button onClick={addGroup} style={{
            display: 'block', width: '100%',
            padding: '12px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
            background: 'rgba(255,255,255,0.08)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
          }}>
            + Create Playing Group
          </button>
        </div>
      )}

      {/* ── Summary strip ────────────────────────────────────────────── */}
      {groups.length > 0 && (
        <div className="card p-4">
          <div className="flex text-center" style={{ gap: 0 }}>
            <SummaryCell
              value={`${players.length - unassigned.length}/${players.length}`}
              label="Assigned" ok={allAssigned} warn={!allAssigned && players.length > 0}
            />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <SummaryCell
              value={`${groups.filter((g: TripGroup) => membersByGroup(g.id).length > 0).length}/${groups.length}`}
              label="Groups filled" ok={allAssigned}
            />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <SummaryCell
              value={`${groups.filter((g: TripGroup) => g.tee_time).length}/${groups.length}`}
              label="Tee times" ok={allHaveTimes} warn={!allHaveTimes}
            />
          </div>
        </div>
      )}

      {/* ── Hints ────────────────────────────────────────────────────── */}
      {groups.length > 0 && unassigned.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#92400e' }}>
            ⚠ {unassigned.length} player{unassigned.length !== 1 ? 's' : ''} unassigned.
          </p>
        </div>
      )}
      {groups.length > 0 && !allHaveTimes && (
        <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#166534' }}>
            Add tee times to each group before marking as Groups Ready.
          </p>
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────── */}
      {groups.length > 0 && isOrganiser && (
        <div className="flex gap-2 flex-wrap">
          {unassigned.length > 0 && (
            <button onClick={() => autoAssign(groups)} disabled={assigning} style={{
              flex: 2, padding: '11px 14px', borderRadius: 10,
              background: 'linear-gradient(135deg, #2d7a52, #1a4731)', border: 'none',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#ffffff',
              cursor: 'pointer', opacity: assigning ? 0.5 : 1,
            }}>
              {assigning ? 'Assigning…' : `Auto-assign ${unassigned.length} player${unassigned.length !== 1 ? 's' : ''}`}
            </button>
          )}
          <button onClick={addGroup} style={{
            flex: 1, padding: '11px 14px', borderRadius: 10,
            background: '#f8f4eb', border: '1.5px solid #d9c9a3',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#1a1a16',
            cursor: 'pointer',
          }}>+ Group</button>
          {numGroups > 0 && (
            <button onClick={generateGroups} disabled={generating} style={{
              padding: '11px 14px', borderRadius: 10,
              background: '#f8f4eb', border: '1.5px solid #d9c9a3',
              fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260',
              cursor: 'pointer', opacity: generating ? 0.5 : 1,
            }}>Regen</button>
          )}
        </div>
      )}

      {/* All done banner */}
      {allAssigned && allHaveTimes && (
        <div style={{ background: 'linear-gradient(135deg, #1a4731, #2d7a52)', borderRadius: 14, padding: '14px 18px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 17, fontWeight: 700 }}>All groups ready ✓</p>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.65)', fontSize: 12, marginTop: 3 }}>Mark as Groups Ready from the Overview tab</p>
        </div>
      )}

      {/* ── PLAYING GROUPS ───────────────────────────────────────────── */}
      {sortedGroups.length > 0 && (
        <section>
          <p className="s-label" style={{ marginBottom: 14 }}>Playing Groups</p>
          <div className="space-y-5">
            {sortedGroups.map((group) => {
              const members    = membersByGroup(group.id)
              const isEdit     = editingId === group.id
              const isAdding   = addingTo === group.id
              // Group handicap stats for Ambrose planning
              const validHcps  = members.map(effectiveHcp).filter((h): h is number => h !== null)
              const avgHcp     = validHcps.length > 0
                ? Math.round((validHcps.reduce((a, b) => a + b, 0) / validHcps.length) * 10) / 10
                : null

              return (
                <div key={group.id}>
                  {/* Group label row */}
                  <div className="flex items-center justify-between mb-2">
                    {isEdit ? (
                      <div className="flex items-center gap-2 flex-1 flex-wrap">
                        <input value={editName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
                          style={{
                            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: 0.8,
                            background: 'transparent', border: 'none',
                            borderBottom: '1.5px solid #c9a84c', color: '#1a1a16',
                            outline: 'none', width: 120,
                          }} />
                        <input type="time" value={editTime}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTime(e.target.value)}
                          style={{
                            fontFamily: 'var(--font-body)', fontSize: 11, background: '#ffffff',
                            border: '1px solid #d9c9a3', borderRadius: 7, padding: '2px 7px',
                            color: '#c9a84c', outline: 'none',
                          }} />
                        <button onClick={() => saveEdit(group.id)} style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditing(null)} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="s-label" style={{ margin: 0 }}>{group.name}</p>
                          {/* Avg handicap for Ambrose planning */}
                          {avgHcp !== null && members.length > 1 && (
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#a89e88', marginTop: 1 }}>
                              Avg HCP {avgHcp}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {group.tee_time && (
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#8b6914' }}>
                              ⏱ {group.tee_time}
                            </span>
                          )}
                          {isOrganiser && (
                            <>
                              <button
                                onClick={() => { setEditing(group.id); setEditName(group.name); setEditTime(group.tee_time ?? '') }}
                                style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', background: 'none', border: 'none', cursor: 'pointer' }}>
                                {group.tee_time ? 'Edit' : 'Set tee time'}
                              </button>
                              <button onClick={() => deleteGroup(group.id, group.name)}
                                style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Group card */}
                  <div className="card overflow-hidden">
                    {members.map((m, i) => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-3"
                        style={{ borderTop: i > 0 ? '1px solid #ede0c4' : 'none' }}>
                        <PlayerAvatar member={m} />
                        <div className="flex-1 min-w-0">
                          {/* Name + HCP on same line */}
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13 }}>
                              {m.profiles?.full_name ?? 'Player'}
                            </p>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: hcpColor(m) }}>
                              {hcpLabel(m)}
                            </span>
                          </div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88' }}>
                            {roleLabel(m)}
                          </p>
                        </div>
                        {isOrganiser ? (
                          <button onClick={() => assign(m.id, null)}
                            style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                            Remove
                          </button>
                        ) : (
                          <span style={{
                            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: '#15803d',
                            background: '#f0faf4', border: '1px solid #86efac', borderRadius: 20, padding: '3px 10px', flexShrink: 0,
                          }}>✓ Added</span>
                        )}
                      </div>
                    ))}

                    {members.length === 0 && (
                      <div className="px-4 py-4 text-center">
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a89e88', fontStyle: 'italic' }}>No players assigned yet</p>
                      </div>
                    )}

                    {/* Add Player section */}
                    {isOrganiser && (
                      <div style={{ borderTop: '1px solid #ede0c4' }}>
                        {isAdding ? (
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-3">
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                                Select a player
                              </p>
                              <button onClick={() => setAddingTo(null)}
                                style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', background: 'none', border: 'none', cursor: 'pointer' }}>
                                ✕ Cancel
                              </button>
                            </div>
                            {unassigned.length === 0 ? (
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a89e88', textAlign: 'center', padding: '8px 0' }}>
                                No unassigned players available
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {unassigned.map(m => (
                                  <button key={m.id} onClick={() => assign(m.id, group.id)}
                                    className="w-full flex items-center gap-3 text-left"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 10 }}
                                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = '#f0fdf4')}
                                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'none')}
                                  >
                                    <PlayerAvatar member={m} small />
                                    <div className="flex-1 min-w-0">
                                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16' }}>
                                        {m.profiles?.full_name ?? 'Player'}
                                      </p>
                                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>
                                        {roleLabel(m)}
                                      </p>
                                    </div>
                                    {/* HCP shown prominently for comparison */}
                                    <span style={{
                                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                                      color: hcpColor(m), flexShrink: 0,
                                      background: '#f8f4eb', borderRadius: 8, padding: '3px 8px',
                                    }}>
                                      {hcpLabel(m)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => setAddingTo(group.id)}
                            className="w-full flex items-center justify-center gap-2"
                            style={{
                              padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer',
                              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a4731',
                            }}
                            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = '#f0fdf4')}
                            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'none')}
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

      {/* ── Unassigned player pool ───────────────────────────────────── */}
      {unassigned.length > 0 && groups.length > 0 && (
        <section>
          <p className="s-label" style={{ color: '#b45309', marginBottom: 8 }}>
            Unassigned Players ({unassigned.length})
          </p>
          <div className="card overflow-hidden" style={{ borderColor: '#fcd34d' }}>
            {unassigned.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? '1px solid #ede0c4' : 'none' }}>
                <PlayerAvatar member={m} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13 }}>
                      {m.profiles?.full_name ?? 'Player'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: hcpColor(m) }}>
                      {hcpLabel(m)}
                    </span>
                  </div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88' }}>
                    {roleLabel(m)}
                  </p>
                </div>
                {isOrganiser && (
                  <select value=""
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { if (e.target.value) assign(m.id, e.target.value) }}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: 12, color: '#1a4731',
                      background: '#ffffff', border: '1.5px solid #c9a84c', borderRadius: 8, padding: '5px 10px',
                      outline: 'none', cursor: 'pointer',
                    }}>
                    <option value="">Assign →</option>
                    {sortedGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({membersByGroup(g.id).length}/{ppg})</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <WizardNav
        onBack={() => onTabChange('players')} backLabel="← Players"
        onNext={() => onTabChange('rounds')} nextLabel="Review Rounds →"
      />
    </div>
  )
}

function PlayerAvatar({ member, small }: { member: TripMemberRow; small?: boolean }) {
  const name  = member.profiles?.full_name || '?'
  const color = avatarColor(member.profile_id)
  const size  = small ? 32 : 38
  return member.profiles?.avatar_url ? (
    <img src={member.profiles.avatar_url} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(255,255,255,0.3)' }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: color, border: '2px solid rgba(255,255,255,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#ffffff', fontWeight: 700, fontSize: small ? 11 : 13,
      fontFamily: 'var(--font-body)',
    }}>
      {initials(name)}
    </div>
  )
}

function SummaryCell({ value, label, ok, warn }: { value: string; label: string; ok?: boolean; warn?: boolean }) {
  const color = ok ? '#1a4731' : warn ? '#d97706' : '#1a1a16'
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 12px' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color }}>{value}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#7a7260', marginTop: 2 }}>{label}</p>
    </div>
  )
}
