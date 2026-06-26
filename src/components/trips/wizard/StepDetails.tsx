'use client'

import { Field, Input, Select, Textarea } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { EVENT_TYPE_OPTIONS, type WizardTripDetails } from '@/types/app'

interface StepDetailsProps {
  data: WizardTripDetails
  onChange: (data: WizardTripDetails) => void
  onNext: () => void
}

export default function StepDetails({ data, onChange, onNext }: StepDetailsProps) {
  const errors: Partial<Record<keyof WizardTripDetails, string>> = {}

  function set<K extends keyof WizardTripDetails>(key: K, value: WizardTripDetails[K]) {
    onChange({ ...data, [key]: value })
  }

  function validate(): boolean {
    if (!data.name.trim()) return false
    if (!data.start_date) return false
    if (!data.end_date) return false
    if (data.end_date < data.start_date) return false
    return true
  }

  function handleNext() {
    if (!validate()) return
    onNext()
  }

  return (
    <div className="space-y-4">
      <Field label="Trip name" required>
        <Input
          value={data.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="The Lads' Annual Masters"
          maxLength={100}
          error={!data.name.trim() && data.name !== ''}
        />
      </Field>

      <Field label="Event type" required>
        <Select
          value={data.event_type}
          onChange={(e) => set('event_type', e.target.value as WizardTripDetails['event_type'])}
        >
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Location" hint="City, country or venue">
        <Input
          value={data.location}
          onChange={(e) => set('location', e.target.value)}
          placeholder="Portmarnock, Ireland"
          maxLength={200}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" required>
          <Input
            type="date"
            value={data.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            error={!!data.start_date && !!data.end_date && data.end_date < data.start_date}
          />
        </Field>
        <Field label="End date" required>
          <Input
            type="date"
            value={data.end_date}
            min={data.start_date || undefined}
            onChange={(e) => set('end_date', e.target.value)}
            error={!!data.start_date && !!data.end_date && data.end_date < data.start_date}
          />
        </Field>
      </div>
      {data.start_date && data.end_date && data.end_date < data.start_date && (
        <p className="text-xs text-red-500 -mt-2">End date must be after start date</p>
      )}

      <Field label="Description" hint="Optional — shown to all players">
        <Textarea
          value={data.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Annual trip to the west coast. 3 rounds, 2 nights."
          rows={3}
          maxLength={500}
        />
      </Field>

      <Button
        onClick={handleNext}
        disabled={!validate()}
        fullWidth
        size="lg"
      >
        Next — Add rounds →
      </Button>
    </div>
  )
}
