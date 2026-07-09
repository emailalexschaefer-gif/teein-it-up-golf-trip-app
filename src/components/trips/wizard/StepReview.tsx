'use client'

import Button from '@/components/ui/Button'
import { formatTripDateRange, formatTripDate } from '@/lib/utils'
import { EVENT_TYPE_OPTIONS } from '@/types/app'
import type { WizardTripDetails, WizardRound } from '@/types/app'

interface Props {
  tripDetails: WizardTripDetails
  rounds: WizardRound[]
  onBack: () => void
  onCreate: () => void
  loading: boolean
  isEditing?: boolean
  error: string | null
}

export default function StepReview({ tripDetails, rounds, onBack, onCreate, loading, error, isEditing }: Props) {
  const eventLabel = EVENT_TYPE_OPTIONS.find((o) => o.value === tripDetails.event_type)?.label ?? 'Golf Trip'

  return (
    <div className="space-y-4">
      <div className="bg-surface-muted rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Trip details</p>
        <Row label="Name"     value={tripDetails.name} />
        <Row label="Type"     value={eventLabel} />
        {tripDetails.location && <Row label="Location" value={tripDetails.location} />}
        <Row label="Dates"    value={formatTripDateRange(tripDetails.start_date, tripDetails.end_date)} />
        {tripDetails.description && <Row label="About"  value={tripDetails.description} />}
      </div>

      <div className="bg-surface-muted rounded-2xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
          {rounds.length} round{rounds.length !== 1 ? 's' : ''}
        </p>
        <div className="space-y-2">
          {rounds.map((r) => (
            <div key={r.id} className="bg-white rounded-xl p-3">
              <p className="font-medium text-sm text-text">{r.name}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {r.course_name ? `${r.course_name} · ` : ''}
                {formatTripDate(r.play_date)}
                {r.tee_time ? ` · ${r.tee_time}` : ''}
                {' · '}{r.holes} holes · Stableford
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">{error}</div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onBack} size="lg" className="flex-1" disabled={loading}>← Back</Button>
        <Button onClick={onCreate} loading={loading} size="lg" className="flex-1">{isEditing ? 'Save changes ✓' : 'Create trip ⛳'}</Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}
