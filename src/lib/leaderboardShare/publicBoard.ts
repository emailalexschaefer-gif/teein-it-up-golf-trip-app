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

export type BoardStatus = 'not_started' | 'live' | 'round_complete' | 'final' | 'ended_early'

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
  /** True when the organiser ended the event early (with or without a champion). */
  endedEarly: boolean
  /** e.g. "Round 2" while live, "2 rounds" when final. */
  roundLabel: string | null
  /** Round columns (R1, R2 ...); empty for a single-round board. */
  roundColumns: { label: string; live: boolean }[]
  rows: PublicBoardRow[]
  note: string | null
  /** ISO timestamp the standings were computed. */
  generatedAt: string
  /** Package 3: players incomplete in a championship-counted shortened round. Shown apart from the ranking, never zeroed. */
  notRanked?: { name: string; total: number }[]
  /** Package 3: one line per round finished early ("R2 \u2014 Round Finished Early \u2014 Weather. Official 9-Hole Result. Not Counted Toward Event Championship."). */
  earlyNotes?: string[]
}

export const NOT_RANKED_LABEL = 'Not ranked \u2014 incomplete round'

export const STATUS_LABEL: Record<BoardStatus, string> = {
  not_started: 'NOT STARTED',
  live: 'LIVE',
  round_complete: 'ROUND COMPLETE',
  final: 'FINAL RESULTS',
  // Ended early with NO overall champion declared: final standings, no crown, no champion.
  ended_early: 'EVENT ENDED EARLY',
}

const NOTE_LIVE = 'Live scores. Provisional until each round is verified and closed by the organiser.'
const NOTE_ROUND_COMPLETE = 'Round results are confirmed. Standings update when the next round is played.'
const NOTE_NOT_STARTED = 'Scores will appear here once play begins.'
const NOTE_FINAL = 'The competition is complete. These are the confirmed final results.'
const NOTE_FINAL_EARLY = 'The event ended early. These are the confirmed final results.'
const NOTE_ENDED_EARLY = 'The event ended early. These are the final standings. No overall champion was declared.'
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
  /** How the event ended (defaults to a normal completion). */
  outcome?: { endedEarly: boolean; championDeclared: boolean }
}

export function buildPublicBoard(input: BuildInput): PublicBoard {
  const { eventName, tripStatus, selected, payload, completedRoundCount, now } = input
  const endedEarly = input.outcome?.endedEarly === true
  const championDeclared = input.outcome?.championDeclared !== false
  const generatedAt = now.toISOString()
  const name = typeof eventName === 'string' && eventName.trim() ? eventName.trim().slice(0, 100) : 'Golf event'

  if (!selected || !payload || selected.status === 'upcoming') {
    return { eventName: name, endedEarly, status: 'not_started', statusLabel: STATUS_LABEL.not_started, roundLabel: null, roundColumns: [], rows: [], note: NOTE_NOT_STARTED, generatedAt }
  }

  const status: BoardStatus =
    selected.status === 'active' ? 'live'
      : tripStatus === 'completed' ? (endedEarly && !championDeclared ? 'ended_early' : 'final')
        : 'round_complete'

  const multi = payload.roundsSummary.length > 1 && payload.cumulativeStandings.length > 0
  let rows: PublicBoardRow[]
  let notRanked: { name: string; total: number }[] = []
  const earlyNotes: string[] = []
  // This round was finished early: say so on every surface (public page, PNG, PDF). Only the reason category is shown.
  const ef = payload.earlyFinish
  if (ef) {
    const n = payload.roundsSummary.find(r => r.roundId === payload.roundId)?.roundNumber
    earlyNotes.push(`${n ? `R${n} \u2014 ` : ''}${ef.title}. ${ef.resultLabel}. ${ef.countingLabel}.`)
  }
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
    notRanked = (payload.notRankedStandings ?? []).map(n => ({ name: cleanName(n.playerName), total: n.totalPoints }))
  } else {
    // A round finished early: qualifying players are ranked on their official points; incomplete players are listed apart.
    const ranked = payload.board.filter(b => b.ranked !== false)
    notRanked = payload.board.filter(b => b.ranked === false).map(b => ({ name: cleanName(b.name), total: b.totalPts }))
    rows = markTies(ranked.map(b => ({
      position: b.position,
      name: cleanName(b.name),
      total: b.ranked === true && typeof b.officialPoints === 'number' ? b.officialPoints : b.totalPts,
      rounds: [],
      thru: status === 'live' ? (b.finished ? 'F' : `Thru ${b.holesPlayed}`) : null,
    })))
  }

  const roundLabel =
    status === 'live' ? selected.label
      : status === 'final' || status === 'ended_early' ? plural(completedRoundCount, 'round')
        : selected.label
  const base = status === 'live' ? NOTE_LIVE : status === 'round_complete' ? NOTE_ROUND_COMPLETE : status === 'ended_early' ? NOTE_ENDED_EARLY : endedEarly ? NOTE_FINAL_EARLY : NOTE_FINAL
  const note = multi ? [base, NOTE_COUNTBACK].filter(Boolean).join(' ') : base

  return {
    eventName: name, endedEarly, status, statusLabel: STATUS_LABEL[status], roundLabel, roundColumns, rows, note, generatedAt,
    ...(notRanked.length > 0 ? { notRanked } : {}), ...(earlyNotes.length > 0 ? { earlyNotes } : {}),
  }
}

