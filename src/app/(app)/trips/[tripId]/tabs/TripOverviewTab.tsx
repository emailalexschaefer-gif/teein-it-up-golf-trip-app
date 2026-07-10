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

// Derive the setup checklist from real trip data
function useSetupChecklist(trip: TripData, playerCount: number) {
  const hasDetails   = !!(trip.name && trip.start_date && trip.end_date)
  const hasPlayers   = playerCount > 0
  const hasGroups    = ['groups_ready','ready','live','completed'].includes(trip.status)
  const hasRounds    = trip.rounds.length > 0
  const isOpen       = ['open','groups_ready','ready','live','completed'].includes(trip.status)
  const isReady      = ['ready','live','completed'].includes(trip.status)
  const isLive       = ['live','completed'].includes(trip.status)

  return [
    { label: 'Trip details complete',  done: hasDetails },
    { label: 'Invitations open',       done: isOpen },
    { label: 'Players joined',         done: hasPlayers },
    { label: 'Groups created',         done: hasGroups },
    { label: 'Rounds configured',      done: hasRounds },
    { label: 'Ready to start',         done: isReady },
    { label: 'Round live',             done: isLive },
  ]
}

export default function TripOverviewTab({ trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router, onTabChange }: Props) {
  const eventLabel   = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]
  const expected: number = trip.expected_players ?? 0
  const ppg: number      = trip.players_per_group ?? 4
  const registrationPct  = expected > 0 ? Math.min(100, Math.round((playerCount / expected) * 100)) : 0
  const checklist        = useSetupChecklist(trip, playerCount)
  const doneCount        = checklist.filter(c => c.done).length

  // Smart next action for organiser
  const nextAction = !isOrganiser ? null
    : trip.status === 'draft'
      ? { label: 'Open for Invitations →', hint: 'Share your invite link so players can join', action: () => updateStatus.mutateAsync({ tripId: trip.id, status: 'open' }).then(() => router.refresh()) }
    : trip.status === 'open' && playerCount === 0
      ? { label: 'Invite Players →', hint: 'No players have joined yet', action: () => onTabChange('players') }
    : trip.status === 'open' && playerCount > 0
      ? { label: 'Create Groups →', hint: `${playerCount} player${playerCount !== 1 ? 's' : ''} ready to assign`, action: () => onTabChange('groups') }
    : trip.status === 'groups_ready'
      ? { label: 'Review Groups →', hint: 'Confirm tee times then mark Ready', action: () => onTabChange('groups') }
    : null

  return (
    <div className="space-y-4">

      {/* ── Primary next action ──────────────────────────────────────── */}
      {isOrganiser && nextAction && (
        <button
          onClick={nextAction.action}
          disabled={updateStatus.isPending}
          style={{
            width: '100%', textAlign: 'left',
            background: 'linear-gradient(135deg, #1a4731 0%, #236040 100%)',
            borderRadius: 14, padding: '16px 18px',
            border: '1.5px solid rgba(201,168,76,0.35)',
            boxShadow: '0 4px 18px rgba(26,71,49,0.35)',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.55)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            Next step
          </p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 19, fontWeight: 700, marginBottom: 2 }}>
            {nextAction.label}
          </p>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)', fontSize: 12 }}>
            {nextAction.hint}
          </p>
        </button>
      )}

      {/* ── Setup checklist ───────────────────────────────────────────── */}
      {isOrganiser && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="s-label">Setup progress</p>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#1a4731' }}>
              {doneCount}/{checklist.length}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 3, background: '#e8dcc8', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, #c9a84c, #e8c96a)',
              width: `${(doneCount / checklist.length) * 100}%`,
              transition: 'width 0.5s',
            }} />
          </div>
          <div className="space-y-1.5">
            {checklist.map(item => (
              <div key={item.label} className="flex items-center gap-2.5">
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  background: item.done ? '#1a4731' : 'transparent',
                  border: item.done ? 'none' : '1.5px solid #d9c9a3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.done && <span style={{ color: '#e8c96a', fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  color: item.done ? '#1a1a16' : '#a89e88',
                  textDecoration: item.done ? 'none' : 'none',
                }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stat strip ───────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex divide-x" style={{ borderColor: '#ede0c4' }}>
          <StatCell icon="👥" value={playerCount} sub={expected > 0 ? `/ ${expected} players` : 'players'} />
          <StatCell icon="⛳" value={trip.rounds.length} sub="rounds" />
          <StatCell icon="🏌️" value={numGroups || '—'} sub="groups" />
        </div>
        {expected > 0 && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #ede0c4' }}>
            <div className="flex justify-between items-center mb-1.5">
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.8 }}>Registration</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#1a4731' }}>{registrationPct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#e8dcc8', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #1a4731, #2d7a52)', width: `${registrationPct}%`, transition: 'width 0.7s' }} />
            </div>
            <div className="flex justify-between mt-1.5" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88' }}>
              <span>{playerCount} joined</span>
              <span>{Math.max(0, expected - playerCount)} remaining</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Trip details ─────────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <p className="s-label">Trip details</p>
        <InfoRow label="Type"   value={eventLabel} />
        <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
        {trip.location    && <InfoRow label="Location"    value={trip.location} />}
        {trip.description && <InfoRow label="Description" value={trip.description} />}
        {ppg > 0          && <InfoRow label="Group size"  value={`${ppg} players per group`} />}
        {(trip.organiser_is_playing ?? false) && <InfoRow label="Organiser" value="Also playing" />}
      </div>

      {/* ── Status transitions ───────────────────────────────────────── */}
      {isOrganiser && nextStatuses.filter(s => s !== 'archived').length > 0 && (
        <div className="card p-4">
          <p className="s-label" style={{ marginBottom: 10 }}>Stage</p>
          <div className="space-y-2">
            {nextStatuses.filter(s => s !== 'archived').map(s => {
              // Validate before allowing progression
              const warnings: string[] = []
              if (s === 'groups_ready' && trip.rounds.length === 0) warnings.push('No rounds configured yet')
              if (s === 'ready' && trip.rounds.length === 0) warnings.push('Configure at least one round first')
              if (s === 'live' && trip.rounds.length === 0) warnings.push('No rounds to start')

              return (
                <div key={s}>
                  <button
                    disabled={updateStatus.isPending}
                    onClick={async () => {
                      await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                      toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                      router.refresh()
                    }}
                    className="w-full text-left flex items-center justify-between py-3 px-4 rounded-xl transition-colors disabled:opacity-50"
                    style={{
                      background: '#faf6ed', border: '1.5px solid #d9c9a3',
                      fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13,
                    }}
                  >
                    <span>{TRIP_STATUS_LABELS[s]}</span>
                    <span style={{ color: '#a89e88' }}>→</span>
                  </button>
                  {warnings.map(w => (
                    <p key={w} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b45309', marginTop: 3, paddingLeft: 4 }}>
                      ⚠ {w}
                    </p>
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
              className="mt-3 w-full text-xs py-2 transition-colors"
              style={{ color: '#ef4444', fontFamily: 'var(--font-body)' }}
            >
              Archive trip
            </button>
          )}
        </div>
      )}

      {/* ── Back/Next navigation ─────────────────────────────────────── */}
      <NavBar onBack="/dashboard" backLabel="← My Trips" onNext={() => onTabChange('players')} nextLabel="Players →" />
    </div>
  )
}

function StatCell({ icon, value, sub }: { icon: string; value: number | string; sub: string }) {
  return (
    <div className="flex-1 text-center px-3 first:pl-0 last:pr-0">
      <p className="text-2xl mb-0.5">{icon}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#1a1a16' }}>{value}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>{sub}</p>
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

function NavBar({ onBack, backLabel, onNext, nextLabel }: {
  onBack?: string; backLabel: string
  onNext?: () => void; nextLabel: string
}) {
  return (
    <div className="flex gap-3 pt-2">
      {onBack ? (
        <a href={onBack} style={{
          flex: 1, textAlign: 'center',
          padding: '12px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          textDecoration: 'none', display: 'block',
        }}>{backLabel}</a>
      ) : (
        <div style={{ flex: 1 }} />
      )}
      {onNext && (
        <button onClick={onNext} style={{
          flex: 2,
          padding: '12px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #2d7a52, #1a4731)',
          border: 'none',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
          cursor: 'pointer',
          boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
        }}>{nextLabel}</button>
      )}
    </div>
  )
}
