import test from 'node:test'
import assert from 'node:assert/strict'
import { handleTeamStateRead, deriveEntryViews, deriveLeaderboard, viewerMayScore, holesOf, type RawTeamState } from './teamState'

const R = '20000000-0000-0000-0000-000000000001'
function state(nHoles: number, over: Partial<RawTeamState> = {}): RawTeamState {
  const holes = Array.from({ length: nHoles }, (_, i) => ({ id: `h${i + 1}`, hole_number: i + 1, par: 4 }))
  const ent = (id: string, name: string, extra = {}) => ({ id, team_id: 't-' + id, entry_name: name, nominated_scorer_id: `${id}-p1`, scorer_confirmed_at: '2026-10-28T00:00:00Z', handicap_locked_at: null, team_handicap: null, status: 'entered', drive_requirement_waived_at: null, group_id: null, ...extra })
  const full = (entry: string, gross: number) => holes.map(h => ({ entry_id: entry, hole_id: h.id, gross_score: gross, is_no_return: false, nr_treatment: null, revision: 1, admin_overridden: false, drive_player_id: null }))
  return { round: { id: R, trip_id: 't', status: 'active' }, holes, config: { format: 'ambrose_4', team_size: 4, handicap_method: 'weighted_scramble', min_drives_per_player: null },
    entries: [ent('a', 'Alpha'), ent('b', 'Bravo'), ent('c', 'Charlie')],
    members: ['a', 'b', 'c'].flatMap(e => [1, 2, 3, 4].map(n => ({ entry_id: e, player_id: `${e}-p${n}`, position: n }))),
    scores: [...full('a', 4), ...full('b', 4), ...full('c', 5).slice(0, nHoles - 2)], flags: [], teams: [], names: {}, ...over }
}

test('read handler: 401 without a user, 400 for a non-UUID, 404 when RLS hides the round, 503 on failure, 200 with state', async () => {
  const mk = (u: { id: string } | null, load: () => Promise<RawTeamState | null>) => ({ getUser: async () => u, load })
  assert.equal((await handleTeamStateRead(R, mk(null, async () => state(18)))).status, 401)
  assert.equal((await handleTeamStateRead('nope', mk({ id: 'u' }, async () => state(18)))).status, 400)
  assert.equal((await handleTeamStateRead(null, mk({ id: 'u' }, async () => state(18)))).status, 400)
  assert.equal((await handleTeamStateRead(R, mk({ id: 'u' }, async () => null))).status, 404)
  assert.equal((await handleTeamStateRead(R, mk({ id: 'u' }, async () => { throw new Error('db') }))).status, 503)
  const ok = await handleTeamStateRead(R, mk({ id: 'u' }, async () => state(18)))
  assert.equal(ok.status, 200); assert.equal(ok.body.viewerId, 'u')
})
test('eighteen-hole round: 18 holes in order, completion needs all 18, gross is the sum', () => {
  const v = deriveEntryViews(state(18))
  assert.equal(v[0].holes.length, 18); assert.deepEqual(v[0].holes.map(h => h.number), Array.from({ length: 18 }, (_, i) => i + 1))
  assert.equal(v[0].completion.complete, true); assert.equal(v[0].gross, 72)
  assert.equal(v[2].completion.complete, false); assert.equal(v[2].gross, null); assert.equal(v[2].completion.missingHoles, 2)
})
test('nine-hole round: derives 9 from the round, completes at 9, never asks for 18', () => {
  const s = state(9); const v = deriveEntryViews(s)
  assert.equal(v[0].holes.length, 9); assert.equal(v[0].completion.requiredHoles, 9); assert.equal(v[0].completion.complete, true); assert.equal(v[0].gross, 36)
  assert.equal(v[2].completion.missingHoles, 2)
  assert.equal(holesOf(s).length, 9)
})
test('gross leaderboard: complete teams ranked with ties shared, incomplete teams unranked with running gross', () => {
  const lb = deriveLeaderboard(deriveEntryViews(state(18)))
  assert.deepEqual(lb.ranked.map(r => [r.name, r.rank, r.tied, r.gross]), [['Alpha', 1, true, 72], ['Bravo', 1, true, 72]])
  assert.equal(lb.unranked.length, 1); assert.equal(lb.unranked[0].name, 'Charlie'); assert.equal(lb.unranked[0].thru, 16); assert.equal(lb.unranked[0].runningGross, 80)
})
test('No Return, open query and withdrawn teams: never ranked / excluded', () => {
  const s = state(18)
  s.scores[0] = { ...s.scores[0], gross_score: null, is_no_return: true }
  s.flags.push({ id: 'f', entry_id: 'b', hole_id: 'h3', status: 'open' })
  s.entries[2] = { ...s.entries[2], status: 'withdrawn' }
  const v = deriveEntryViews(s)
  assert.equal(v.length, 2)
  const lb = deriveLeaderboard(v)
  assert.equal(lb.ranked.length, 0); assert.equal(lb.unranked.length, 2)
  assert.match(lb.unranked.find(u => u.name === 'Alpha')!.reason, /No Return/); assert.match(lb.unranked.find(u => u.name === 'Bravo')!.reason, /query/)
})
test('viewerMayScore: only the confirmed nominated scorer, and never on a closed round', () => {
  const v = deriveEntryViews(state(18))[0]
  assert.equal(viewerMayScore(v, 'a-p1', 'active').may, true)
  assert.equal(viewerMayScore(v, 'a-p2', 'active').may, false)
  assert.match((viewerMayScore(v, 'a-p1', 'completed') as { message: string }).message, /closed/)
  assert.match((viewerMayScore({ ...v, scorerConfirmed: false }, 'a-p1', 'active') as { message: string }).message, /not confirmed a scorer/)
  assert.equal(viewerMayScore({ ...v, status: 'withdrawn' }, 'a-p1', 'active').may, false)
})
test('viewerMayScore: before the round is active the message says scoring has not started (not "closed")', () => {
  const v = deriveEntryViews(state(18))[0]
  const r = viewerMayScore(v, 'a-p1', 'upcoming') as { may: boolean; message: string }
  assert.equal(r.may, false); assert.match(r.message, /not started/)
})
test('drive shortfall flows through when a minimum is configured', () => {
  const s = state(18, { config: { format: 'ambrose_4', team_size: 4, handicap_method: 'weighted_scramble', min_drives_per_player: 2 } })
  const v = deriveEntryViews(s)[0]
  assert.equal(v.completion.complete, false); assert.equal(v.completion.driveShortfallPlayers.length, 4)
  const waived = deriveEntryViews({ ...s, entries: s.entries.map(e => e.id === 'a' ? { ...e, drive_requirement_waived_at: '2026-10-28T01:00:00Z' } : e) })[0]
  assert.equal(waived.completion.complete, true)
})
import { compareCompletion, type SqlCompletion } from './teamState'
const sqlFor = (v: { completion: { requiredHoles: number; missingHoles: number; unresolvedNoReturns: number; noScoreHoles: number; openFlags: number; driveShortfallPlayers: string[]; complete: boolean } }): SqlCompletion => ({
  required_holes: v.completion.requiredHoles, missing_holes: v.completion.missingHoles, unresolved_no_returns: v.completion.unresolvedNoReturns,
  no_score_holes: v.completion.noScoreHoles, open_flags: v.completion.openFlags, drive_shortfall_players: v.completion.driveShortfallPlayers.length, complete: v.completion.complete })
