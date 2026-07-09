'use client'

import { cn, formatTripDateRange } from '@/lib/utils'
import { TRIP_STATUS_LABELS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS } from '@/types/app'
import type { TripData } from '../TripDetailClient'

interface Props {
  trip: TripData; isOrganiser: boolean; playerCount: number; numGroups: number
  updateStatus: any; toast: any; router: any // eslint-disable-line @typescript-eslint/no-explicit-any
  onTabChange: (tab: 'players' | 'groups') => void
}

export default function TripOverviewTab({ trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router, onTabChange }: Props) {
  const eventLabel      = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses    = TRIP_STATUS_TRANSITIONS[trip.status]
  const expectedPlayers: number = trip.expected_players ?? 0
  const ppg: number     = trip.players_per_group ?? 4
  const registrationPct = expectedPlayers > 0 ? Math.min(100, Math.round((playerCount / expectedPlayers) * 100)) : 0

  // Single clearest next action
  const nextAction = !isOrganiser ? null :
    trip.status === 'draft' || trip.status === 'open'
      ? playerCount < (expectedPlayers || 1)
        ? { label: 'Invite Players →', hint: `${playerCount} of ${expectedPlayers || '?'} joined`, tab: 'players' as const }
        : numGroups > 0
          ? { label: 'Create Groups →', hint: `Generate ${numGroups} groups`, tab: 'groups' as const }
          : null
    : trip.status === 'groups_ready'
      ? { label: 'Review Groups →', hint: 'Set tee times, then mark Ready', tab: 'groups' as const }
    : null

  return (
    <div className="space-y-4">

      {/* ── Primary action card — always at top ───────────────────────── */}
      {isOrganiser && nextAction && (
        <button
          onClick={() => onTabChange(nextAction.tab)}
          className="w-full text-left bg-brand-600 rounded-2xl p-5 shadow-card hover:bg-brand-700 transition-colors"
        >
          <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1">Next step</p>
          <p className="text-white font-black text-xl">{nextAction.label}</p>
          <p className="text-white/70 text-sm mt-0.5">{nextAction.hint}</p>
        </button>
      )}

      {/* ── Demo stat strip ──────────────────────────────────────────── */}
      <div className="bg-surface-card rounded-2xl shadow-card border border-surface-subtle p-4">
        <div className="flex divide-x divide-surface-subtle">
          <StatCell icon="👥" value={playerCount} sub={expectedPlayers > 0 ? `/ ${expectedPlayers} players` : 'players'} />
          <StatCell icon="⛳" value={trip.rounds.length} sub="rounds" />
          <StatCell icon="🎯" value={numGroups || '—'} sub="groups" />
        </div>

        {/* Registration progress */}
        {expectedPlayers > 0 && (
          <div className="mt-4 pt-4 border-t border-surface-subtle">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Registration</span>
              <span className="text-xs font-bold text-brand-600">{registrationPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-subtle overflow-hidden">
              <div className="h-full rounded-full bg-brand-600 transition-all duration-700" style={{ width: `${registrationPct}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 text-xs text-text-subtle">
              <span>{playerCount} joined</span>
              <span>{Math.max(0, expectedPlayers - playerCount)} remaining</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Trip details ─────────────────────────────────────────────── */}
      <div className="bg-surface-card rounded-2xl shadow-card border border-surface-subtle p-4 space-y-3">
        <p className="section-label">Trip details</p>
        <InfoRow label="Type"   value={eventLabel} />
        <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
        {trip.location    && <InfoRow label="Location"    value={trip.location} />}
        {trip.description && <InfoRow label="Description" value={trip.description} />}
        {ppg > 0          && <InfoRow label="Group size"  value={`${ppg} players per group`} />}
      </div>

      {/* ── Status workflow ─────────────────────────────────────────── */}
      {isOrganiser && nextStatuses.filter(s => s !== 'archived').length > 0 && (
        <div className="bg-surface-card rounded-2xl shadow-card border border-surface-subtle p-4">
          <p className="section-label mb-3">Move to next stage</p>
          <div className="space-y-2">
            {nextStatuses.filter(s => s !== 'archived').map(s => (
              <button
                key={s}
                disabled={updateStatus.isPending}
                onClick={async () => {
                  await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                  toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                  router.refresh()
                }}
                className="w-full text-left bg-surface-muted hover:bg-cream-200 border border-surface-subtle text-text font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-between"
              >
                <span>{TRIP_STATUS_LABELS[s]}</span>
                <span className="text-text-subtle">→</span>
              </button>
            ))}
          </div>
          {nextStatuses.includes('archived') && (
            <button
              onClick={async () => {
                if (!confirm('Archive this trip?')) return
                await updateStatus.mutateAsync({ tripId: trip.id, status: 'archived' })
                router.push('/dashboard')
              }}
              className="mt-3 w-full text-xs text-red-400 hover:text-red-600 py-2 transition-colors"
            >
              Archive trip
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatCell({ icon, value, sub }: { icon: string; value: number | string; sub: string }) {
  return (
    <div className="flex-1 text-center px-3 first:pl-0 last:pr-0">
      <p className="text-2xl mb-0.5">{icon}</p>
      <p className="text-2xl font-black text-text">{value}</p>
      <p className="text-xs text-text-muted">{sub}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-text-subtle text-xs w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-text text-sm flex-1">{value}</span>
    </div>
  )
}
