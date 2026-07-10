'use client'

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
  const eventLabel   = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]
  const expected     = trip.expected_players ?? 0
  const ppg          = trip.players_per_group ?? 4

  // Determine next CTA label for Rounds tab
  const roundsNextLabel =
    trip.status === 'live'        ? 'Start Round →'
    : trip.status === 'ready'     ? 'Start Round →'
    : trip.status === 'groups_ready' ? 'Ready to Start →'
    : 'Ready to Start →'

  return (
    <div className="space-y-4">

      {/* ── Stat strip ───────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex" style={{ gap: 0 }}>
          <StatCell icon="👥" value={playerCount} sub={expected > 0 ? `/ ${expected}` : 'players'} label="Players" />
          <div style={{ width: 1, background: '#ede0c4' }} />
          <StatCell icon="⛳" value={trip.rounds.length} sub="rounds" label="Rounds" />
          <div style={{ width: 1, background: '#ede0c4' }} />
          <StatCell icon="🏌️" value={numGroups > 0 ? numGroups : '—'} sub="groups" label="Groups" />
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

      {/* ── Stage transitions ────────────────────────────────────────── */}
      {isOrganiser && nextStatuses.filter(s => s !== 'archived').length > 0 && (
        <div className="card p-4">
          <p className="s-label" style={{ marginBottom: 10 }}>Move trip to next stage</p>
          <div className="space-y-2">
            {nextStatuses.filter(s => s !== 'archived').map(s => {
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
                    className="w-full text-left flex items-center justify-between py-3 px-4 rounded-xl disabled:opacity-50"
                    style={{
                      background: '#faf6ed', border: '1.5px solid #d9c9a3',
                      fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13,
                      cursor: 'pointer',
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
          </div>
          {nextStatuses.includes('archived') && (
            <button
              onClick={async () => {
                if (!confirm('Archive this trip?')) return
                await updateStatus.mutateAsync({ tripId: trip.id, status: 'archived' })
                router.push('/dashboard')
              }}
              className="mt-3 w-full text-xs py-2"
              style={{ color: '#ef4444', fontFamily: 'var(--font-body)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Archive trip
            </button>
          )}
        </div>
      )}

      {/* ── Bottom nav ───────────────────────────────────────────────── */}
      <WizardNav
        backHref="/dashboard" backLabel="← My Trips"
        onNext={() => onTabChange('players')} nextLabel="Add Players →"
      />
    </div>
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
  backHref, backLabel,
  onBack, onNext, nextLabel,
}: {
  backHref?: string; backLabel: string
  onBack?: () => void; onNext?: () => void; nextLabel?: string
}) {
  return (
    <div className="flex gap-3 pt-2">
      {backHref ? (
        <a href={backHref} style={{
          flex: 1, textAlign: 'center', display: 'block',
          padding: '13px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          textDecoration: 'none',
        }}>{backLabel}</a>
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
          background: 'linear-gradient(135deg, #2d7a52, #1a4731)',
          border: 'none',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
          cursor: 'pointer', boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
        }}>{nextLabel}</button>
      )}
    </div>
  )
}
