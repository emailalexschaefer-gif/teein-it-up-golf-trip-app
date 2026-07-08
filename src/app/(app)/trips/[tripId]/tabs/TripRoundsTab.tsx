'use client'

import { formatTripDate } from '@/lib/utils'
import type { TripData, RoundRow } from '../TripDetailClient'

interface Props { trip: TripData }

export default function TripRoundsTab({ trip }: Props) {
  const sorted = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-subtle p-8 text-center">
        <p className="text-sm font-medium text-text mb-1">No rounds yet</p>
        <p className="text-xs text-text-muted">Rounds are added during trip creation.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sorted.map((round, i) => <RoundCard key={round.id} round={round} index={i} />)}
    </div>
  )
}

function RoundCard({ round, index }: { round: RoundRow; index: number }) {
  const statusColors: Record<string, string> = {
    upcoming:  'text-text-muted  bg-surface-subtle',
    active:    'text-green-600   bg-green-50',
    completed: 'text-brand-600   bg-brand-50',
  }

  return (
    <div className="rounded-2xl bg-white border border-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-brand-600">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-text truncate">{round.name}</p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[round.status] ?? statusColors.upcoming}`}>
              {round.status.charAt(0).toUpperCase() + round.status.slice(1)}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {round.course_name ? `${round.course_name} · ` : ''}
            {formatTripDate(round.play_date)}
            {round.tee_time ? ` · ${round.tee_time}` : ''}
            {' · '}{round.holes} holes
          </p>
        </div>
      </div>
    </div>
  )
}
