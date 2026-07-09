'use client'

import { cn } from '@/lib/utils'
import type { TripData, RoundRow } from '../TripDetailClient'

interface Props { trip: TripData }

const STATUS_STYLE: Record<string, string> = {
  upcoming:  'bg-cream-200 text-text-muted',
  active:    'bg-green-100 text-green-700',
  completed: 'bg-brand-100 text-brand-700',
}

export default function TripRoundsTab({ trip }: Props) {
  const sorted = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))

  if (sorted.length === 0) return (
    <div className="bg-surface-card rounded-2xl shadow-card border border-surface-subtle p-8 text-center">
      <p className="text-4xl mb-3">📅</p>
      <p className="font-semibold text-text mb-1">No rounds yet</p>
      <p className="text-sm text-text-muted">Rounds are added when creating the trip.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="section-label">Schedule</p>
      {sorted.map((round, i) => <RoundCard key={round.id} round={round} index={i} />)}
    </div>
  )
}

function RoundCard({ round, index }: { round: RoundRow; index: number }) {
  const style = STATUS_STYLE[round.status] ?? STATUS_STYLE.upcoming
  const isLive = round.status === 'active'

  return (
    <div className={cn(
      'bg-surface-card rounded-2xl shadow-card border overflow-hidden',
      isLive ? 'border-green-300 ring-2 ring-green-300' : 'border-surface-subtle'
    )}>
      {isLive && (
        <div className="bg-green-500 px-4 py-1.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-white text-xs font-bold uppercase tracking-wider">Round in progress</span>
        </div>
      )}
      <div className="p-4 flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-950 flex flex-col items-center justify-center flex-shrink-0">
          <span className="text-gold-400 font-black text-lg leading-none">{index + 1}</span>
          <span className="text-white/40 text-[8px] uppercase tracking-wider">Round</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="font-bold text-text">{round.name}</p>
            <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0', style)}>
              {round.status.charAt(0).toUpperCase() + round.status.slice(1)}
            </span>
          </div>
          {round.course_name && <p className="text-sm font-medium text-text-muted">{round.course_name}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-text-subtle">
            <span>📅 {new Date(round.play_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {round.tee_time && <span>⏱ {round.tee_time}</span>}
            <span>⛳ {round.holes} holes</span>
          </div>
        </div>
      </div>
    </div>
  )
}
