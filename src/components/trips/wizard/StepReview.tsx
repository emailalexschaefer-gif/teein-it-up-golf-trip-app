'use client'

import Button from '@/components/ui/Button'
import { formatTripDateRange, formatTripDate } from '@/lib/utils'
import { EVENT_TYPE_OPTIONS } from '@/types/app'
import type { WizardTripDetails, WizardRound } from '@/types/app'

interface StepReviewProps {
  tripDetails: WizardTripDetails
  rounds: WizardRound[]
  onBack: () => void
  onCreate: () => void
  loading: boolean
  error: string | null
}

export default function StepReview({
  tripDetails,
  rounds,
  onBack,
  onCreate,
  loading,
  error,
}: StepReviewProps) {
  const eventLabel =
    EVENT_TYPE_OPTIONS.find((o) => o.value === tripDetails.event_type)?.label ?? 'Golf Trip'

  return (
    <div className="space-y-4">
      {/* Trip summary */}
      <div className="bg-surface-muted rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
          Trip details
        </p>
        <ReviewRow label="Name"       value={tripDetails.name} />
        <ReviewRow label="Type"       value={eventLabel} />
        {tripDetails.location && (
          <ReviewRow label="Location" value={tripDetails.location} />
        )}
        <ReviewRow
          label="Dates"
          value={formatTripDateRange(tripDetails.start_date, tripDetails.end_date)}
        />
        {tripDetails.description && (
          <ReviewRow label="Description" value={tripDetails.description} />
        )}
      </div>

      {/* Rounds summary */}
      <div className="bg-surface-muted rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
          {rounds.length} round{rounds.length !== 1 ? 's' : ''}
        </p>
        {rounds.map((round, i) => (
          <div key={round.id} className="bg-white rounded-xl p-3">
            <p className="font-medium text-sm text-text">{round.name}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {round.course_name ? `${round.course_name} · ` : ''}
              {formatTripDate(round.play_date)}
              {round.tee_time ? ` · ${round.tee_time}` : ''}
              {' · '}{round.holes} holes · Stableford
            </p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onBack} size="lg" className="flex-1" disabled={loading}>
          ← Back
        </Button>
        <Button onClick={onCreate} loading={loading} size="lg" className="flex-1">
          Create trip ⛳
        </Button>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-text-muted w-24 flex-shrink-0">{label}</span>
      <span className="text-text font-medium">{value}</span>
    </div>
  )
}
