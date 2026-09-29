'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useMyTrips } from '@/lib/queries/trips'
import { useAuthUser } from '@/lib/hooks/useAuthUser'
import { useQueryClient } from '@tanstack/react-query'
import TripCard from './TripCard'
import type { TripSummary } from '@/types/app'

type FilterTab = 'active' | 'completed' | 'archived'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived',  label: 'Archived' },
]

const ACTIVE_STATUSES    = ['draft', 'open', 'groups_ready', 'ready', 'live']
const COMPLETED_STATUSES = ['completed']
const ARCHIVED_STATUSES  = ['archived']

function filterTrips(trips: TripSummary[], tab: FilterTab): TripSummary[] {
  if (tab === 'active')    return trips.filter(t => ACTIVE_STATUSES.includes(t.status))
  if (tab === 'completed') return trips.filter(t => COMPLETED_STATUSES.includes(t.status))
  if (tab === 'archived')  return trips.filter(t => ARCHIVED_STATUSES.includes(t.status))
  return trips
}

// Section label within the active trips list
function groupLabel(trips: TripSummary[]): { upcoming: TripSummary[]; live: TripSummary[] } {
  return {
    live:     trips.filter(t => t.status === 'live'),
    upcoming: trips.filter(t => t.status !== 'live'),
  }
}

const EMPTY_STATES: Record<FilterTab, { icon: string; title: string; body: string }> = {
  active: {
    icon:  '⛳',
    title: 'No active events yet',
    body:  'Create your first event and start bringing people together through golf.',
  },
  completed: {
    icon:  '🏆',
    title: 'No completed events yet',
    body:  'Finish your first event and celebrate your results here.',
  },
  archived: {
    icon:  '📁',
    title: 'No archived events',
    body:  'Events you archive will remain safely stored here — restore them any time.',
  },
}

