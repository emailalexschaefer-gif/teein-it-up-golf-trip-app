'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatTripDateRange } from '@/lib/utils'
import { TRIP_STATUS_LABELS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS } from '@/types/app'
import type { TripData } from '../TripDetailClient'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'

interface Props {
  trip: TripData; isOrganiser: boolean; playerCount: number; numGroups: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStatus: any; toast: any; router: any
  onTabChange: (tab: Tab) => void
}

export default function TripOverviewTab({ trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router, onTabChange }: Props) {
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [showDeleteDialog,  setShowDeleteDialog]  = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const eventLabel   = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]
  const expected     = trip.expected_players ?? 0
  const ppg          = trip.players_per_group ?? 4

  const isArchived = trip.status === 'archived'

  // Forward-moving status transitions (exclude archive + backward moves)
  // Lifecycle order — forward means moving to a higher index
  const lifecycleOrder: import('@/types/app').TripStatus[] = [
    'draft', 'open', 'groups_ready', 'ready', 'live', 'completed',
  ]
  const currentIdx = lifecycleOrder.indexOf(trip.status)
  const forwardStatuses: import('@/types/app').TripStatus[] = nextStatuses.filter(s =>
    s !== 'archived' && lifecycleOrder.indexOf(s) > currentIdx
  )
  const backwardStatuses: import('@/types/app').TripStatus[] = nextStatuses.filter(s =>
    s !== 'archived' && lifecycleOrder.indexOf(s) !== -1 && lifecycleOrder.indexOf(s) < currentIdx
  )

  async function handleRestore() {
    setRestoring(true)
    // Infer the right restore target from existing trip data:
    // - any completed round → restore to 'completed'
    // - has players but no completed rounds → restore to 'open'
    // - pure draft (no players, no rounds) → restore to 'draft'
    const hasCompletedRound = trip.rounds.some(r => r.status === 'completed')
    const hasPlayers = trip.trip_members.some(m => m.role === 'player')
    const restoreStatus: import('@/types/app').TripStatus =
      hasCompletedRound ? 'completed'
      : hasPlayers       ? 'open'
      :                    'draft'
    await updateStatus.mutateAsync({ tripId: trip.id, status: restoreStatus })
    toast(`Trip restored to ${TRIP_STATUS_LABELS[restoreStatus]}`, 'success')
    router.refresh()
    setRestoring(false)
  }

  async function handleArchive() {
    await updateStatus.mutateAsync({ tripId: trip.id, status: 'archived' })
    toast('Trip archived', 'success')
    setShowArchiveDialog(false)
    router.push('/dashboard')
  }

  async function handleDelete() {
    if (deleteConfirmText !== 'DELETE') return
    setDeleting(true)
    const res = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) {
      toast('Trip permanently deleted', 'success')
      router.push('/dashboard')
    } else {
      const d = await res.json().catch(() => ({}))
      toast(d.error ?? 'Failed to delete trip', 'error')
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
      <div className="space-y-4">

        {/* ── Archived banner ──────────────────────────────────────────── */}
        {isArchived && (
          <div style={{
            background: '#f8f4eb', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: '14px 16px',
          }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>
              This trip is archived
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginBottom: 12 }}>
              All players, groups, rounds and results are preserved. You can restore or permanently delete this trip.
            </p>
            <div className="flex gap-2">
              <button onClick={handleRestore} disabled={restoring} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #2d7a52, #1a4731)', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
                opacity: restoring ? 0.5 : 1,
              }}>
                {restoring ? 'Restoring…' : 'Restore Trip'}
              </button>
              {isOrganiser && (
                <button onClick={() => { setDeleteConfirmText(''); setShowDeleteDialog(true) }} style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1.5px solid #fca5a5', background: '#fff',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#b91c1c',
                  cursor: 'pointer',
                }}>
                  Delete Permanently
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Stat strip ───────────────────────────────────────────────── */}
        <div className="card p-4">
          <div className="flex" style={{ gap: 0 }}>
            <StatCell
              icon="👥"
              value={playerCount}
              sub={expected > 0
                ? (playerCount > expected ? `(${playerCount - expected} over)` : `of ${expected}`)
                : 'players'}
              label="Players"
            />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <StatCell icon="⛳" value={trip.rounds.length} sub="rounds" label="Rounds" />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <StatCell icon="🏌️" value={numGroups} sub="groups" label="Groups" />
          </div>
        </div>

        {/* ── Trip details ─────────────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <p className="s-label">Trip details</p>
          <InfoRow label="Type"   value={eventLabel} />
          <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
          {trip.location    && <InfoRow label="Location"    value={trip.location} />}
          {trip.description && <InfoRow label="About"       value={trip.description} />}
          {ppg > 0          && <InfoRow label="Group size"  value={`${ppg} players per group`} />}
          <InfoRow label="Status" value={TRIP_STATUS_LABELS[trip.status]} />
          {(trip.organiser_is_playing ?? false) && <InfoRow label="Organiser" value="Also playing" />}
        </div>

        {/* ── Stage transitions (non-archived trips) ───────────────────── */}
        {isOrganiser && !isArchived && (
          <div className="card p-4">
            <p className="s-label" style={{ marginBottom: 10 }}>Move trip to next stage</p>
            <div className="space-y-2">
              {/* Forward transitions — primary */}
              {forwardStatuses.map(s => {
                const warnings: string[] = []
                if (s === 'ready' && trip.rounds.length === 0) warnings.push('No rounds configured yet')
                if (s === 'live'  && trip.rounds.length === 0) warnings.push('No rounds to start')
                return (
                  <div key={s}>
                    <button
                      disabled={updateStatus.isPending}
                      onClick={async () => {
                        await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                        toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                        router.refresh()
                      }}
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10,
                        background: '#faf6ed', border: '1.5px solid #d9c9a3',
                        fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13,
                        cursor: 'pointer', opacity: updateStatus.isPending ? 0.5 : 1,
                      }}
                    >
                      <span>{TRIP_STATUS_LABELS[s]}</span>
                      <span style={{ color: '#a89e88' }}>→</span>
                    </button>
                    {warnings.map(w => (
                      <p key={w} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b45309', marginTop: 3, paddingLeft: 4 }}>⚠ {w}</p>
                    ))}
                  </div>
                )
              })}

              {/* Backward transitions — secondary */}
              {backwardStatuses.map(s => (
                <button key={s}
                  disabled={updateStatus.isPending}
                  onClick={async () => {
                    await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                    toast(`Moved back to ${TRIP_STATUS_LABELS[s]}`, 'success')
                    router.refresh()
                  }}
                  style={{
                    width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 16px', borderRadius: 10,
                    background: 'transparent', border: '1.5px solid #e8dcc8',
                    fontFamily: 'var(--font-body)', fontWeight: 500, color: '#7a7260', fontSize: 12,
                    cursor: 'pointer', opacity: updateStatus.isPending ? 0.5 : 1,
                  }}
                >
                  <span>← {TRIP_STATUS_LABELS[s]}</span>
                </button>
              ))}
            </div>

            {/* Archive — always available for non-archived trips */}
            <div style={{ borderTop: '1px solid #ede0c4', marginTop: 12, paddingTop: 12 }}>
              <button
                onClick={() => setShowArchiveDialog(true)}
                style={{
                  width: '100%', padding: '9px 16px', borderRadius: 10,
                  border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#7a7260',
                }}
              >
                Archive Trip
              </button>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginTop: 4, paddingLeft: 2 }}>
                Hides this trip from your active list. All data is preserved.
              </p>
            </div>

            {/* Delete — only from completed or long-lived statuses */}
            {['completed', 'draft'].includes(trip.status) && (
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => { setDeleteConfirmText(''); setShowDeleteDialog(true) }}
                  style={{
                    width: '100%', padding: '9px 16px', borderRadius: 10,
                    border: '1.5px solid #fca5a5', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#b91c1c',
                  }}
                >
                  Delete Trip Permanently
                </button>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginTop: 4, paddingLeft: 2 }}>
                  Permanently removes all trip data. Cannot be undone.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Bottom nav ───────────────────────────────────────────────── */}
        {!isArchived && (
          <WizardNav
            backHref="/dashboard" backLabel="← My Trips"
            onNext={() => onTabChange('players')} nextLabel="Add Players →"
          />
        )}
        {isArchived && (
          <WizardNav backHref="/dashboard" backLabel="← My Trips" />
        )}
      </div>

      {/* ── Archive confirmation dialog ──────────────────────────────── */}
      {showArchiveDialog && (
        <Dialog onClose={() => setShowArchiveDialog(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 6 }}>
            Archive Trip?
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 20 }}>
            This removes the trip from your active list. All players, groups, rounds and results are preserved.
            You can restore it at any time.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowArchiveDialog(false)} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10,
              border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
            }}>Cancel</button>
            <button onClick={handleArchive} disabled={updateStatus.isPending} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
              background: '#1a4731', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
              opacity: updateStatus.isPending ? 0.5 : 1,
            }}>Archive</button>
          </div>
        </Dialog>
      )}

      {/* ── Delete confirmation dialog ───────────────────────────────── */}
      {showDeleteDialog && (
        <Dialog onClose={() => !deleting && setShowDeleteDialog(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 6 }}>
            Delete Trip?
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 4 }}>
            This permanently deletes <strong>{trip.name}</strong> and all associated data including players, groups, rounds and scores.
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#b91c1c', marginBottom: 16 }}>
            This action cannot be undone.
          </p>

          <label style={{
            display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            color: '#b91c1c', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
          }}>
            Type DELETE to confirm
          </label>
          <input
            type="text" value={deleteConfirmText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            autoCapitalize="characters"
            style={{
              width: '100%', borderRadius: 8,
              border: `1.5px solid ${deleteConfirmText === 'DELETE' ? '#86efac' : '#d9c9a3'}`,
              padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-body)',
              color: '#1a1a16', background: '#fff', outline: 'none',
              boxSizing: 'border-box', marginBottom: 14,
            }}
          />

          <div className="flex gap-3">
            <button onClick={() => setShowDeleteDialog(false)} disabled={deleting} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10,
              border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
              opacity: deleting ? 0.4 : 1,
            }}>Cancel</button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                background: deleteConfirmText === 'DELETE' && !deleting ? '#dc2626' : '#fca5a5',
                cursor: deleteConfirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
              }}
            >
              {deleting ? 'Deleting…' : 'Delete Trip'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Dialog({ children, onClose }: React.PropsWithChildren<{ onClose: () => void }>) {
  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
      }} />
      {/* Panel */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 51,
        background: '#faf6ed', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
        maxWidth: 540, margin: '0 auto',
      }}>
        {children}
      </div>
    </>
  )
}