/** "T2" for a tie, "2" otherwise. */
export function positionText(row: { position: number; tied: boolean }): string {
  return `${row.tied ? 'T' : ''}${row.position}`
}

export type Medal = 'gold' | 'silver' | 'bronze'

/** Gold, silver and bronze by position (tied players share a medal). */
export function medalOf(position: number): Medal | null {
  return position === 1 ? 'gold' : position === 2 ? 'silver' : position === 3 ? 'bronze' : null
}

/** Up to two letters for the avatar circle. */
export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s'\u2019-]/gu, ' ').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0])[0] ?? '?'
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * The three podium cards: the first three rows that hold a medal position.
 * Not shown until somebody has actually scored, so a board of zeros never
 * hands out gold, silver and bronze.
 */
export function podiumRows(board: Pick<PublicBoard, 'rows'>): PublicBoardRow[] {
  if (board.rows.length === 0 || board.rows[0].total <= 0) return []
  return board.rows.filter(r => r.position <= 3).slice(0, 3)
}

/**
 * Who wears the crown: ONLY when the event is final (organiser-closed, all
 * rounds done) and only the player(s) in first place. Never while live or
 * between rounds, and never on a board with no points.
 */
export function crownedRows(board: Pick<PublicBoard, 'rows' | 'status'>): PublicBoardRow[] {
  if (board.status !== 'final') return []
  return board.rows.filter(r => r.position === 1 && r.total > 0)
}

export function playerCountText(board: Pick<PublicBoard, 'rows'>): string {
  return board.rows.length === 0 ? '' : plural(board.rows.length, 'player')
}

/** The line under the status label. One definition used by the web page, PNG and PDF. */
export function statusSubtitle(board: Pick<PublicBoard, 'status' | 'endedEarly'>): string {
  switch (board.status) {
    case 'live': return 'Scores updating as play progresses'
    case 'final': return board.endedEarly ? 'Event ended early' : 'The competition is complete'
    case 'ended_early': return 'Final standings'
    case 'round_complete': return 'Between rounds'
    default: return 'Play has not begun'
  }
}

/** Heading above the three podium cards. One definition used by every format. */
export function podiumCaption(board: Pick<PublicBoard, 'status'>): string {
  switch (board.status) {
    case 'live': return 'Provisional top three'
    case 'final': return 'Final top three'
    case 'ended_early': return 'Final standings: top three'
    case 'round_complete': return 'Top three so far'
    default: return ''
  }
}

/**
 * The text under the table on every surface (page, PNG, PDF): finished-early labels, the players who are not ranked
 * (incomplete, with their real points -- never a zero), then the ordinary status note. One function so the surfaces agree.
 */
export function boardFootnote(board: PublicBoard): string | null {
  const parts: string[] = []
  if (board.earlyNotes?.length) parts.push(...board.earlyNotes)
  if (board.notRanked?.length) parts.push(`${NOT_RANKED_LABEL}: ${board.notRanked.map(n => `${n.name} (${n.total} pts)`).join(', ')}.`)
  if (board.note) parts.push(board.note)
  return parts.length > 0 ? parts.join(' ') : null
}

/** True when there is something to say under the table even though no player is ranked. */
export function hasBoardExtras(board: PublicBoard): boolean {
  return !!(board.earlyNotes?.length || board.notRanked?.length)
}
