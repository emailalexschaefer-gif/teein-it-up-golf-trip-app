'use client'

import React from 'react'
import { Field, Input, Select } from '@/components/ui/FormFields'
import Button from '@/components/ui/Button'
import { generateUUID } from '@/lib/utils'
import CourseLibrarySearch from './CourseLibrarySearch'
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
    side_comps: [],
  }
}

const SIDE_COMP_META: Record<WizardSideComp['comp_type'], { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
  powerplay:     { icon: '⚡', label: 'Powerplay' },
}
const COMP_TYPE_ORDER: WizardSideComp['comp_type'][] = ['nearest_pin', 'longest_drive', 'pros_approach', 'powerplay']

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
 *
 * Corrected model: an "add competition" list, not one ON/OFF row per
 * type — a round can hold multiple instances of the same competition
 * (two NTPs on different holes, two Powerplay holes), so a single toggle
 * per type could never express that. Each row is independent, with its
 * own Remove.
 */
function SideCompsConfig({ round, onUpdate }: { round: WizardRound; onUpdate: (r: WizardRound) => void }) {
  const holeOptions = Array.from({ length: round.holes }, (_, i) => i + 1)
  const comps = round.side_comps ?? []
  const [adding, setAdding] = React.useState(false)
  const [newType, setNewType] = React.useState<WizardSideComp['comp_type']>('nearest_pin')
  const [newHole, setNewHole] = React.useState(holeOptions[0])

  function addComp() {
    const comp: WizardSideComp = { id: generateUUID(), comp_type: newType, hole_number: newHole }
    // UNIQUE(round_id, comp_type, hole_number) — mirrored client-side so
    // the organiser gets an immediate, specific message rather than a
    // generic failure once this reaches the server.
    if (comps.some(c => c.comp_type === newType && c.hole_number === newHole)) {
      return // silently no-op; the Add button's own disabled state below prevents reaching here in the normal flow
    }
    onUpdate({ ...round, side_comps: [...comps, comp] })
    setAdding(false)
    setNewType('nearest_pin')
    setNewHole(holeOptions[0])
  }

  function removeComp(id: string) {
    onUpdate({ ...round, side_comps: comps.filter(c => c.id !== id) })
  }

  const wouldDuplicate = comps.some(c => c.comp_type === newType && c.hole_number === newHole)

  return (
    <div className="space-y-3 pt-3 border-t border-cream-300">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Side Competitions</p>

      {comps.length > 0 && (
        <div className="space-y-2">
          {comps.map(comp => {
            const meta = SIDE_COMP_META[comp.comp_type]
            return (
              <div key={comp.id} className="bg-white rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text flex items-center gap-2">
                    <span>{meta.icon}</span>{meta.label} — H{comp.hole_number}
                  </span>
                  {/* "Do NOT describe manually entered competitions as
                      Auto-tracked" — worded as exactly what it is. */}
                  <p className="text-xs text-text-muted mt-1">
                    {comp.comp_type === 'powerplay' ? '2× Stableford Points' : 'Integrated into scoring'}
                  </p>
                </div>
                <button type="button" onClick={() => removeComp(comp.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      {adding ? (
        <div className="bg-white rounded-xl p-3 space-y-3">
          <Field label="Competition Type">
            <Select value={newType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewType(e.target.value as WizardSideComp['comp_type'])}>
              {COMP_TYPE_ORDER.map(t => <option key={t} value={t}>{SIDE_COMP_META[t].icon} {SIDE_COMP_META[t].label}</option>)}
            </Select>
          </Field>
          <Field label="Hole">
            <Select value={newHole} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewHole(Number(e.target.value))}>
              {holeOptions.map(h => <option key={h} value={h}>Hole {h}</option>)}
            </Select>
          </Field>
          {newType === 'powerplay' && (
            <p className="text-xs text-text-muted">⚡ 2× Stableford Points on this hole</p>
          )}
          {wouldDuplicate && (
            <p className="text-xs text-red-500">{SIDE_COMP_META[newType].label} is already configured on Hole {newHole}.</p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 text-sm font-medium text-text-muted border border-cream-300 rounded-xl py-2">
              Cancel
            </button>
            <button type="button" onClick={addComp} disabled={wouldDuplicate} className="flex-1 text-sm font-medium text-white bg-brand-600 rounded-xl py-2 disabled:opacity-50">
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full border-2 border-dashed border-brand-200 rounded-xl py-2.5 text-sm font-medium text-brand-600 hover:border-brand-400 hover:bg-brand-50 transition-colors"
        >
          + Add Competition
        </button>
      )}
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
  const comps = round.side_comps ?? []

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
      {locked ? (
        <Field label="Course">
          <div style={{ padding: '9px 0', fontFamily: 'var(--font-body)', fontSize: 14, color: '#374151' }}>
            {round.course_name || '—'}{round.tee_name ? ` — ${round.tee_name} Tees` : ''}
          </div>
        </Field>
      ) : (
        <CourseLibrarySearch
          initialCourseName={round.course_name}
          initialSelection={round.library_tee_set_id ? {
            courseLabel: round.course_name,
            teeSetId: round.library_tee_set_id,
            teeName: round.tee_name ?? '',
            courseRating: round.course_rating ?? null,
            slopeRating: round.slope_rating ?? null,
            holes: round.library_holes_snapshot ?? [],
          } : null}
          onSelectLibrary={(selection) => {
            if (selection) {
              onUpdate({
                ...round,
                course_name: selection.courseLabel,
                library_tee_set_id: selection.teeSetId,
                tee_name: selection.teeName,
                course_rating: selection.courseRating,
                slope_rating: selection.slopeRating,
                library_holes_snapshot: selection.holes,
              })
            } else {
              // Cleared (switched back to search, or "Change tee"/"Change
              // course") — the round's own manual course_name text is left
              // as-is here; onManualNameChange (below) is the only path
              // that edits it directly when the organiser types.
              onUpdate({ ...round, library_tee_set_id: null, tee_name: null, course_rating: null, slope_rating: null, library_holes_snapshot: null })
            }
          }}
          onManualNameChange={(name) => onUpdate({ ...round, course_name: name })}
        />
      )}
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
        comps.length > 0 && (
          <div className="pt-3 border-t border-cream-300">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Side Competitions · Locked
            </p>
            <div className="flex flex-wrap gap-2">
              {comps.map(c => (
                <span key={c.id} className="text-xs bg-white rounded-full px-3 py-1 text-text-muted">
                  {SIDE_COMP_META[c.comp_type].icon} {SIDE_COMP_META[c.comp_type].label} · H{c.hole_number}{c.comp_type === 'powerplay' ? ' · 2×' : ''}
                </span>
              ))}
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
