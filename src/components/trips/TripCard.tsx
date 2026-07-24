import React from 'react'
import Link from 'next/link'
import { cn, formatTripDateRange, initials } from '@/lib/utils'
import { TRIP_STATUS_LABELS } from '@/types/app'
import type { TripSummary } from '@/types/app'

const STATUS_PILL: Record<string, string> = {
  draft:        'bg-cream-200 text-text-muted border-cream-300',
  open:         'bg-blue-50 text-blue-700 border-blue-200',
  groups_ready: 'bg-violet-50 text-violet-700 border-violet-200',
  ready:        'bg-amber-50 text-amber-700 border-amber-200',
  live:         'bg-green-50 text-green-700 border-green-200',
  completed:    'bg-brand-50 text-brand-700 border-brand-200',
  archived:     'bg-cream-200 text-text-subtle border-cream-300',
}

export default function TripCard({ trip }: { trip: TripSummary }) {
  const isLive   = trip.status === 'live'
  const pill     = STATUS_PILL[trip.status] ?? STATUS_PILL.draft
  const joined   = trip.player_count
  const expected = trip.expected_players
  const over     = expected > 0 && joined > expected
  const isOrg    = trip.user_role === 'organiser'

  return (
    <Link
      href={`/trips/${trip.id}`}
      className={cn(
        'block bg-ivory rounded-card border border-parchment-dark',
        'shadow-card hover:shadow-card-hover hover:-translate-y-0.5',
        'transition-all duration-200 overflow-hidden active:scale-[0.99]',
        isLive && 'ring-2 ring-green-400',
      )}
    >
      {/* Live banner */}
      {isLive && (
        <div className="bg-green px-4 py-1.5 flex items-center gap-2"
          style={{ background: 'linear-gradient(90deg, #1a4731, #2d7a52)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
          <span style={{
            fontFamily: 'var(--font-body)', color: '#e8c96a',
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
          }}>Live now</span>
        </div>
      )}

      <div style={{ padding: '14px 14px 14px' }}>
        <div className="flex items-start gap-3">

          {/* Avatar */}
          <div className="flex-shrink-0">
            {trip.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={trip.logo_url}
                alt={trip.name}
                style={{ width: 52, height: 52, borderRadius: 13, objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: 13,
                background: 'linear-gradient(160deg, #2d7a52 0%, #1a4731 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(15,45,28,0.25)',
                flexShrink: 0,
              }}>
                <span style={{
                  fontFamily: 'var(--font-body)', color: '#e8c96a',
                  fontSize: 15, fontWeight: 900, letterSpacing: -0.5,
                }}>{initials(trip.name)}</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Row 1: Name + status */}
            <div className="flex items-start justify-between gap-2" style={{ marginBottom: 3 }}>
              <h3 style={{
                fontFamily: 'var(--font-display)', fontWeight: 700,
                color: '#1a1a16', fontSize: 17, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {trip.name}
              </h3>
              <span className={cn(
                'flex-shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
                pill,
              )} style={{ fontFamily: 'var(--font-body)', fontSize: 10.5 }}>
                {TRIP_STATUS_LABELS[trip.status]}
              </span>
            </div>

            {/* Row 2: Dates */}
            <p style={{
              fontFamily: 'var(--font-body)', fontSize: 12.5,
              color: '#7a7260', marginBottom: 8, lineHeight: 1.3,
            }}>
              {formatTripDateRange(trip.start_date, trip.end_date)}
              {trip.location
                ? <span style={{ color: '#a89e88' }}> · {trip.location}</span>
                : null}
            </p>

            {/* Row 3: Stats */}
            <div className="flex items-center flex-wrap" style={{ gap: '6px' }}>

              {/* Players */}
              <Stat>
                <span>👥</span>
                <strong>{joined}</strong>
                {expected > 0
                  ? over
                    ? <span style={{ color: '#b45309' }}>+{joined - expected} over</span>
                    : <span>of {expected}</span>
                  : <span>{joined === 1 ? 'player' : 'players'}</span>}
              </Stat>

              {trip.group_count > 0 && (
                <>
                  <Sep />
                  <Stat>
                    <span>🏌️</span>
                    <strong>{trip.group_count}</strong>
                    <span>{trip.group_count === 1 ? 'group' : 'groups'}</span>
                  </Stat>
                </>
              )}

              {trip.round_count > 0 && (
                <>
                  <Sep />
                  <Stat>
                    <span>⛳</span>
                    <strong>{trip.round_count}</strong>
                    <span>{trip.round_count === 1 ? 'round' : 'rounds'}</span>
                  </Stat>
                </>
              )}

              <Sep />
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                color: isOrg ? '#c9a84c' : '#a89e88',
                letterSpacing: 0.2,
              }}>
                {isOrg ? '★ Organiser' : 'Player'}
              </span>
            </div>
          </div>

          {/* Chevron */}
          <span style={{ color: '#c5b99a', fontSize: 18, alignSelf: 'center', flexShrink: 0 }}>›</span>
        </div>
      </div>
    </Link>
  )
}

function Stat({ children }: { children?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1" style={{
      fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260',
    }}>
      {children}
    </span>
  )
}

function Sep() {
  return <span style={{ color: '#d9c9a3', fontSize: 10 }}>·</span>
}
