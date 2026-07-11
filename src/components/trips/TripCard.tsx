import { cn, formatTripDateRange, initials, avatarColor } from '@/lib/utils'
import { TRIP_STATUS_LABELS } from '@/types/app'
import type { TripSummary } from '@/types/app'

// Status pill colours — demo uses warm/muted palette
const STATUS_PILL: Record<string, string> = {
  draft:        'bg-cream-200 text-text-muted border-cream-300',
  open:         'bg-blue-50   text-blue-700  border-blue-200',
  groups_ready: 'bg-violet-50 text-violet-700 border-violet-200',
  ready:        'bg-amber-50  text-amber-700 border-amber-200',
  live:         'bg-green-50  text-green-700 border-green-200',
  completed:    'bg-brand-50  text-brand-700 border-brand-200',
  archived:     'bg-cream-200 text-text-subtle border-cream-300',
}

export default function TripCard({ trip }: { trip: TripSummary; key?: string }) {
  const isLive   = trip.status === 'live'
  const pill     = STATUS_PILL[trip.status] ?? STATUS_PILL.draft

  return (
    <a
      href={`/trips/${trip.id}`}
      className={cn(
        'block bg-ivory rounded-2xl shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden',
        isLive && 'ring-2 ring-green-400'
      )}
    >
      {/* Live indicator stripe */}
      {isLive && (
        <div className="bg-green-bright px-4 py-1.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-white text-xs font-bold uppercase tracking-wider">Live now</span>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Trip logo / initials */}
          <div className="flex-shrink-0">
            {trip.logo_url ? (
              <img src={trip.logo_url} alt={trip.name} className="w-14 h-14 rounded-2xl object-cover shadow-card" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center shadow-card">
                <span className="text-white font-black text-base">{initials(trip.name)}</span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name + status */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-bold text-text text-lg leading-tight truncate">{trip.name}</h3>
              <span className={cn('flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border', pill)}>
                {TRIP_STATUS_LABELS[trip.status]}
              </span>
            </div>

            {/* Dates + location */}
            <p className="text-sm text-text-muted">
              {formatTripDateRange(trip.start_date, trip.end_date)}
              {trip.location ? <span className="text-text-subtle"> · {trip.location}</span> : null}
            </p>

            {/* Stats row */}
            <div className="flex items-center gap-3 mt-2.5">
              <Stat icon="👤" value={trip.player_count} label={`/ ${trip.expected_players || '?'}`} />
              <span className="text-cream-400">·</span>
              <Stat icon="⛳" value={trip.round_count} label={trip.round_count === 1 ? 'round' : 'rounds'} />
              <span className="text-cream-400">·</span>
              <span className={cn(
                'text-xs font-medium capitalize',
                trip.user_role === 'organiser' ? 'text-gold-600' : 'text-text-subtle'
              )}>
                {trip.user_role === 'organiser' ? '★ Organiser' : 'Player'}
              </span>
            </div>
          </div>

          <span className="text-text-subtle text-xl self-center flex-shrink-0">›</span>
        </div>
      </div>
    </a>
  )
}

function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-text-muted">
      <span>{icon}</span>
      <span className="font-semibold text-text">{value}</span>
      <span>{label}</span>
    </span>
  )
}
