import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPublicBoard, positionText, STATUS_LABEL, medalOf, initialsOf, podiumRows, crownedRows, statusSubtitle, podiumCaption } from './publicBoard'
import type { RoundLeaderboardPayload } from '@/lib/scoring/roundLeaderboard'

const NOW = new Date('2026-10-24T03:00:00.000Z')

function single(rows: { name: string; pts: number; holes: number; position: number; finished?: boolean }[]): RoundLeaderboardPayload {
  return {
    board: rows.map((r, i) => ({
      playerId: `secret-id-${i}`, name: r.name, avatarUrl: `https://img/${i}.png`, handicap: 12 + i, totalPts: r.pts,
      holesPlayed: r.holes, finished: r.finished ?? r.holes >= 18, isCurrentUser: i === 0, position: r.position,
    })),
    roundId: 'r1', roundName: 'Round 1', scoringFormat: 'stableford', totalHoles: 18, scoringNow: 0, finishedCount: 0,
    cumulativeStandings: [], roundsSummary: [],
  }
}

const base = { eventName: 'Lappen Invitational', tripStatus: 'active', completedRoundCount: 0, now: NOW }

test('before play: NOT STARTED with an empty table and a clear note (no payload / upcoming round)', () => {
  const a = buildPublicBoard({ ...base, selected: null, payload: null })
  assert.equal(a.status, 'not_started'); assert.equal(a.statusLabel, 'NOT STARTED'); assert.deepEqual(a.rows, [])
  const b = buildPublicBoard({ ...base, selected: { status: 'upcoming', label: 'Round 1' }, payload: single([]) })
  assert.equal(b.status, 'not_started')
  assert.match(b.note ?? '', /once play begins/)
})

test('during a round: LIVE, with "Thru N" / "F" per player and the provisional note', () => {
  const b = buildPublicBoard({
    ...base, selected: { status: 'active', label: 'Round 1' },
    payload: single([{ name: 'Sam Carter', pts: 20, holes: 9, position: 1 }, { name: 'Lee Wong', pts: 18, holes: 18, position: 2 }]),
  })
  assert.equal(b.status, 'live'); assert.equal(b.statusLabel, 'LIVE'); assert.equal(b.roundLabel, 'Round 1')
  assert.deepEqual(b.rows.map(r => r.thru), ['Thru 9', 'F'])
  assert.match(b.note ?? '', /Provisional/)
})

test('between rounds and after the event: ROUND COMPLETE vs EVENT FINAL; thru hidden once not live', () => {
  const p = single([{ name: 'Sam Carter', pts: 36, holes: 18, position: 1 }])
  const mid = buildPublicBoard({ ...base, completedRoundCount: 1, selected: { status: 'completed', label: 'Round 1' }, payload: p })
  assert.equal(mid.status, 'round_complete'); assert.equal(mid.rows[0].thru, null)
  const fin = buildPublicBoard({ ...base, tripStatus: 'completed', completedRoundCount: 2, selected: { status: 'completed', label: 'Round 2' }, payload: p })
  assert.equal(fin.status, 'final'); assert.equal(fin.roundLabel, '2 rounds'); assert.match(fin.note ?? '', /competition is complete/); assert.doesNotMatch(fin.note ?? '', /[Pp]rovisional|live scores/i)
})

test('Lappen: one completed round + one cancelled round reads as a one-round EVENT FINAL', () => {
  const b = buildPublicBoard({ ...base, tripStatus: 'completed', completedRoundCount: 1, selected: { status: 'completed', label: 'Round 1' }, payload: single([{ name: 'A B', pts: 30, holes: 18, position: 1 }]) })
  assert.equal(b.status, 'final'); assert.equal(b.roundLabel, '1 round'); assert.deepEqual(b.roundColumns, [])
})

test('ties share a position and are flagged (T2); a lone position is not', () => {
  const b = buildPublicBoard({
    ...base, selected: { status: 'completed', label: 'Round 1' },
    payload: single([{ name: 'A', pts: 30, holes: 18, position: 1 }, { name: 'B', pts: 28, holes: 18, position: 2 }, { name: 'C', pts: 28, holes: 18, position: 2 }, { name: 'D', pts: 20, holes: 18, position: 4 }]),
  })
  assert.deepEqual(b.rows.map(positionText), ['1', 'T2', 'T2', '4'])
})

