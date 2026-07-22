'use client'

import React from 'react'
import { Field, Input, Select } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { generateUUID } from '@/lib/utils'
import type { WizardRound, WizardTripDetails } from '@/types/app'

interface Props {
  tripDetails: WizardTripDetails
  rounds: WizardRound[]
  onChange: (rounds: WizardRound[]) => void
  onNext: () => void
  onBack: () => void
}

function newRound(tripDetails: WizardTripDetails, n: number): WizardRound {
  return {
    id: generateUUID(), name: `Round ${n}`, course_name: '',
    play_date: tripDetails.start_date || '', tee_time: '',
    holes: 18, scoring_format: 'stableford',
  }
}

function RoundCard({ round, index, total, onUpdate, onRemove }: {
  round: WizardRound; index: number; total: number; key?: string
  onUpdate: (r: WizardRound) => void; onRemove: () => void
}) {
  function set<K extends keyof WizardRound>(k: K, v: WizardRound[K]) {
    onUpdate({ ...round, [k]: v })
  }
  return (
    <div className="bg-surface-muted rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">Round {index + 1}</span>
        {total > 1 && (
          <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 transition-colors">
            Remove
          </button>
        )}
      </div>
      <Field label="Round name" required>
        <Input value={round.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)} placeholder="Day 1 — Royal County Down" maxLength={100} />
      </Field>
      <Field label="Course">
        <Input value={round.course_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('course_name', e.target.value)} placeholder="Royal County Down" maxLength={100} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required>
          <Input type="date" value={round.play_date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('play_date', e.target.value)} />
        </Field>
        <Field label="Tee time">
          <Input type="time" value={round.tee_time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('tee_time', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Holes">
          <Select value={round.holes} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('holes', Number(e.target.value) as 9 | 18)}>
            <option value={18}>18 holes</option>
            <option value={9}>9 holes</option>
          </Select>
        </Field>
        <Field label="Format">
          <Select value="stableford" disabled>
            <option value="stableford">Stableford</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}

export default function StepRounds({ tripDetails, rounds, onChange, onNext, onBack }: Props) {
  const valid = rounds.every((r) => r.name.trim() && r.play_date)

  // Warn when a round date falls outside the trip date range
  const dateWarnings = rounds.filter(r => {
    if (!r.play_date || !tripDetails.start_date || !tripDetails.end_date) return false
    return r.play_date < tripDetails.start_date || r.play_date > tripDetails.end_date
  })

  return (
    <div className="space-y-4">
      {dateWarnings.length > 0 && (
        <div style={{
          background: '#fef9ec', border: '1px solid #f5c842',
          borderRadius: 10, padding: '10px 14px',
          fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a5c00',
        }}>
          ⚠ {dateWarnings.length === 1 ? 'A round date' : `${dateWarnings.length} round dates`} fall outside the trip dates ({tripDetails.start_date} – {tripDetails.end_date}). You can continue, but check the dates are correct.
        </div>
      )}
      <div className="space-y-3">
        {rounds.map((r, i) => (
          <RoundCard
            key={r.id} round={r} index={i} total={rounds.length}
            onUpdate={(updated) => onChange(rounds.map((x, j) => j === i ? updated : x))}
            onRemove={() => onChange(rounds.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...rounds, newRound(tripDetails, rounds.length + 1)])}
        className="w-full border-2 border-dashed border-brand-200 rounded-2xl py-3 text-sm font-medium text-brand-600 hover:border-brand-400 hover:bg-brand-50 transition-colors"
      >
        + Add another round
      </button>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onBack} size="lg" className="flex-1">← Back</Button>
        <Button onClick={onNext} disabled={!valid} size="lg" className="flex-1">Review →</Button>
      </div>
    </div>
  )
}
