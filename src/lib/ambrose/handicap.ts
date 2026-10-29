// Package 4 / M2 -- Ambrose team handicap calculation. PURE: no I/O, nothing imports this from live code yet.
//
// Exact arithmetic: handicaps are held as integer TENTHS and allowances as integer PERCENT, so no floating-point rounding
// can creep in. The ONE rounding step is the final team handicap, to one decimal place, round-half-up (toward +infinity,
// the same direction as the project's roundHandicap). Components are never rounded individually; the record shows the
// exact intermediate values.
//
// SOURCE STATUS (be honest in the UI): the weighted allowances are stated in the Golf Australia WHS Official Reference Guide
// (30 Jan 2020 edition) as reported by the organiser; I could not retrieve that section's text myself, and the guide is an
// archived 2020 edition whose currency is unconfirmed. The club divisor is documented by Golf Select and Australian Golf Digest.
// Therefore every result carries `sourceStatus` and nothing here may be labelled "current Golf Australia requirement".
//
// WHICH player handicap feeds this (Playing / Daily / GA Handicap) is an OPEN decision (Daily Handicap impact report).
// The caller supplies the numbers and the basis label; this module records both and never guesses.

import { roundHalfUpDiv } from './rounding'

export type AmbroseMethod = 'ga_weighted' | 'club_divisor' | 'organiser_entered'
export type TeamSize = 2 | 4

export const AMBROSE_ROUNDING_RULE = 'team handicap rounded once, to 1 decimal place, half up (toward +infinity); components unrounded' as const

/** Allowances as whole percentages, lowest handicap first. */
export const WEIGHTED_ALLOWANCE_PERCENT: Record<TeamSize, readonly number[]> = { 2: [35, 15], 4: [25, 20, 15, 10] }
/** Club divisor: combined handicap divided by this. */
export const CLUB_DIVISOR: Record<TeamSize, number> = { 2: 4, 4: 8 }

export type SourceStatus = 'unverified_archived_2020' | 'secondary_sources_only' | 'organiser_supplied'

export interface AmbroseHandicapRecord {
  method: AmbroseMethod
  teamSize: TeamSize
  /** What the player numbers are (e.g. 'playing_handicap_snapshot'); recorded, never inferred. */
  inputBasis: string
  /** Players sorted lowest first (plus handicaps are negative). */
  players: { playerId: string; handicap: number }[]
  /** Weighted: per-player contribution before rounding, as exact decimals (strings avoid float display noise). */
  components: { playerId: string; percent: number; contribution: string }[] | null
  combined: number | null
  divisor: number | null
  /** The one stored/displayed value. */
  teamHandicap: number
  rounding: typeof AMBROSE_ROUNDING_RULE
  sourceStatus: SourceStatus
  organiserNote?: string
}

export class AmbroseHandicapError extends Error {
  constructor(public code: 'INCOMPLETE_TEAM' | 'DUPLICATE_PLAYER' | 'INVALID_HANDICAP' | 'INVALID_TEAM_HANDICAP' | 'UNSUPPORTED_TEAM_SIZE' | 'NOTE_REQUIRED', message: string) {
    super(message); this.name = 'AmbroseHandicapError'
  }
}

/** Handicap -> integer tenths. Rejects anything with more than one decimal: we never silently round an input. */
export function toTenths(h: number): number {
  if (typeof h !== 'number' || !Number.isFinite(h)) throw new AmbroseHandicapError('INVALID_HANDICAP', 'Handicap must be a number')
  const t = Math.round(h * 10)
  if (Math.abs(t / 10 - h) > 1e-9) throw new AmbroseHandicapError('INVALID_HANDICAP', `Handicap ${h} has more than one decimal place`)
  if (t < -100 || t > 1000) throw new AmbroseHandicapError('INVALID_HANDICAP', `Handicap ${h} is outside -10.0 .. 100.0`)
  return t
}

/** round-half-up of num/den (den > 0) to an integer; exact for integers. */
export function divRoundHalfUp(num: number, den: number): number {
  return roundHalfUpDiv(num, den)   // named, integer-exact implementation lives in rounding.ts
}