test('multi-round: R1..Rn columns, cumulative totals, live column and countback note', () => {
  const payload: RoundLeaderboardPayload = {
    ...single([]),
    roundsSummary: [{ roundId: 'a', roundNumber: 1, isLive: false }, { roundId: 'b', roundNumber: 2, isLive: true }],
    cumulativeStandings: [
      { playerId: 'p1', playerName: 'Sam Carter', totalPoints: 50, position: 1, roundsPlayed: 2, rounds: [
        { roundId: 'a', roundNumber: 1, points: 30, isCurrentRound: false, holesPlayed: null, finished: true },
        { roundId: 'b', roundNumber: 2, points: 20, isCurrentRound: true, holesPlayed: 11, finished: false }] },
      { playerId: 'p2', playerName: 'Lee Wong', totalPoints: 40, position: 2, roundsPlayed: 1, rounds: [
        { roundId: 'b', roundNumber: 2, points: 40, isCurrentRound: true, holesPlayed: 18, finished: true }] },
    ],
  }
  const b = buildPublicBoard({ ...base, completedRoundCount: 1, selected: { status: 'active', label: 'Round 2' }, payload })
  assert.deepEqual(b.roundColumns, [{ label: 'R1', live: false }, { label: 'R2', live: true }])
  assert.deepEqual(b.rows[0].rounds, [30, 20]); assert.deepEqual(b.rows[1].rounds, [null, 40])
  assert.deepEqual(b.rows.map(r => r.total), [50, 40]); assert.deepEqual(b.rows.map(r => r.thru), ['Thru 11', 'F'])
  assert.match(b.note ?? '', /countback/)
})

test('PRIVACY: only name, position, points and thru reach the public shape; no ids, avatars, handicaps or per-hole data', () => {
  const b = buildPublicBoard({ ...base, selected: { status: 'active', label: 'Round 1' }, payload: single([{ name: 'Sam Carter', pts: 20, holes: 9, position: 1 }]) })
  const json = JSON.stringify(b)
  for (const leak of ['secret-id', 'avatar', 'img/', 'handicap', 'playerId', 'perHole', 'email', 'isCurrentUser']) assert.equal(json.includes(leak), false, leak)
  assert.deepEqual(Object.keys(b.rows[0]).sort(), ['name', 'position', 'rounds', 'thru', 'tied', 'total'])
  assert.deepEqual(Object.keys(b).sort(), ['endedEarly', 'eventName', 'generatedAt', 'note', 'roundColumns', 'roundLabel', 'rows', 'status', 'statusLabel'])
})

test('hostile or empty names are normalised, never throw', () => {
  const p = single([{ name: '   ', pts: 1, holes: 1, position: 1 }, { name: 'x'.repeat(200), pts: 0, holes: 1, position: 2 }])
  ;(p.board[0] as { name: unknown }).name = null
  const b = buildPublicBoard({ ...base, eventName: '   ', selected: { status: 'active', label: 'Round 1' }, payload: p })
  assert.equal(b.rows[0].name, 'Player'); assert.equal(b.rows[1].name.length, 60); assert.equal(b.eventName, 'Golf event')
})

test('status labels are the documented words', () => {
  assert.deepEqual(Object.values(STATUS_LABEL), ['NOT STARTED', 'LIVE', 'ROUND COMPLETE', 'FINAL RESULTS', 'EVENT ENDED EARLY'])
})

test('podium: top three medal positions, gold/silver/bronze, ties share a medal, hidden until someone has scored', () => {
  const b = (rows: { position: number; total: number }[], status: 'live' | 'final' = 'live') => ({ status, rows: rows.map((r, i) => ({ ...r, tied: false, name: `P${i}`, rounds: [], thru: null })) })
  assert.deepEqual(podiumRows(b([{ position: 1, total: 30 }, { position: 2, total: 28 }, { position: 3, total: 20 }, { position: 4, total: 10 }])).map(r => medalOf(r.position)), ['gold', 'silver', 'bronze'])
  assert.deepEqual(podiumRows(b([{ position: 1, total: 30 }, { position: 2, total: 28 }, { position: 2, total: 28 }, { position: 4, total: 10 }])).map(r => medalOf(r.position)), ['gold', 'silver', 'silver'])
  assert.equal(podiumRows(b([{ position: 1, total: 0 }, { position: 1, total: 0 }])).length, 0)
  assert.equal(podiumRows(b([])).length, 0)
  assert.equal(medalOf(4), null)
})

