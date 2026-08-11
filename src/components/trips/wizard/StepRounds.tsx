'use client'

import React from 'react'
import { Field, Input, Select } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { generateUUID } from '@/lib/utils'
import type { WizardRound, WizardTripDetails, WizardSideComp } from '@/types/app'

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
    side_comps: [], powerplay_enabled: false, powerplay_hole_number: null,
  }
}

const SIDE_COMP_META: Record<WizardSideComp['comp_type'], { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
}

function getComp(round: WizardRound, type: WizardSideComp['comp_type']): WizardSideComp {
  return round.side_comps?.find(c => c.comp_type === type) ?? { comp_type: type, enabled: false, hole_number: null }
}

function setComp(round: WizardRound, type: WizardSideComp['comp_type'], patch: Partial<WizardSideComp>): WizardRound {
  const existing = getComp(round, type)
  const updated = { ...existing, ...patch }
  const others = (round.side_comps ?? []).filter(c => c.comp_type !== type)
  return { ...round, side_comps: [...others, updated] }
}

/**
 * A round's Side Competitions + Powerplay config. Only rendered for
 * rounds that are still editable — a round already 'active'/'completed'
 * (only possible when editing an existing trip; a brand-new round in the
 * wizard is always pre-start) never reaches this component with edit
 * controls: RoundCard checks `locked` and falls back to a compact,
 * read-only summary instead. This is the UI-level mirror of the DB
 * trigger (migration 037) that would reject the write anyway — matching
 * "enforce upcoming-round-only editing in UI as well as DB", not relying
 * on the DB rejection alone to communicate this to the organiser.
 */
function SideCompsConfig({ round, onUpdate }: { round: WizardRound; onUpdate: (r: WizardRound) => void }) {
  const holeOptions = Array.from({ length: round.holes }, (_, i) => i + 1)

  return (
    <div className="space-y-3 pt-3 border-t border-cream-300">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Side Competitions</p>

      {(['nearest_pin', 'longest_drive', 'pros_approach'] as const).map(type => {
        const comp = getComp(round, type)
        const meta = SIDE_COMP_META[type]
        return (
          <div key={type} className="bg-white rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text flex items-center gap-2">
                <span>{meta.icon}</span>{meta.label}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={comp.enabled}
                onClick={() => onUpdate(setComp(round, type, { enabled: !comp.enabled, hole_number: !comp.enabled ? (comp.hole_number ?? holeOptions[0]) : comp.hole_number }))}
                style={{
                  width: 42, height: 24, borderRadius: 12, position: 'relative', flexShrink: 0,
                  background: comp.enabled ? '#16a34a' : '#d1d5db', border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: comp.enabled ? 20 : 2,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                }} />
              </button>
            </div>
            {comp.enabled && (
              <div className="mt-3">
                <Field label="Select Hole">
                  <Select
                    value={comp.hole_number ?? holeOptions[0]}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdate(setComp(round, type, { hole_number: Number(e.target.value) }))}
                  >
                    {holeOptions.map(h => <option key={h} value={h}>Hole {h}</option>)}
                  </Select>
                </Field>
                {/* "Do NOT describe manually entered competitions as
                    Auto-tracked" — this is a manually-configured hole with
                    live scoring integration, worded as exactly that. */}
                <p className="text-xs text-text-muted mt-2">
                  {meta.icon} {meta.label} · Hole {comp.hole_number ?? holeOptions[0]} · Integrated into scoring
                </p>
              </div>
            )}
          </div>
        )
      })}

      <div className="bg-white rounded-xl p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text flex items-center gap-2">
            <span>⚡</span>Powerplay
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!round.powerplay_enabled}
            onClick={() => onUpdate({
              ...round,
              powerplay_enabled: !round.powerplay_enabled,
              powerplay_hole_number: !round.powerplay_enabled ? (round.powerplay_hole_number ?? holeOptions[holeOptions.length - 1]) : round.powerplay_hole_number,
            })}
            style={{
              width: 42, height: 24, borderRadius: 12, position: 'relative', flexShrink: 0,
              background: round.powerplay_enabled ? '#16a34a' : '#d1d5db', border: 'none', cursor: 'pointer', transition: 'background 0.15s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: round.powerplay_enabled ? 20 : 2,
              width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }} />
          </button>
        </div>
        {round.powerplay_enabled && (
          <div className="mt-3">
            <Field label="Select Powerplay Hole">
              <Select
                value={round.powerplay_hole_number ?? holeOptions[holeOptions.length - 1]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdate({ ...round, powerplay_hole_number: Number(e.target.value) })}
              >
                {holeOptions.map(h => <option key={h} value={h}>Hole {h}</option>)}
              </Select>
            </Field>
            {/* V1: fixed ×2 rule, no multiplier editor, per the brief. */}
            <p className="text-xs text-text-muted mt-2">
              ⚡ Hole {round.powerplay_hole_number ?? holeOptions[holeOptions.length - 1]} · 2× Stableford Points
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function RoundCard({ round, index, total, onUpdate, onRemove, locked }: {
  round: WizardRound; index: number; total: number; key?: string
  onUpdate: (r: WizardRound) => void; onRemove: () => void; locked: boolean
}) {
  function set<K extends keyof WizardRound>(k: K, v: WizardRound[K]) {
    onUpdate({ ...round, [k]: v })
  }
  const enabledComps = (round.side_comps ?? []).filter(c => c.enabled)

  return (
    <div className="bg-surface-muted rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">Round {index + 1}</span>
        {total > 1 && !locked && (
          <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 transition-colors">
            Remove
          </button>
        )}
      </div>
      <Field label="Round name" required>
        <Input value={round.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)} placeholder="Day 1 — Royal County Down" maxLength={100} disabled={locked} />
      </Field>
      <Field label="Course">
        <Input value={round.course_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('course_name', e.target.value)} placeholder="Royal County Down" maxLength={100} disabled={locked} />
      </Field>
      <Field label="Date" required>
        <Input type="date" value={round.play_date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('play_date', e.target.value)} disabled={locked} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Holes">
          <Select value={round.holes} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('holes', Number(e.target.value) as 9 | 18)} disabled={locked}>
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

      {locked ? (
        // Round has already started — configuration is locked (matches
        // the DB-level lock in migration 037). Read-only summary instead
        // of edit controls, rather than silently hiding what was
        // configured.
        (enabledComps.length > 0 || round.powerplay_enabled) && (
          <div className="pt-3 border-t border-cream-300">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Side Competitions · Locked
            </p>
            <div className="flex flex-wrap gap-2">
              {enabledComps.map(c => (
                <span key={c.comp_type} className="text-xs bg-white rounded-full px-3 py-1 text-text-muted">
                  {SIDE_COMP_META[c.comp_type].icon} {SIDE_COMP_META[c.comp_type].label} · H{c.hole_number}
                </span>
              ))}
              {round.powerplay_enabled && (
                <span className="text-xs bg-white rounded-full px-3 py-1 text-text-muted">
                  ⚡ Powerplay · H{round.powerplay_hole_number} · 2×
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-2">
              This round has started, so its Side Competition and Powerplay setup can no longer be changed.
            </p>
          </div>
        )
      ) : (
        <SideCompsConfig round={round} onUpdate={onUpdate} />
      )}
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
            locked={!!r.status && r.status !== 'upcoming'}
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
