import { cn, formatTripDateRange, initials } from '@/lib/utils'
import { TRIP_STATUS_LABELS, TRIP_STATUS_COLORS } from '@/types/app'
import type { TripSummary } from '@/types/app'

interface TripCardProps { trip: TripSummary }

export default function TripCard({ trip }: TripCardProps) {
  const isLive = trip.status === 'live'

  return (
    <a
      href={`/trips/${trip.id}`}
      className={cn(
        'block bg-white rounded-2xl shadow-card hover:shadow-card-hover transition-shadow p-4',
        isLive && 'ring-2 ring-status-live ring-offset-1'
      )}
    >
      <div className="flex items-center gap-3">
        {/* Logo / initials */}
        <div className="flex-shrink-0">
          {trip.logo_url ? (
            <img
              src={trip.logo_url}
              alt={trip.name}
              className="w-12 h-12 rounded-xl object-cover bg-surface-subtle"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center">
              <span className="text-brand-600 font-bold text-sm">{initials(trip.name)}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-text truncate">{trip.name}</h3>
            <span className={cn(
              'flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full',
              TRIP_STATUS_COLORS[trip.status]
            )}>
              {TRIP_STATUS_LABELS[trip.status]}
            </span>
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            {formatTripDateRange(trip.start_date, trip.end_date)}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-text-subtle capitalize">
              {trip.user_role === 'organiser' ? '⚙ Organiser' : '⛳ Player'}
            </span>
            {trip.round_count > 0 && (
              <span className="text-xs text-text-subtle">
                {trip.round_count} round{trip.round_count !== 1 ? 's' : ''}
              </span>
            )}
            {trip.player_count > 0 && (
              <span className="text-xs text-text-subtle">
                {trip.player_count} member{trip.player_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-text-subtle text-lg">›</div>
      </div>
    </a>
  )
}
