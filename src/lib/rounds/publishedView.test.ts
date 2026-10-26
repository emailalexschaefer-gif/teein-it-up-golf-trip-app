// Package 2 -- unpublished arrangements stay private; legacy releases; plus-handicap fidelity through release.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPublishedRows, publishedTeeTimes, publishedStartingHoles } from './publishedView'
import { loadLiveArrangements } from './liveArrangements'
import { pendingChanges, sameArrangements, resolveRoundHandicap, type ArrangementRow } from './arrangements'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

type Tables = Record<string, Record<string, unknown>[]>
function fakeAdmin(t: Tables) {
  const from = (name: string) => {
    let rows = [...(t[name] ?? [])]
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, v: unknown) => { rows = rows.filter(r => r[col] === v); return q },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
    }
    return q
  }
  return { from } as unknown as Parameters<typeof loadPublishedRows>[0]
}

// Round 2 was released as: Player A in Group 2, handicap 18, 9:30. The organiser then starts editing: Group 3, 16, 10:00.
const released = (): ArrangementRow[] => [
  { player_id: 'a', group_id: 'g2', group_name: 'Group 2', tee_time: '09:30', starting_hole: 1, playing_handicap: 18 },
  { player_id: 'b', group_id: 'g2', group_name: 'Group 2', tee_time: '09:30', starting_hole: 1, playing_handicap: -2 }, // plus-2 golfer
]
const db = (o: { status?: string; revision?: number } = {}): Tables => ({
  rounds: [{ id: 'r2', status: o.status ?? 'upcoming', release_revision: o.revision ?? 1 }],
  round_arrangements: released().map(r => ({ round_id: 'r2', ...r })),
  // the organiser's UNPUBLISHED draft
  trips: [{ id: 't', organiser_is_playing: false }],
  trip_members: [
    { trip_id: 't', profile_id: 'a', role: 'player', group_id: 'g3', playing_handicap: 16, profiles: { handicap: 16, full_name: 'A' } },
    { trip_id: 't', profile_id: 'b', role: 'player', group_id: 'g2', playing_handicap: -2, profiles: { handicap: -2, full_name: 'B' } },
  ],
  trip_groups: [{ trip_id: 't', id: 'g2', name: 'Group 2', tee_time: '09:30' }, { trip_id: 't', id: 'g3', name: 'Group 3', tee_time: '10:00' }],
  round_group_tee_times: [{ round_id: 'r2', group_id: 'g3', tee_time: '10:00' }],
  round_group_starting_holes: [],
})

test('closing the editor without re-releasing: player reads still return Group 2 / handicap 18 / 9:30, never the draft', async () => {
  const rows = await loadPublishedRows(fakeAdmin(db()), 'r2')
  assert.ok(rows)
  const a = rows!.find(r => r.player_id === 'a')!
  assert.deepEqual([a.group_name, a.playing_handicap, a.tee_time], ['Group 2', 18, '09:30'])
  assert.deepEqual(publishedTeeTimes(rows!), [{ group_id: 'g2', tee_time: '09:30' }]) // no Group 3 / 10:00 anywhere
  assert.deepEqual(publishedStartingHoles(rows!), [{ group_id: 'g2', starting_hole: 1 }])
  assert.ok(!JSON.stringify(rows).includes('g3') && !JSON.stringify(rows).includes('10:00'))
})
test('the same draft IS detected as unpublished changes (so Start Round refuses it and the organiser is told)', async () => {
  const live = await loadLiveArrangements(fakeAdmin(db()), 't', { id: 'r2', name: 'Round 2', status: 'upcoming', start_type: 'standard', starting_hole_number: 1, slope_rating: null }, { a: 16, b: -2 })
  const snap = released()
  assert.equal(sameArrangements(snap, live.rows), false)
  assert.deepEqual(pendingChanges(snap, live.rows).map(c => c.player_id).sort(), ['a', 'b']) // b's playing partners changed too
})
test('published view applies only to an upcoming round that has been released', async () => {
  assert.equal(await loadPublishedRows(fakeAdmin(db({ revision: 0 })), 'r2'), null)          // legacy / never released: previous behaviour
  assert.equal(await loadPublishedRows(fakeAdmin(db({ status: 'active' })), 'r2'), null)      // started: scorecards take over
  assert.equal(await loadPublishedRows(fakeAdmin(db({ status: 'completed' })), 'r2'), null)   // completed rounds untouched
  assert.equal(await loadPublishedRows(fakeAdmin({ rounds: [] }), 'r2'), null)
})
test('plus-2 golfer: the released value -2 survives the whole path as -2 (never 2, never clamped)', async () => {
  const rows = (await loadPublishedRows(fakeAdmin(db()), 'r2'))!
  assert.equal(rows.find(r => r.player_id === 'b')!.playing_handicap, -2)
  // Start Round's rule: released ?? resolved -- `??` keeps 0 and negatives
  const map = new Map(rows.map(r => [r.player_id, r.playing_handicap]))
  assert.equal(map.get('b') ?? resolveRoundHandicap({ tripHandicap: 99, profileHandicap: 99, slopeRating: null }), -2)
  assert.equal(new Map([['z', 0]]).get('z') ?? 99, 0)
})

// ── every player-facing read is wired to the snapshot (pins) ──────────────────
const API = 'src/app/api/trips/[tripId]/rounds/[roundId]'
test('pins: player-facing routes read the released snapshot', () => {
  assert.match(read(`${API}/group-tee-times/route.ts`), /loadPublishedRows[\s\S]*role !== 'organiser'/)
  assert.match(read(`${API}/starting-holes/route.ts`), /loadPublishedRows[\s\S]*role !== 'organiser'/)
  assert.match(read(`${API}/my-starting-hole/route.ts`), /loadPublishedRows/)
  assert.match(read(`${API}/my-round/route.ts`), /loadPublishedRows[\s\S]*publishedRows/)
  assert.match(read('src/components/trips/EventCountdown.tsx'), /group-tee-times\?published=1/)
  const lobby = read('src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx')
  assert.match(lobby, /arrangements`\)/)
  assert.match(lobby, /publishedRoundId\s*\n?\s*\?/) // live group only used after the snapshot answered 'none' (legacy)
  assert.match(read('src/components/scoring/StartingGrid.tsx'), /arrangements/)
})
test('pins: the organiser editor still reads live drafts (no ?published flag) so drafts stay editable', () => {
  const modal = read('src/components/scoring/BeginRoundModal.tsx')
  assert.doesNotMatch(modal, /group-tee-times\?published/)
  assert.doesNotMatch(modal, /starting-holes\?published/)
})

// ── legacy releases ───────────────────────────────────────────────────────────
test('pins: legacy release conversion is silent by default, opt-in announcement, never starts scoring', () => {
  const route = read(`${API}/release/route.ts`)
  assert.match(route, /legacy = !!round\.setup_released && !wasReleased/)
  assert.match(route, /legacy && !announceLegacy \? \[\]/)
  assert.match(route, /announceLegacy === true/)
  assert.doesNotMatch(route, /from\('scorecards'\)|rpc\('begin_round'|\.update\(/)
  const modal = read('src/components/scoring/BeginRoundModal.tsx')
  assert.match(modal, /legacy-release-note/)
  assert.match(modal, /released before arrangements were saved as versions/)
})
test('pins: Start Round without a snapshot (legacy) keeps the previous behaviour; with a snapshot it uses released handicaps via ??', () => {
  const start = read(`${API}/start/route.ts`)
  assert.match(start, /released \?\? resolveRoundHandicap/)
  assert.match(start, /arrangements_changed/)
})
