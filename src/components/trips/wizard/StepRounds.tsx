'use client'

import { Field, Input, Select } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { generateUUID } from '@/lib/utils'
import type { WizardRound, WizardTripDetails } from '@/types/app'

interface StepRoundsProps {
  tripDetails: WizardTripDetails
  rounds: WizardRound[]
  onChange: (rounds: WizardRound[]) => void
  onNext: () => void
  onBack: () => void
}

function emptyRound(tripDetails: WizardTripDetails, index: number): WizardRound {
  return {
    id:             generateUUID(),
    name:           `Round ${index + 1}`,
    course_name:    '',
    play_date:      tripDetails.start_date || '',
    tee_time:       '',
    holes:          18,
    scoring_format: 'stableford',
  }
}

function RoundCard({
  round,
  index,
  total,
  onUpdate,
  onRemove,
}: {
  round: WizardRound
  index: number
  total: number
  onUpdate: (r: WizardRound) => void
  onRemove: () => void
}) {
  function set<K extends keyof WizardRound>(key: K, value: WizardRound[K]) {
    onUpdate({ ...round, [key]: value })
  }

  return (
    <div className="bg-surface-muted rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          Round {index + 1}
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-400 hover:text-red-600 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      <Field label="Round name" required>
        <Input
          value={round.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Day 1 — Royal County Down"
          maxLength={100}
        />
      </Field>

      <Field label="Course">
        <Input
          value={round.course_name}
          onChange={(e) => set('course_name', e.target.value)}
          placeholder="Royal County Down"
          maxLength={100}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required>
          <Input
            type="date"
            value={round.play_date}
            onChange={(e) => set('play_date', e.target.value)}
          />
        </Field>
        <Field label="Tee time">
          <Input
            type="time"
            value={round.tee_time}
            onChange={(e) => set('tee_time', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Holes">
          <Select
            value={round.holes}
            onChange={(e) => set('holes', Number(e.target.value) as 9 | 18)}
          >
            <option value={18}>18 holes</option>
            <option value={9}>9 holes</option>
          </Select>
        </Field>
        <Field label="Format">
          <Select value={round.scoring_format} disabled>
            <option value="stableford">Stableford</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}

export default function StepRounds({
  tripDetails,
  rounds,
  onChange,
  onNext,
  onBack,
}: StepRoundsProps) {
  function addRound() {
    onChange([...rounds, emptyRound(tripDetails, rounds.length)])
  }

  function updateRound(index: number, updated: WizardRound) {
    onChange(rounds.map((r, i) => (i === index ? updated : r)))
  }

  function removeRound(index: number) {
    onChange(rounds.filter((_, i) => i !== index))
  }

  const isValid = rounds.every((r) => r.name.trim() && r.play_date)

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rounds.map((round, index) => (
          <RoundCard
            key={round.id}
            round={round}
            index={index}
            total={rounds.length}
            onUpdate={(r) => updateRound(index, r)}
            onRemove={() => removeRound(index)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addRound}
        className="w-full border-2 border-dashed border-brand-200 rounded-2xl py-3 text-sm font-medium text-brand-600 hover:border-brand-400 hover:bg-brand-50 transition-colors"
      >
        + Add another round
      </button>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onBack} size="lg" className="flex-1">
          ← Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          size="lg"
          className="flex-1"
        >
          Review →
        </Button>
      </div>
    </div>
  )
}