test('CROWN: only on a final board, only for first place, never live or between rounds, never on zero points', () => {
  const rows = [{ position: 1, total: 40 }, { position: 2, total: 38 }].map((r, i) => ({ ...r, tied: false, name: `P${i}`, rounds: [], thru: null }))
  assert.deepEqual(crownedRows({ status: 'final', rows }).map(r => r.name), ['P0'])
  for (const status of ['live', 'round_complete', 'not_started'] as const) assert.equal(crownedRows({ status, rows }).length, 0, status)
  assert.equal(crownedRows({ status: 'final', rows: rows.map(r => ({ ...r, total: 0 })) }).length, 0)
  const tied = [{ ...rows[0], position: 1, tied: true }, { ...rows[1], position: 1, tied: true }]
  assert.equal(crownedRows({ status: 'final', rows: tied }).length, 2)
})

test('initials: two letters, one for a single name, accents and punctuation handled, never empty', () => {
  assert.equal(initialsOf('Darren Lappen'), 'DL'); assert.equal(initialsOf('Howard La-Faber'), 'HL'); assert.equal(initialsOf('Madonna'), 'M')
  assert.equal(initialsOf('  se\u00e1n  o\u2019brien '), 'S' + 'O'); assert.equal(initialsOf('***'), '?'); assert.equal(initialsOf(''), '?')
})

// ── ended early (Lappen): LIVE / FINAL RESULTS / EVENT ENDED EARLY ─────────
const lappenPayload = () => single([{ name: 'Alex Schaefer', pts: 41, holes: 18, position: 1 }, { name: 'Daz', pts: 38, holes: 18, position: 2 }, { name: 'Sam Carter', pts: 30, holes: 18, position: 3 }])
const done = { ...base, tripStatus: 'completed', completedRoundCount: 1, selected: { status: 'completed', label: 'Round 1' }, payload: lappenPayload() }

test('ended early, NO champion: EVENT ENDED EARLY, podium shown, nobody crowned', () => {
  const b = buildPublicBoard({ ...done, outcome: { endedEarly: true, championDeclared: false } })
  assert.equal(b.status, 'ended_early'); assert.equal(b.statusLabel, 'EVENT ENDED EARLY'); assert.equal(b.endedEarly, true)
  assert.equal(podiumRows(b).length, 3, 'top three podium still shown')
  assert.equal(crownedRows(b).length, 0, 'no crown')
  assert.match(b.note ?? '', /No overall champion was declared/)
  assert.equal(statusSubtitle(b), 'Final standings'); assert.equal(podiumCaption(b), 'Final standings: top three')
  assert.ok(!/champion/i.test(JSON.stringify([b.statusLabel, statusSubtitle(b), podiumCaption(b)])), 'no champion wording in the headline copy')
})

test('ended early WITH a declared champion: FINAL RESULTS, crowned, and says it ended early', () => {
  const b = buildPublicBoard({ ...done, outcome: { endedEarly: true, championDeclared: true } })
  assert.equal(b.status, 'final'); assert.equal(b.statusLabel, 'FINAL RESULTS'); assert.equal(b.endedEarly, true)
  assert.deepEqual(crownedRows(b).map(r => r.name), ['Alex Schaefer'])
  assert.equal(statusSubtitle(b), 'Event ended early'); assert.match(b.note ?? '', /event ended early/i)
})

test('normal completion is unchanged: FINAL RESULTS, crowned, "The competition is complete"; no outcome input = normal', () => {
  for (const outcome of [undefined, { endedEarly: false, championDeclared: true }]) {
    const b = buildPublicBoard({ ...done, outcome })
    assert.equal(b.status, 'final'); assert.equal(b.endedEarly, false); assert.equal(crownedRows(b).length, 1)
    assert.equal(statusSubtitle(b), 'The competition is complete')
  }
})

test('while the event is still live nothing is crowned, even if an outcome says otherwise', () => {
  const b = buildPublicBoard({ ...base, tripStatus: 'active', selected: { status: 'active', label: 'Round 1' }, payload: lappenPayload(), outcome: { endedEarly: true, championDeclared: false } })
  assert.equal(b.status, 'live'); assert.equal(crownedRows(b).length, 0); assert.equal(podiumCaption(b), 'Provisional top three')
})

test('a championless ended-early event keeps the privacy shape (no ids, avatars, handicaps)', () => {
  const json = JSON.stringify(buildPublicBoard({ ...done, outcome: { endedEarly: true, championDeclared: false } }))
  for (const leak of ['secret-id', 'avatar', 'img/', 'handicap', 'playerId']) assert.equal(json.includes(leak), false, leak)
})