function TripCardSkeleton() {
  return (
    <div className="bg-ivory rounded-card border border-parchment-dark p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="skeleton skeleton-avatar w-14 h-14 rounded-2xl" />
        <div className="flex-1 space-y-2 py-1">
          <div className="skeleton skeleton-title w-2/3" />
          <div className="skeleton skeleton-text w-1/2" />
          <div className="flex gap-2 mt-2">
            <div className="skeleton h-3 w-16 rounded-full" />
            <div className="skeleton h-3 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TripList() {
  const [filter, setFilter] = useState<FilterTab>('active')
  const { user, authResolved } = useAuthUser()
  const { data: trips, isLoading, error, refetch, isFetching } = useMyTrips(user?.id, authResolved)
  const queryClient = useQueryClient()

  // Event Management Phase 2 (10 Sep), Part 3-5 -- Manage mode. Only
  // ever entered deliberately (never on a normal tap), and only
  // offered on Completed/Archived at all -- the tab bar itself never
  // renders a Manage toggle for Active, per the explicit "do not add
  // destructive bulk management to Active" instruction.
  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ succeededCount: number; failed: { id: string; reason: string }[] } | null>(null)

  function changeTab(tab: FilterTab) {
    setFilter(tab)
    // Manage mode and any selection are scoped to one tab visit --
    // switching tabs always exits it cleanly rather than carrying a
    // Completed-tab selection into Archived by accident.
    setManageMode(false)
    setSelectedIds(new Set())
    setBulkResult(null)
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function runBulkAction(action: 'archive' | 'restore') {
    if (selectedIds.size === 0) return
    setBulkPending(true)
    setBulkResult(null)
    try {
      const res = await fetch('/api/trips/bulk-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripIds: [...selectedIds], action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Bulk operation failed.')
      // Partial-failure reporting, per the explicit "must not simply
      // say '10 Events archived' if only 8 succeeded" instruction --
      // the response is read and shown accurately, not assumed.
      setBulkResult({ succeededCount: (body.succeededIds ?? []).length, failed: body.failed ?? [] })
      setSelectedIds(new Set((body.failed ?? []).map((f: { id: string }) => f.id)))
      await queryClient.invalidateQueries({ queryKey: ['trips'] })
      await refetch()
    } catch (err) {
      setBulkResult({ succeededCount: 0, failed: [...selectedIds].map(id => ({ id, reason: err instanceof Error ? err.message : 'Failed.' })) })
    } finally {
      setBulkPending(false)
    }
  }

  const filtered   = filterTrips(trips ?? [], filter)

  // Distinct from the trip-loading skeleton below — this is "we don't
  // even know who you are yet," not "we know who you are and are
  // fetching their trips." Collapsing these into one state was the root
  // cause of the endless skeleton: if auth resolution stalled, the trip
  // query's own isLoading would never meaningfully reflect that, since
  // the query wasn't even allowed to start yet.
  if (!authResolved) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-10 w-full rounded-xl" />
        {[1, 2, 3].map(i => <TripCardSkeleton key={i} />)}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {/* Tab skeleton */}
        <div className="skeleton h-10 w-full rounded-xl" />
        {[1, 2, 3].map(i => <TripCardSkeleton key={i} />)}
      </div>
    )
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div className="rounded-card bg-red-50 border border-red-100 p-5 text-center space-y-2">
        <p className="text-sm font-semibold text-red-600">Couldn&apos;t load events</p>
        <p className="text-xs text-red-400 font-mono break-all">{message}</p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-red-200 bg-white px-4 py-1.5 text-xs font-semibold text-red-600"
          style={{ opacity: isFetching ? 0.6 : 1 }}
        >
          {isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  const empty = EMPTY_STATES[filter as FilterTab]
  const { live, upcoming } = groupLabel(filtered)

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div style={{
        display: 'flex',
        background: '#f2e8d0',
        borderRadius: 12,
        padding: 3,
        gap: 2,
      }}>
        {TABS.map(({ key, label }) => {
          const count = filterTrips(trips ?? [], key).length
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => changeTab(key)}
              className="flex-1 transition-all duration-150 active:scale-95"
              style={{
                padding: '8px 4px',
                borderRadius: 9,
                border: 'none',
                background: active ? '#f8f4eb' : 'transparent',
                boxShadow: active ? '0 1px 6px rgba(15,45,28,0.08)' : 'none',
                fontFamily: 'var(--font-body)',
                fontSize: 12.5,
                fontWeight: active ? 700 : 500,
                color: active ? '#1a4731' : '#7a7260',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              {label}
              {count > 0 && (
                <span style={{
                  background: active ? '#1a4731' : '#d9c9a3',
                  color: active ? '#e8c96a' : '#7a7260',
                  borderRadius: 10,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Event Management Phase 2 (10 Sep), Part 3 -- Manage mode toggle.
          Only offered on Completed/Archived, never Active, per the
          explicit "do not add destructive bulk management to Active"
          instruction. */}
      {filter !== 'active' && filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
          {manageMode ? (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: '#1a4731' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map(t => t.id)) : new Set())}
                  style={{ width: 20, height: 20 }}
                />
                Select all {selectedIds.size > 0 && `(${selectedIds.size} selected)`}
              </label>
              <button
                onClick={() => { setManageMode(false); setSelectedIds(new Set()); setBulkResult(null) }}
                style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px' }}
              >
                Done
              </button>
            </>
          ) : (
            <button
              onClick={() => setManageMode(true)}
              style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px' }}
            >
              Manage
            </button>
          )}
        </div>
      )}

      {bulkResult && (
        <div style={{
          borderRadius: 10, padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 12,
          background: bulkResult.failed.length > 0 ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${bulkResult.failed.length > 0 ? '#fecaca' : '#bbf7d0'}`,
          color: bulkResult.failed.length > 0 ? '#dc2626' : '#166534',
        }}>
          {bulkResult.succeededCount} event{bulkResult.succeededCount === 1 ? '' : 's'} updated.
          {bulkResult.failed.length > 0 && ` ${bulkResult.failed.length} could not be updated — still selected, you can retry.`}
        </div>
      )}

      {/* Trip cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 px-4 text-center animate-fadeIn">
          <span style={{ fontSize: 44, marginBottom: 12 }}>{empty.icon}</span>
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700,
            color: '#1a1a16', marginBottom: 6,
          }}>{empty.title}</h3>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260',
            maxWidth: 260, lineHeight: 1.55,
          }}>{empty.body}</p>
          {filter === 'active' && (
            <Link
              href="/trips/new"
              className="mt-5 active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(160deg, #2d7a52 0%, #1a4731 100%)',
                color: '#ffffff',
                borderRadius: 12, padding: '11px 22px',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(26,71,49,0.35)',
              }}
            >
              + Create your first event
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {/* Live trips first with a label */}
          {live.length > 0 && (
            <>
              <div className="s-label px-1 pt-1">🔴 Live now</div>
              {live.map(trip => (
                <div key={trip.id} className="animate-fadeUp ring-2 ring-green-400 rounded-card">
                  <TripCard trip={trip} />
                </div>
              ))}
              {upcoming.length > 0 && <div className="s-label px-1 pt-1">Upcoming</div>}
            </>
          )}
          {upcoming.map(trip => (
            <div key={trip.id} className="animate-fadeUp" style={{ position: 'relative' }}>
              {manageMode ? (
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
                  <button
                    onClick={() => toggleSelected(trip.id)}
                    aria-label={selectedIds.has(trip.id) ? 'Deselect event' : 'Select event'}
                    style={{
                      flexShrink: 0, width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(trip.id)}
                      onChange={() => toggleSelected(trip.id)}
                      style={{ width: 24, height: 24, pointerEvents: 'none' }}
                    />
                  </button>
                  {/* Manage mode (Part 13, mobile UX) -- the card itself
                      becomes a non-navigating toggle, not a Link, so there
                      is no accidental navigation while selecting; tapping
                      anywhere on the card row toggles selection exactly
                      like the checkbox does. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSelected(trip.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSelected(trip.id) }}
                    style={{
                      flex: 1, cursor: 'pointer', borderRadius: 16,
                      outline: selectedIds.has(trip.id) ? '2px solid #1a4731' : 'none', outlineOffset: 2,
                    }}
                  >
                    <div style={{ pointerEvents: 'none' }}>
                      <TripCard trip={trip} />
                    </div>
                  </div>
                </div>
              ) : (
                <TripCard trip={trip} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sticky bulk action bar (Part 13, mobile UX -- easy to reach with
          a thumb, destructive/primary action visually distinct). */}
      {manageMode && selectedIds.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0, marginTop: 8,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3', borderRadius: 14,
          padding: '10px 12px', display: 'flex', gap: 8, boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
        }}>
          {filter === 'completed' && (
            <button
              onClick={() => runBulkAction('archive')}
              disabled={bulkPending}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
                background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                cursor: bulkPending ? 'default' : 'pointer', opacity: bulkPending ? 0.6 : 1,
              }}
            >
              {bulkPending ? 'Archiving…' : `Archive Selected (${selectedIds.size})`}
            </button>
          )}
          {filter === 'archived' && (
            <button
              onClick={() => runBulkAction('restore')}
              disabled={bulkPending}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
                background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                cursor: bulkPending ? 'default' : 'pointer', opacity: bulkPending ? 0.6 : 1,
              }}
            >
              {bulkPending ? 'Restoring…' : `Restore Selected (${selectedIds.size})`}
            </button>
          )}
          {/* Delete Permanently intentionally not offered here yet --
              deferred pending the storage/DB safety audit (Parts 6-9). */}
        </div>
      )}
    </div>
  )
}
