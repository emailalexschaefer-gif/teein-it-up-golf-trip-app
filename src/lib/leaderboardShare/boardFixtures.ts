/** Test-only board builders (imported by the leaderboard-share tests; no runtime code uses this). */
import { STATUS_LABEL, type PublicBoard } from './publicBoard'

const NOW = new Date('2026-10-24T03:00:00.000Z')

export function fixtureBoard(n: number, status: PublicBoard['status'] = 'live', rounds = 0): PublicBoard {
  const rows = Array.from({ length: n }, (_, i) => ({
    position: i + 1, tied: false, name: `Player Number ${i + 1} Surname`, total: Math.max(0, 40 - i), rounds: Array.from({ length: rounds }, (_, k) => 10 + k), thru: status === 'live' ? `Thru ${(i % 18) + 1}` : null,
  }))
  return { eventName: 'Lappen Invitational', endedEarly: status === 'ended_early', status, statusLabel: STATUS_LABEL[status], roundLabel: 'Round 1', roundColumns: Array.from({ length: rounds }, (_, k) => ({ label: `R${k + 1}`, live: false })), rows, note: 'note', generatedAt: NOW.toISOString() }
}
