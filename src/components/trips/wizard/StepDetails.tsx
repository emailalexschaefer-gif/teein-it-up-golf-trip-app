'use client'

import React from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { EVENT_TYPE_OPTIONS, groupsRequired, type WizardTripDetails } from '@/types/app'

interface Props {
  data: WizardTripDetails
  onChange: (data: WizardTripDetails) => void
  onNext: () => void
}

export default function StepDetails({ data, onChange, onNext }: Props) {
  function set<K extends keyof WizardTripDetails>(k: K, v: WizardTripDetails[K]) {
    onChange({ ...data, [k]: v })
  }

  const dateError = data.start_date && data.end_date && data.end_date < data.start_date
  const valid = !!data.name.trim() && !!data.start_date && !!data.end_date && !dateError
  const numGroups = groupsRequired(data.expected_players, data.players_per_group)

  return (
    <div className="space-y-4">
      <Field label="Trip name" required>
        <Input
          value={data.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)}
          placeholder="The Lads' Annual Masters"
          maxLength={100}
        />
      </Field>

      <Field label="Event type" required>
        <Select
          value={data.event_type}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('event_type', e.target.value as WizardTripDetails['event_type'])}
        >
          {EVENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Location" hint="City, country or venue">
        <Input
          value={data.location}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('location', e.target.value)}
          placeholder="Portmarnock, Ireland"
          maxLength={200}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" required>
          <Input
            type="date"
            value={data.start_date}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('start_date', e.target.value)}
            error={!!dateError}
          />
        </Field>
        <Field label="End date" required>
          <Input
            type="date"
            value={data.end_date}
            min={data.start_date || undefined}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('end_date', e.target.value)}
            error={!!dateError}
          />
        </Field>
      </div>
      {dateError && <p className="text-xs text-red-500 -mt-2">End date must be after start date</p>}

      {/* Player capacity */}
      <div className="rounded-2xl border border-surface-subtle bg-surface-subtle/40 p-4 space-y-3">
        <p className="text-sm font-semibold text-text">Player capacity</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected players">
            <Input
              type="number" min={1} max={200} step={1}
              value={data.expected_players || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('expected_players', parseInt(e.target.value) || 0)}
              placeholder="24"
            />
          </Field>
          <Field label="Players per group">
            <Select
              value={String(data.players_per_group)}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('players_per_group', parseInt(e.target.value))}
            >
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </Select>
          </Field>
        </div>
        {numGroups > 0 && (
          <div className="flex items-center gap-3 pt-1">
            <div className="text-center">
              <p className="text-2xl font-bold text-brand-600">{numGroups}</p>
              <p className="text-xs text-text-muted">Groups</p>
            </div>
            <div className="flex-1 text-xs text-text-muted">
              {data.expected_players} players ÷ {data.players_per_group} per group
              {' = '}{numGroups} group{numGroups !== 1 ? 's' : ''} required
            </div>
          </div>
        )}
      </div>

      {/* Organiser playing? */}
      <div className="rounded-2xl border border-surface-subtle bg-surface-subtle/40 p-4 space-y-2">
        <p className="text-sm font-semibold text-text">Will you also be playing?</p>
        <p className="text-xs text-text-muted">Many organisers manage the event without playing themselves.</p>
        <div className="flex gap-3 pt-1">
          {([
            { value: true,  label: "Yes, I'm playing" },
            { value: false, label: 'No, organising only' },
          ] as const).map(({ value, label }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => set('organiser_is_playing', value)}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors',
                data.organiser_is_playing === value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-text border-surface-subtle hover:border-brand-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Description" hint="Optional — shown to all players">
        <Textarea
          value={data.description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('description', e.target.value)}
          placeholder="Annual west coast trip. 3 rounds, great craic."
          rows={3}
          maxLength={500}
        />
      </Field>

      <Button onClick={onNext} disabled={!valid} fullWidth size="lg">
        Next — Add rounds →
      </Button>
    </div>
  )
}
