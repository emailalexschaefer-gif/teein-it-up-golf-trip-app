import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEarlyFinish, adjustForEarlyFinish, roundCompetitionResults, earlyLabels, loadEarlyFinish, normaliseEarlyNote } from './earlyFinish'
import { computeCumulativeStandings, determineChampions, determineRoundWinners } from './multiRound'
import type { RoundPlayerResult } from './multiRound'

const R = (playerId: string, playerName: string, roundPoints: number, holePoints: number[] = []): RoundPlayerResult => ({ playerId, playerName, roundPoints, holePoints })
const info = (over: Record<string, unknown> = {}, results: Record<string, unknown>[] = []) =>
  parseEarlyFinish([{ id: 'r2', closed_early: true, closed_early_reason: 'weather', official_holes: 9, counts_toward_event: false, ...over }],
    results.map(r => ({ round_id: 'r2', ...r })))

const q = (player_id: string, official_points: number, actual_points = official_points, holes_played = 9) => ({ player_id, result_kind: 'qualifying', official_points, actual_points, holes_played, segment_points: [official_points, 0, 0, 0, 0, 0, 0, 0, 0], segment_holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], start_hole: 1 })
const inc = (player_id: string, actual_points: number, holes_played: number) => ({ player_id, result_kind: 'incomplete', official_points: null, actual_points, holes_played, segment_points: null, segment_holes: null, start_hole: 1 })

// Round 1 normal (18 holes), Round 2 finished early (rain). Alex & Daz qualify, Sam played six holes.
const perRound = [
  [R('alex', 'Alex', 36), R('daz', 'Daz', 34), R('sam', 'Sam', 40)],
  [R('alex', 'Alex', 22, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]), R('daz', 'Daz', 17), R('sam', 'Sam', 12)],
]
const ids = ['r1', 'r2']

test('no finished-early round: the input is returned untouched (normal events behave exactly as before)', () => {
  const a = adjustForEarlyFinish(perRound, ids, new Map())
  assert.equal(a.results, perRound); assert.deepEqual(a.notRanked, []); assert.deepEqual(a.excludedRoundIds, [])
  const b = adjustForEarlyFinish(perRound, ids, info({ id: 'other' }))
  assert.equal(b.results, perRound)
})

test('default: a finished-early round is EXCLUDED from the championship; its scores are not used at all', () => {
  const e = info({}, [q('alex', 18, 22, 11), q('daz', 17), inc('sam', 12, 6)])
  assert.equal(e.get('r2')!.countsTowardEvent, false)
  const a = adjustForEarlyFinish(perRound, ids, e)
  assert.deepEqual(a.excludedRoundIds, ['r2']); assert.deepEqual(a.results[1], []); assert.deepEqual(a.notRanked, [])
  const standings = computeCumulativeStandings(a.results)
  assert.deepEqual(standings.map(s => [s.playerId, s.totalPoints]), [['sam', 40], ['alex', 36], ['daz', 34]])
})

test('inclusion must be a literal true (missing/garbage never includes a round)', () => {
  for (const v of [undefined, null, 'true', 1, 'yes']) assert.equal(info({ counts_toward_event: v }).get('r2')!.countsTowardEvent, false, String(v))
  assert.equal(info({ counts_toward_event: true }).get('r2')!.countsTowardEvent, true)
})

test('included: qualifying players count on OFFICIAL points (11-hole player counts the first nine only)', () => {
  const e = info({ counts_toward_event: true }, [q('alex', 18, 22, 11), q('daz', 17), inc('sam', 12, 6)])
  const a = adjustForEarlyFinish(perRound, ids, e)
  assert.deepEqual(a.countedEarlyRoundIds, ['r2'])
  assert.deepEqual(a.results[1].map(r => [r.playerId, r.roundPoints]), [['alex', 18], ['daz', 17]])
  const standings = computeCumulativeStandings(a.results)
  assert.deepEqual(standings.map(s => [s.playerId, s.totalPoints]), [['alex', 54], ['daz', 51]])
  assert.deepEqual(determineChampions(standings).map(c => c.playerId), ['alex'])
})