/** Exact decimal string of (tenths * percent / 100), i.e. thousandths -> up to 3 decimals. */
const fmtThousandths = (n: number) => {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`
}

export interface AmbroseHandicapInput {
  method: AmbroseMethod
  teamSize: TeamSize
  players: { playerId: string; handicap: number }[]
  inputBasis: string
  /** Method C only. */
  organiserTeamHandicap?: number
  organiserNote?: string
}

export function calculateAmbroseTeamHandicap(input: AmbroseHandicapInput): AmbroseHandicapRecord {
  const { method, teamSize, inputBasis } = input
  if (teamSize !== 2 && teamSize !== 4) throw new AmbroseHandicapError('UNSUPPORTED_TEAM_SIZE', 'Only two- and four-person teams are supported')
  const ids = input.players.map(p => p.playerId)
  if (new Set(ids).size !== ids.length) throw new AmbroseHandicapError('DUPLICATE_PLAYER', 'The same player appears twice on one team')
  const sorted = [...input.players].sort((a, b) => a.handicap - b.handicap || a.playerId.localeCompare(b.playerId))

  if (method === 'organiser_entered') {
    // The organiser's value is authoritative, but still must be a sane 1-decimal number and must carry a note.
    if (input.organiserTeamHandicap === undefined) throw new AmbroseHandicapError('INVALID_TEAM_HANDICAP', 'Enter the team handicap')
    const t = toTenths(input.organiserTeamHandicap)
    if (!input.organiserNote || !input.organiserNote.trim()) throw new AmbroseHandicapError('NOTE_REQUIRED', 'A note is required when the team handicap is entered manually')
    return { method, teamSize, inputBasis, players: sorted, components: null, combined: null, divisor: null,
      teamHandicap: t / 10, rounding: AMBROSE_ROUNDING_RULE, sourceStatus: 'organiser_supplied', organiserNote: input.organiserNote.trim() }
  }

  // Incomplete teams never get a computed allowance (the four-player allowance must not be applied to three players).
  if (input.players.length !== teamSize) throw new AmbroseHandicapError('INCOMPLETE_TEAM', `A ${teamSize}-person team needs exactly ${teamSize} players (got ${input.players.length})`)
  const tenths = sorted.map(p => toTenths(p.handicap))

  if (method === 'club_divisor') {
    const sum = tenths.reduce((a, b) => a + b, 0)
    const result = divRoundHalfUp(sum, CLUB_DIVISOR[teamSize])
    return { method, teamSize, inputBasis, players: sorted, components: null, combined: sum / 10, divisor: CLUB_DIVISOR[teamSize],
      teamHandicap: result / 10, rounding: AMBROSE_ROUNDING_RULE, sourceStatus: 'secondary_sources_only' }
  }

  // ga_weighted
  const pct = WEIGHTED_ALLOWANCE_PERCENT[teamSize]
  const thousandths = tenths.map((t, i) => t * pct[i])           // tenths x percent = thousandths (exact)
  const total = thousandths.reduce((a, b) => a + b, 0)
  const result = divRoundHalfUp(total, 100)                       // thousandths -> tenths
  return { method, teamSize, inputBasis, players: sorted, combined: null, divisor: null,
    components: sorted.map((p, i) => ({ playerId: p.playerId, percent: pct[i], contribution: fmtThousandths(thousandths[i]) })),
    teamHandicap: result / 10, rounding: AMBROSE_ROUNDING_RULE, sourceStatus: 'unverified_archived_2020' }
}

/** Net = gross - team handicap, exact to one decimal (returned as a number with at most 1 dp). */
export function netScore(grossTotal: number, teamHandicap: number): number {
  if (!Number.isInteger(grossTotal)) throw new AmbroseHandicapError('INVALID_HANDICAP', 'Gross total must be a whole number')
  return (grossTotal * 10 - toTenths(teamHandicap)) / 10
}

/** Human-readable working for the "how was this calculated" panel. Same numbers as the record, nothing recomputed differently. */
export function explainAmbroseHandicap(r: AmbroseHandicapRecord): string[] {
  const lines: string[] = [`Method: ${METHOD_LABEL[r.method]} (${r.teamSize}-person)`, `Handicaps used: ${r.inputBasis}`]
  if (r.method === 'organiser_entered') lines.push(`Entered by the organiser: ${r.teamHandicap.toFixed(1)}. Note: ${r.organiserNote}`)
  else if (r.method === 'club_divisor') lines.push(`Combined ${r.players.map(p => p.handicap).join(' + ')} = ${r.combined!.toFixed(1)}; divided by ${r.divisor} = ${r.teamHandicap.toFixed(1)}`)
  else lines.push(...r.components!.map(c => `${c.percent}% of ${r.players.find(p => p.playerId === c.playerId)!.handicap} = ${c.contribution}`), `Total ${r.teamHandicap.toFixed(1)}`)
  lines.push(`Rounding: ${r.rounding}`)
  return lines
}

export const METHOD_LABEL: Record<AmbroseMethod, string> = {
  ga_weighted: 'Weighted scramble allowance', club_divisor: 'Traditional club divisor', organiser_entered: 'Organiser-entered team handicap',
}
