/**
 * The PUBLIC leaderboard shape and the pure function that builds it from the
 * canonical round-leaderboard payload (scoring/roundLeaderboard.ts). Browser
 * safe: no server imports. Everything the public page, the share link, the PNG
 * and the PDF show comes from this one shape.
 *
 * Privacy by construction: the builder PICKS fields (full name, position,
 * points, holes played). It never copies player ids, avatars, handicaps,
 * per-hole scores, email or any other profile data, so nothing extra can leak
 * even if the canonical payload grows.
 */
import type { RoundLeaderboardPayload } from '@/lib/scoring/roundLeaderboard'

export type BoardStatus = 'not_started' | 'live' | 'round_complete' | 'final'

export interface PublicBoardRow {
  position: number
  /** True when another player shares this position (shown as "T2"). */
  tied: boolean
  name: string
  total: number
  /** Points per round column (multi-round boards); empty for single-round boards. */
  rounds: (number | null)[]
  /** "Thru 9" / "F" for the round being played now; null when not applicable. */
  thru: string | null
}

export interface PublicBoard {
  eventName: string
  status: BoardStatus
  statusLabel: string
  /** e.g. "Round 2" while live, "2 rounds" when final. */
  roundLabel: string | null
  /** Round columns (R1, R2 ...); empty for a single-round board. */
  roundColumns: { label: string; live: boolean }[]
  rows: PublicBoardRow[]
  note: string | null
  /** ISO timestamp the standings were computed. */
  generatedAt: string
}

export const STATUS_LABEL: Record<BoardStatus, string> = {
  not_started: 'NOT STARTED',
  live: 'LIVE',
  round_complete: 'ROUND COMPLETE',
  final: 'EVENT FINAL',
}

const NOTE_LIVE = 'Live scores. Provisional until each round is verified and closed by the organiser.'
const NOTE_ROUND_COMPLETE = 'Round results are confirmed. Standings update when the next round is played.'
const NOTE_NOT_STARTED = 'Scores will appear here once play begins.'
const NOTE_COUNTBACK = 'Ties are decided on countback.'

function cleanName(name: unknown): string {
  if (typeof name !== 'string') return 'Player'
  const t = name.replace(/\s+/g, ' ').trim()
  return t.length > 0 ? t.slice(0, 60) : 'Player'
}

function markTies<T extends { position: number }>(rows: T[]): (T & { tied: boolean })[] {
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.position, (counts.get(r.position) ?? 0) + 1)
  return rows.map(r => ({ ...r, tied: (counts.get(r.position) ?? 0) > 1 }))
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export interface BuildInput {
  eventName: string
  tripStatus: string
  /** The round the board is for (active, else latest completed); null when nothing has started. */
  selected: { status: string; label: string } | null
  payload: RoundLeaderboardPayload | null
  /** Rounds that were actually completed (cancelled rounds excluded). */
  completedRoundCount: number
  now: Date
}

export function buildPublicBoard(input: BuildInput): PublicBoard {
  const { eventName, tripStatus, selected, payload, completedRoundCount, now } = input
  const generatedAt = now.toISOString()
  const name = typeof eventName === 'string' && eventName.trim() ? eventName.trim().slice(0, 100) : 'Golf event'

  if (!selected || !payload || selected.status === 'upcoming') {
    return { eventName: name, status: 'not_started', statusLabel: STATUS_LABEL.not_started, roundLabel: null, roundColumns: [], rows: [], note: NOTE_NOT_STARTED, generatedAt }
  }

  const status: BoardStatus =
    selected.status === 'active' ? 'live'
      : tripStatus === 'completed' ? 'final'
        : 'round_complete'

  const multi = payload.roundsSummary.length > 1 && payload.cumulativeStandings.length > 0
  let rows: PublicBoardRow[]
  let roundColumns: PublicBoard['roundColumns'] = []

  if (multi) {
    roundColumns = payload.roundsSummary.map(rs => ({ label: `R${rs.roundNumber}`, live: status === 'live' && rs.isLive }))
    rows = markTies(payload.cumulativeStandings.map(cs => {
      const current = cs.rounds?.find(r => r.isCurrentRound)
      return {
        position: cs.position,
        name: cleanName(cs.playerName),
        total: cs.totalPoints,
        rounds: payload.roundsSummary.map(rs => cs.rounds?.find(r => r.roundId === rs.roundId)?.points ?? null),
        thru: status === 'live' && current ? (current.finished ? 'F' : `Thru ${current.holesPlayed ?? 0}`) : null,
      }
    }))
  } else {
    rows = markTies(payload.board.map(b => ({
      position: b.position,
      name: cleanName(b.name),
      total: b.totalPts,
      rounds: [],
      thru: status === 'live' ? (b.finished ? 'F' : `Thru ${b.holesPlayed}`) : null,
    })))
  }

  const roundLabel =
    status === 'live' ? selected.label
      : status === 'final' ? plural(completedRoundCount, 'round')
        : selected.label
  const base = status === 'live' ? NOTE_LIVE : status === 'round_complete' ? NOTE_ROUND_COMPLETE : null
  const note = multi ? [base, NOTE_COUNTBACK].filter(Boolean).join(' ') : base

  return { eventName: name, status, statusLabel: STATUS_LABEL[status], roundLabel, roundColumns, rows, note, generatedAt }
}

/** "T2" for a tie, "2" otherwise. */
export function positionText(row: { position: number; tied: boolean }): string {
  return `${row.tied ? 'T' : ''}${row.position}`
}