test('completion cross-check: agreement leaves the TypeScript result; no database answer = not checked (null)', () => {
  const s = state(18); const v = deriveEntryViews(s)
  assert.equal(v[0].completionMismatch, null)
  const checked = deriveEntryViews({ ...s, sqlCompletion: Object.fromEntries(v.map(x => [x.entryId, sqlFor(x)])) })
  assert.deepEqual(checked.map(x => x.completionMismatch), [[], [], []]); assert.equal(checked[0].completion.complete, true)
})
test('completion cross-check FAILS SAFE: a database that says "complete" when TypeScript says not (the No Score case) makes the team not complete', () => {
  const s = state(18); s.scores[2] = { ...s.scores[2], gross_score: null, is_no_return: true, nr_treatment: 'no_score' }
  const v = deriveEntryViews(s)[0]; assert.equal(v.completion.complete, false)   // TypeScript: a No Score hole is not complete
  const dbSaysComplete: SqlCompletion = { ...sqlFor(v), no_score_holes: 0, complete: true }   // the old, defective SQL answer
  const checked = deriveEntryViews({ ...s, sqlCompletion: { a: dbSaysComplete } })[0]
  assert.deepEqual(checked.completionMismatch, ['no_score_holes', 'complete'])
  assert.equal(checked.completion.complete, false); assert.match(checked.completion.blockers.join(';'), /disagrees with the database/)
  assert.equal(deriveLeaderboard([checked]).ranked.length, 0)
})
test('compareCompletion lists each differing field', () => {
  const v = deriveEntryViews(state(18))[0]
  assert.deepEqual(compareCompletion(v.completion, { ...sqlFor(v), open_flags: 1, missing_holes: 2 }), ['missing_holes', 'open_flags'])
})

test('server-side feature gate: the state read answers 404 when Ambrose is disabled, before any session or data access', async () => {
  let touched = 0
  const r = await handleTeamStateRead('00000000-0000-4000-8000-000000000001', { enabled: () => false, getUser: async () => { touched++; return { id: 'u' } }, load: async () => { touched++; return null } })
  assert.equal(r.status, 404); assert.equal(touched, 0)
})

test('per-event production gate on the state read: a refused event looks exactly like a missing round', async () => {
  const state = { round: { id: 'r', trip_id: 'T-ok', status: 'upcoming' } } as never
  const mk = (tripId: string, allowed: (t: string) => boolean) => handleTeamStateRead('00000000-0000-4000-8000-000000000001', {
    getUser: async () => ({ id: 'u' }), load: async () => ({ ...(state as object), round: { id: 'r', trip_id: tripId, status: 'upcoming' } }) as never, tripAllowed: allowed })
  assert.equal((await mk('T-ok', t => t === 'T-ok')).status, 200)
  const no = await mk('T-other', t => t === 'T-ok')
  assert.equal(no.status, 404); assert.equal((no.body as { error: string }).error, 'Round not found')
})
