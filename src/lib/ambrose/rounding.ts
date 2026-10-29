// Package 4 / M2 -- the TWO rounding operations in Ambrose scoring, as separate, named, integer-exact functions.
// Nothing here uses Math.round (which rounds exact halves toward +infinity for negatives and is easy to misread) or float division.
//
//  1. TEAM HANDICAP to one decimal place  -> roundHalfUpDiv      : exact halves go toward +infinity   (-0.25 -> -0.2, 0.25 -> 0.3)
//  2. WHOLE-NUMBER STROKES (Team Stableford) -> roundHalfAwayFromZeroDiv : exact halves go away from zero (-7.5 -> -8, 7.5 -> 8)
// They are different rules for different numbers and are never interchangeable. The whole-number rule is the organiser-approved
// PROPOSAL (subject to verified competition conditions); Team Stableford stays disabled until that is cleared.

import type { AmbroseHandicapRecord } from './handicap'

/** Exact floor division for integers (den > 0). */
export function floorDiv(num: number, den: number): number {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) throw new RangeError('floorDiv needs safe integers and den > 0')
  const r = ((num % den) + den) % den
  return (num - r) / den
}

/** num/den rounded to an integer, exact halves toward +infinity. (2.5 -> 3, -2.5 -> -2) */
export function roundHalfUpDiv(num: number, den: number): number {
  return floorDiv(2 * num + den, 2 * den)
}

/** num/den rounded to an integer, exact halves away from zero. (2.5 -> 3, -2.5 -> -3). Never returns -0. */
export function roundHalfAwayFromZeroDiv(num: number, den: number): number {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) throw new RangeError('needs safe integers and den > 0')
  const mag = floorDiv(2 * Math.abs(num) + den, 2 * den)
  return num < 0 && mag !== 0 ? -mag : mag
}

/** One-decimal handicap -> integer tenths. Rejects values with more than one decimal (no silent rounding of an input). */
export function oneDecimalToTenths(h: number): number {
  if (typeof h !== 'number' || !Number.isFinite(h)) throw new RangeError('Handicap must be a finite number')
  const t = Math.round(h * 10)               // only to recover the integer; verified exact on the next line
  if (Math.abs(t / 10 - h) > 1e-9) throw new RangeError(`Handicap ${h} has more than one decimal place`)
  return t
}

/** Whole-number strokes received from a one-decimal team handicap, halves away from zero. */
export function wholeStrokesFromTeamHandicap(teamHandicap: number): number {
  return roundHalfAwayFromZeroDiv(oneDecimalToTenths(teamHandicap), 10)
}

export const WHOLE_STROKES_RULE = 'team handicap (1 decimal) converted once to whole strokes, exact halves away from zero' as const

/** The frozen record stored with a team entry: method, inputs, decimal allowance AND (when required) the whole-number strokes. */
export interface AmbroseAllowanceSnapshot {
  method: AmbroseHandicapRecord['method']
  teamSize: AmbroseHandicapRecord['teamSize']
  inputBasis: string
  players: AmbroseHandicapRecord['players']
  components: AmbroseHandicapRecord['components']
  combined: number | null
  divisor: number | null
  /** One decimal. This is what net-stroke results use. */
  teamHandicap: number
  teamHandicapRounding: AmbroseHandicapRecord['rounding']
  /** Whole strokes. null unless the Team Stableford mode asked for it. */
  strokesReceived: number | null
  strokesRounding: typeof WHOLE_STROKES_RULE | null
  sourceStatus: AmbroseHandicapRecord['sourceStatus']
  organiserNote?: string
}

export function buildAllowanceSnapshot(record: AmbroseHandicapRecord, opts: { teamStableford: boolean }): AmbroseAllowanceSnapshot {
  return {
    method: record.method, teamSize: record.teamSize, inputBasis: record.inputBasis, players: record.players, components: record.components,
    combined: record.combined, divisor: record.divisor, teamHandicap: record.teamHandicap, teamHandicapRounding: record.rounding,
    strokesReceived: opts.teamStableford ? wholeStrokesFromTeamHandicap(record.teamHandicap) : null,
    strokesRounding: opts.teamStableford ? WHOLE_STROKES_RULE : null,
    sourceStatus: record.sourceStatus, ...(record.organiserNote ? { organiserNote: record.organiserNote } : {}),
  }
}