function StatCell({ icon, value, sub, label }: { icon: string; value: number | string; sub: string; label: string }) {
  return (
    <div className="flex-1 text-center py-2 px-3">
      <p style={{ fontSize: 22, marginBottom: 2 }}>{icon}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#1a1a16', lineHeight: 1 }}>{value}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#7a7260', marginTop: 2 }}>{sub || label}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', width: 72, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', flex: 1 }}>{value}</span>
    </div>
  )
}

export function WizardNav({
  backHref, backLabel, onBack, onNext, nextLabel,
}: {
  backHref?: string; backLabel: string
  onBack?: () => void; onNext?: () => void; nextLabel?: string
}) {
  return (
    <div className="flex gap-3 pt-2">
      {backHref ? (
        <Link href={backHref} style={{
          flex: 1, textAlign: 'center', display: 'block',
          padding: '13px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          textDecoration: 'none',
        }}>{backLabel}</Link>
      ) : onBack ? (
        <button onClick={onBack} style={{
          flex: 1, padding: '13px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          cursor: 'pointer',
        }}>{backLabel}</button>
      ) : <div style={{ flex: 1 }} />}

      {nextLabel && onNext && (
        <button onClick={onNext} style={{
          flex: 2, padding: '13px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #2d7a52, #1a4731)', border: 'none',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
          cursor: 'pointer', boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
        }}>{nextLabel}</button>
      )}
    </div>
  )
}
