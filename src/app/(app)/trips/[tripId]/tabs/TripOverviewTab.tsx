'use client'

import { cn, formatTripDateRange } from '@/lib/utils'
import {
  TRIP_STATUS_LABELS, TRIP_STATUS_COLORS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS,
} from '@/types/app'
import type { TripStatus } from '@/types/app'
import type { TripData } from '../TripDetailClient'

interface Props {
  trip:         TripData
  isOrganiser:  boolean
  playerCount:  number
  numGroups:    number
  updateStatus: any
  toast:        (msg: string, type?: 'success' | 'error') => void
  router:       any
}

export default function TripOverviewTab({ trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router }: Props) {
  const inviteUrl  = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${trip.invite_code}`
  const eventLabel = EVENT_TYPE_OPTIONS.find((o) => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]

  const expectedPlayers = expectedPlayers ?? 0
  const registrationPct = expectedPlayers > 0
    ? Math.min(100, Math.round((playerCount / expectedPlayers) * 100))
    : 0

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast('Invite link copied!', 'success')
    } catch {
      toast('Could not copy — try manually', 'error')
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Registration progress ────────────────────────────────────────── */}
      {expectedPlayers > 0 && (
        <div className="rounded-2xl bg-white border border-surface-subtle p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-text">Registration</p>
            <p className="text-sm font-bold text-brand-600">{playerCount} / {expectedPlayers}</p>
          </div>
          <div className="h-2 rounded-full bg-surface-subtle overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${registrationPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-text-muted">
            <span>{playerCount} joined</span>
            <span>{Math.max(0, expectedPlayers - playerCount)} spots remaining</span>
          </div>
        </div>
      )}

      {/* ── At a glance ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Players" value={String(playerCount)} sub={expectedPlayers > 0 ? `of ${expectedPlayers}` : undefined} />
        <StatCard label="Groups" value={numGroups > 0 ? String(numGroups) : '—'} sub={numGroups > 0 ? `${trip.players_per_group ?? 4} per group` : 'not set'} />
        <StatCard label="Rounds" value={String(trip.rounds.length)} />
      </div>

      {/* ── Trip details ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-surface-subtle p-4 space-y-2">
        <p className="text-sm font-semibold text-text mb-3">Trip details</p>
        <InfoRow label="Type"   value={eventLabel} />
        <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
        {trip.location    && <InfoRow label="Location"    value={trip.location} />}
        {trip.description && <InfoRow label="Description" value={trip.description} />}
      </div>

      {/* ── Invite link ───────────────────────────────────────────────────── */}
      {isOrganiser && (
        <div className="rounded-2xl bg-white border border-surface-subtle p-4 space-y-3">
          <p className="text-sm font-semibold text-text">Invite players</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-surface-muted rounded-xl px-3 py-2 font-mono text-xs text-text truncate">
              {inviteUrl}
            </div>
            <button
              onClick={copyInvite}
              className="flex-shrink-0 bg-brand-600 text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-brand-700 transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-text-subtle text-center">
            Code: <span className="font-mono font-bold tracking-widest text-brand-600">{trip.invite_code}</span>
          </p>
        </div>
      )}

      {/* ── Status transitions ────────────────────────────────────────────── */}
      {isOrganiser && nextStatuses.length > 0 && (
        <div className="rounded-2xl bg-white border border-surface-subtle p-4">
          <p className="text-sm font-semibold text-text mb-3">Move trip to next stage</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <button
                key={s}
                disabled={updateStatus.isPending}
                onClick={async () => {
                  await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                  toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                  router.refresh()
                }}
                className={cn(
                  'text-sm font-medium px-4 py-2 rounded-xl border transition-colors',
                  s === 'archived'
                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                    : 'border-brand-200 text-brand-600 hover:bg-brand-50'
                )}
              >
                {TRIP_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-surface-subtle p-3 text-center">
      <p className="text-2xl font-bold text-text">{value}</p>
      <p className="text-xs font-medium text-text-muted mt-0.5">{label}</p>
      {sub && <p className="text-xs text-text-subtle mt-0.5">{sub}</p>}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-text-muted w-24 flex-shrink-0 text-xs">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}