test('included: an incomplete player is NOT ranked and NOT zeroed; actual points are kept in a separate list', () => {
  const e = info({ counts_toward_event: true }, [q('alex', 18, 22, 11), q('daz', 17), inc('sam', 12, 6)])
  const a = adjustForEarlyFinish(perRound, ids, e)
  assert.deepEqual(a.notRanked, [{ playerId: 'sam', playerName: 'Sam', totalPoints: 52, incompleteRoundIds: ['r2'] }])
  const standings = computeCumulativeStandings(a.results)
  assert.ok(!standings.some(s => s.playerId === 'sam'), 'Sam is not ranked at all, even though his Round 1 total is the best')
  assert.equal(a.results[0].some(r => r.playerId === 'sam'), false)
  assert.ok(a.notRanked[0].totalPoints > 0, 'never a zero')
})

test('a genuine qualifying zero stays a ranked zero, distinct from an incomplete result', () => {
  const e = info({ counts_toward_event: true }, [q('alex', 18), q('daz', 0), inc('sam', 12, 6)])
  const a = adjustForEarlyFinish(perRound, ids, e)
  assert.deepEqual(a.results[1].map(r => [r.playerId, r.roundPoints]), [['alex', 18], ['daz', 0]])
  assert.equal(a.notRanked.some(n => n.playerId === 'daz'), false)
  assert.equal(a.notRanked.some(n => n.playerId === 'sam'), true)
})

test('a player with no snapshot row for an included round is treated as incomplete (never given points)', () => {
  const e = info({ counts_toward_event: true }, [q('alex', 18), q('daz', 17)])
  assert.deepEqual(adjustForEarlyFinish(perRound, ids, e).notRanked.map(n => n.playerId), ['sam'])
})

test('the input arrays are never mutated', () => {
  const copy = JSON.stringify(perRound)
  adjustForEarlyFinish(perRound, ids, info({ counts_toward_event: true }, [q('alex', 18), inc('daz', 5, 4), inc('sam', 12, 6)]))
  assert.equal(JSON.stringify(perRound), copy)
})

test('round competition results: qualifying only on official points; incomplete never wins; no official result = no winner', () => {
  const e = info({}, [q('alex', 18, 22, 11), q('daz', 17), inc('sam', 12, 6)])
  const res = roundCompetitionResults(perRound[1], e.get('r2'))
  assert.deepEqual(res.map(r => [r.playerId, r.roundPoints]), [['alex', 18], ['daz', 17]])
  assert.deepEqual(determineRoundWinners(res).map(w => w.playerId), ['alex'])
  assert.deepEqual(roundCompetitionResults(perRound[1], info({ official_holes: null }, []).get('r2')), [])
  assert.equal(roundCompetitionResults(perRound[0], undefined), perRound[0], 'a normal round is returned as is')
})

test('labels: Round Finished Early, Official 9-Hole Result, Not Counted Toward Event Championship', () => {
  assert.deepEqual(earlyLabels(info().get('r2')!), { title: 'Round Finished Early — Weather', result: 'Official 9-Hole Result', counting: 'Not Counted Toward Event Championship' })
  assert.equal(earlyLabels(info({ official_holes: null, closed_early_reason: 'safety' }).get('r2')!).result, 'Not an official result')
  assert.equal(earlyLabels(info({ counts_toward_event: true }).get('r2')!).counting, 'Counts Toward Event Championship')
})

test('loading is tolerant: errors, throws and an unmigrated database all read as "no early rounds"', async () => {
  const failing = { from: () => ({ select: () => ({ in: () => ({ eq: async () => ({ data: null, error: { code: '42703' } }) }) }) }) }
  assert.equal((await loadEarlyFinish(failing, ['r1'])).size, 0)
  assert.equal((await loadEarlyFinish({ from: () => { throw new Error('x') } }, ['r1'])).size, 0)
  assert.equal((await loadEarlyFinish(failing, [])).size, 0)
})

test('notes are trimmed, collapsed and capped', () => { assert.equal(normaliseEarlyNote('  a   b '), 'a b'); assert.equal(normaliseEarlyNote('x'.repeat(500))!.length, 200); assert.equal(normaliseEarlyNote(3), null) })
