'use client'

import { cn, formatTripDateRange } from '@/lib/utils'
import {
  TRIP_STATUS_LABELS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS,
} from '@/types/app'
import type { TripData } from '../TripDetailClient'

interface Props {
  trip:         TripData
  isOrganiser:  boolean
  playerCount:  number
  numGroups:    number
  updateStatus: any // eslint-disable-line @typescript-eslint/no-explicit-any
  toast:        (msg: string, type?: 'success' | 'error') => void
  router:       any // eslint-disable-line @typescript-eslint/no-explicit-any
  onTabChange:  (tab: 'players' | 'groups') => void
}

export default function TripOverviewTab({
  trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router, onTabChange,
}: Props) {
  const inviteUrl    = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${trip.invite_code}`
  const eventLabel   = EVENT_TYPE_OPTIONS.find((o) => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]
  const expectedPlayers: number = trip.expected_players ?? 0

  const registrationPct = expectedPlayers > 0
    ? Math.min(100, Math.round((playerCount / expectedPlayers) * 100))
    : 0

  // Derive the single "next action" for the organiser
  const nextAction: { label: string; hint: string; tab?: 'players' | 'groups'; href?: string } | null =
    !isOrganiser ? null :
    trip.status === 'draft' && playerCount === 0
      ? { label: 'Invite your first players', hint: 'Share your invite link to get started', tab: 'players' }
    : trip.status === 'draft' || trip.status === 'open'
      ? playerCount < (expectedPlayers || 1)
        ? { label: `Invite players (${playerCount}${expectedPlayers > 0 ? `/${expectedPlayers}` : ''} joined)`, hint: 'Keep sharing the invite link', tab: 'players' }
        : numGroups > 0
          ? { label: 'Create groups', hint: `Generate ${numGroups} groups and assign players`, tab: 'groups' }
          : null
      : trip.status === 'groups_ready'
        ? { label: 'Review groups and tee times', hint: 'Set tee times, then mark Ready to Start', tab: 'groups' }
      : null

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

      {/* ── Next action prompt ────────────────────────────────────────── */}
      {isOrganiser && nextAction && (
        <button
          onClick={() => nextAction.tab ? onTabChange(nextAction.tab) : undefined}
          className="w-full text-left rounded-2xl bg-brand-600 text-white p-4 space-y-0.5 hover:bg-brand-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">Next step →</p>
            <span className="text-brand-200 text-lg">›</span>
          </div>
          <p className="font-bold text-base">{nextAction.label}</p>
          <p className="text-brand-100 text-xs">{nextAction.hint}</p>
        </button>
      )}

      {/* ── Registration progress ─────────────────────────────────────── */}
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

      {/* ── At a glance ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Players" value={String(playerCount)} sub={expectedPlayers > 0 ? `of ${expectedPlayers}` : undefined} />
        <StatCard label="Groups"  value={numGroups > 0 ? String(numGroups) : '—'} sub={numGroups > 0 ? `${trip.players_per_group ?? 4} per group` : 'not set'} />
        <StatCard label="Rounds"  value={String(trip.rounds.length)} />
      </div>

      {/* ── Invite ────────────────────────────────────────────────────── */}
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

      {/* ── Trip details ──────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-surface-subtle p-4 space-y-2">
        <p className="text-sm font-semibold text-text mb-3">Trip details</p>
        <InfoRow label="Type"   value={eventLabel} />
        <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
        {trip.location    && <InfoRow label="Location"    value={trip.location} />}
        {trip.description && <InfoRow label="Description" value={trip.description} />}
      </div>

      {/* ── Status workflow ───────────────────────────────────────────── */}
      {isOrganiser && nextStatuses.length > 0 && (
        <div className="rounded-2xl bg-white border border-surface-subtle p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Trip status</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.filter(s => s !== 'archived').map((s) => (
              <button
                key={s}
                disabled={updateStatus.isPending}
                onClick={async () => {
                  await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                  toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                  router.refresh()
                }}
                className="flex-1 text-sm font-medium px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
              >
                {TRIP_STATUS_LABELS[s]} →
              </button>
            ))}
          </div>
          {nextStatuses.includes('archived') && (
            <button
              disabled={updateStatus.isPending}
              onClick={async () => {
                if (!confirm('Archive this trip?')) return
                await updateStatus.mutateAsync({ tripId: trip.id, status: 'archived' })
                router.push('/dashboard')
              }}
              className="mt-2 w-full text-xs text-red-400 hover:text-red-600 py-1.5 transition-colors"
            >
              Archive trip
            </button>
          )}
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
