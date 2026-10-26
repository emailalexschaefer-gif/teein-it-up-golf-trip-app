// Package 2 -- between-round management: arrangements, handicap release, notifications.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveRoundHandicap, diffArrangements, sameArrangements, initialReleaseMessage, revisionMessages, isValidRoundHandicap,
  ROUND_HANDICAP_TECHNICAL_LIMIT, type ArrangementRow,
} from './arrangements'
import { loadLiveArrangements } from './liveArrangements'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const row = (player: string, group: string, o: Partial<ArrangementRow> = {}): ArrangementRow => ({
  player_id: player, group_id: group, group_name: group.toUpperCase(), tee_time: '08:00', starting_hole: 1, playing_handicap: 10, ...o,
})

// ── handicap resolution: one calculation, organiser allocation wins ───────────
test('resolveRoundHandicap: organiser allocation wins over profile, event and slope-derived values', () => {
  assert.equal(resolveRoundHandicap({ override: 14, tripHandicap: 9, profileHandicap: 12.4, slopeRating: 138 }), 14)
  assert.equal(resolveRoundHandicap({ override: 14.4, tripHandicap: null, profileHandicap: 12.4, slopeRating: null }), 14)
})
test('resolveRoundHandicap: no allocation -> Daily Handicap from the round slope; no slope -> GA handicap; none -> null', () => {
  assert.equal(resolveRoundHandicap({ tripHandicap: null, profileHandicap: 8.8, slopeRating: 138 }), 11) // 8.8 x 138 / 113 = 10.75 -> 11
  assert.equal(resolveRoundHandicap({ tripHandicap: null, profileHandicap: 8.8, slopeRating: null }), 9)
  assert.equal(resolveRoundHandicap({ tripHandicap: 5, profileHandicap: 8.8, slopeRating: null }), 5)
  assert.equal(resolveRoundHandicap({ tripHandicap: null, profileHandicap: null, slopeRating: 120 }), null)
})
test('handicap guard: no golf range -- plus handicaps and Course Handicaps above 54 are accepted; only non-numbers refused', () => {
  for (const ok of [-4, -2, 0, 18, 36, 54, 74, -15, ROUND_HANDICAP_TECHNICAL_LIMIT, -ROUND_HANDICAP_TECHNICAL_LIMIT]) assert.equal(isValidRoundHandicap(ok), true, String(ok))
  for (const bad of [ROUND_HANDICAP_TECHNICAL_LIMIT + 1, NaN, Infinity, -Infinity, '12', null, undefined]) assert.equal(isValidRoundHandicap(bad), false)
})
test('plus handicaps are resolved and kept as negative numbers, never sign-flipped or clamped', () => {
  assert.equal(resolveRoundHandicap({ override: -4, tripHandicap: 10, profileHandicap: 10, slopeRating: 130 }), -4)
  assert.equal(resolveRoundHandicap({ override: -2, tripHandicap: null, profileHandicap: null, slopeRating: null }), -2)
  assert.equal(resolveRoundHandicap({ override: 0, tripHandicap: 10, profileHandicap: 10, slopeRating: 130 }), 0)
  assert.equal(resolveRoundHandicap({ override: 74, tripHandicap: null, profileHandicap: null, slopeRating: null }), 74)
  assert.equal(resolveRoundHandicap({ tripHandicap: null, profileHandicap: -2, slopeRating: null }), -2)
})

// ── diff / notification targeting ─────────────────────────────────────────────
test('diff: moving a player changes that player; unaffected players in untouched groups are not listed', () => {
  const prev = [row('a', 'g1'), row('b', 'g1'), row('c', 'g2'), row('d', 'g2')]
  const next = [row('a', 'g1'), row('b', 'g2'), row('c', 'g2'), row('d', 'g2')]
  const ids = diffArrangements(prev, next).map(c => c.player_id).sort()
  // b moved; a lost a partner; c and d gained one. Nobody else exists, so all four are genuinely affected here:
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
  const three = [...prev, row('e', 'g3')]
  const changed = diffArrangements(three, [...next, row('e', 'g3')]).map(c => c.player_id)
  assert.ok(!changed.includes('e'), 'a player in an untouched group is not notified')
})
test('diff: handicap-only, tee-time-only and start-hole-only changes are reported precisely', () => {
  const prev = [row('a', 'g1')]
  assert.deepEqual(diffArrangements(prev, [row('a', 'g1', { playing_handicap: 12 })]), [{ player_id: 'a', changes: ['handicap'] }])
  assert.deepEqual(diffArrangements(prev, [row('a', 'g1', { tee_time: '09:10' })]), [{ player_id: 'a', changes: ['tee_time'] }])
  assert.deepEqual(diffArrangements(prev, [row('a', 'g1', { starting_hole: 10 })]), [{ player_id: 'a', changes: ['starting_hole'] }])
  assert.deepEqual(diffArrangements(prev, prev), [])
})
test('sameArrangements: identical set is the same (idempotent re-release); different size or member is not', () => {
  const a = [row('a', 'g1'), row('b', 'g1')]
  assert.equal(sameArrangements(a, [...a].reverse()), true)
  assert.equal(sameArrangements(a, [row('a', 'g1')]), false)
  assert.equal(sameArrangements(a, [row('a', 'g1'), row('z', 'g1')]), false)
})
test('messages: initial release is ONE event-wide announcement with the approved wording; re-release is per affected player only', () => {
  const m = initialReleaseMessage('Round 2')
  assert.equal(m.message_type, 'announcement'); assert.equal(m.recipient_type, 'all'); assert.equal(m.recipient_user_id, null)
  assert.equal(m.message, '⛳ Round 2 arrangements are ready!\n\nYour playing group, tee time and updated playing handicap are now available.\n\nView your arrangements in the Event Lobby.')
  const msgs = revisionMessages('Round 2', [{ player_id: 'a', changes: ['group', 'handicap'] }, { player_id: 'b', changes: ['tee_time'] }])
  assert.equal(msgs.length, 2)
  assert.ok(msgs.every(x => x.message_type === 'player_notification' && x.recipient_type === 'player'))
  assert.match(msgs[0].message, /playing group and playing handicap have been updated/)
  assert.match(msgs[1].message, /tee time has been updated/)
  assert.deepEqual(revisionMessages('Round 2', []), [])
})

// ── loader against a fake database ────────────────────────────────────────────
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
  return { from } as unknown as Parameters<typeof loadLiveArrangements>[0]
}
const fixture = (): Tables => ({
  trips: [{ id: 't', organiser_is_playing: true }],
  trip_members: [
    { trip_id: 't', profile_id: 'darren', role: 'organiser', group_id: 'g1', playing_handicap: null, profiles: { handicap: 10, full_name: 'Darren' } },
    { trip_id: 't', profile_id: 'marty', role: 'player', group_id: 'g1', playing_handicap: null, profiles: { handicap: 18.2, full_name: 'Marty' } },
    { trip_id: 't', profile_id: 'sam', role: 'player', group_id: 'g2', playing_handicap: 6, profiles: { handicap: 6, full_name: 'Sam' } },
  ],
  trip_groups: [{ trip_id: 't', id: 'g1', name: 'Group 1', tee_time: '07:30' }, { trip_id: 't', id: 'g2', name: 'Group 2', tee_time: null }],
  round_group_tee_times: [{ round_id: 'r2', group_id: 'g2', tee_time: '08:20' }],
  round_group_starting_holes: [],
})
const round = (o = {}) => ({ id: 'r2', name: 'Round 2', status: 'upcoming', start_type: 'standard', starting_hole_number: 1, slope_rating: null, ...o })

test('loader: Lappen scenario -- Round 2 allocation differs from profile; round-specific tee time beats group tee time', async () => {
  const live = await loadLiveArrangements(fakeAdmin(fixture()), 't', round(), { marty: 24, darren: 12 })
  assert.deepEqual(live.problems, [])
  const by = Object.fromEntries(live.rows.map(r => [r.player_id, r]))
  assert.equal(by.marty.playing_handicap, 24, "Darren's allocation, not the profile's 18")
  assert.equal(by.darren.playing_handicap, 12)
  assert.equal(by.sam.playing_handicap, 6, 'no allocation -> existing resolution unchanged')
  assert.equal(by.sam.tee_time, '08:20'); assert.equal(by.marty.tee_time, '07:30')
  assert.equal(by.sam.group_name, 'Group 2'); assert.equal(by.marty.starting_hole, 1)
})
test('loader: back-nine standard start uses hole 10; shotgun uses each group\'s own hole and blocks until all set', async () => {
  const back = await loadLiveArrangements(fakeAdmin(fixture()), 't', round({ starting_hole_number: 10 }))
  assert.ok(back.rows.every(r => r.starting_hole === 10))
  const t = fixture(); t.round_group_starting_holes = [{ round_id: 'r2', group_id: 'g1', starting_hole: 4 }]
  const partial = await loadLiveArrangements(fakeAdmin(t), 't', round({ start_type: 'shotgun' }))
  assert.ok(partial.problems.some(p => /starting hole/.test(p)))
  t.round_group_starting_holes.push({ round_id: 'r2', group_id: 'g2', starting_hole: 13 })
  const full = await loadLiveArrangements(fakeAdmin(t), 't', round({ start_type: 'shotgun' }))
  assert.deepEqual(full.problems, [])
  assert.equal(full.rows.find(r => r.player_id === 'sam')!.starting_hole, 13)
  assert.equal(full.rows.find(r => r.player_id === 'marty')!.starting_hole, 4)
})
test('loader: an unassigned player, a missing handicap or a missing tee time blocks release with a specific reason (no defaults invented)', async () => {
  const t = fixture(); t.trip_members[1].group_id = null; t.trip_members[2].profiles = { handicap: null, full_name: 'Sam' }; t.trip_members[2].playing_handicap = null; t.round_group_tee_times = []
  const live = await loadLiveArrangements(fakeAdmin(t), 't', round())
  assert.ok(live.problems.some(p => /assigned to a group/.test(p)))
  assert.ok(live.problems.some(p => /handicap/.test(p)))
  assert.ok(live.problems.some(p => /tee time/.test(p)))
})
test('loader: players of another event never appear (query is scoped to the trip)', async () => {
  const t = fixture(); t.trip_members.push({ trip_id: 'OTHER', profile_id: 'intruder', role: 'player', group_id: 'g1', playing_handicap: 1, profiles: { handicap: 1, full_name: 'Intruder' } })
  const live = await loadLiveArrangements(fakeAdmin(t), 't', round())
  assert.ok(!live.rows.some(r => r.player_id === 'intruder'))
})
test('release -> profile handicap change -> start: the released allocation is what the snapshot (and Start) keep', async () => {
  const t = fixture()
  const first = await loadLiveArrangements(fakeAdmin(t), 't', round(), { marty: 24 })
  const snapshot = first.rows
  // Profile handicap changes after release (e.g. an updated GA handicap): held allocations keep the live view equal to the snapshot.
  ;(t.trip_members[1].profiles as { handicap: number }).handicap = 30
  const held = await loadLiveArrangements(fakeAdmin(t), 't', round(), Object.fromEntries(snapshot.map(r => [r.player_id, r.playing_handicap])))
  assert.equal(sameArrangements(snapshot, held.rows), true)
  assert.equal(snapshot.find(r => r.player_id === 'marty')!.playing_handicap, 24)
  // Organiser edits a group after release without re-releasing: Start's guard sees the difference.
  t.trip_members[1].group_id = 'g2'
  const edited = await loadLiveArrangements(fakeAdmin(t), 't', round(), Object.fromEntries(snapshot.map(r => [r.player_id, r.playing_handicap])))
  assert.equal(sameArrangements(snapshot, edited.rows), false)
  assert.ok(diffArrangements(snapshot, edited.rows).some(c => c.player_id === 'marty' && c.changes.includes('group')))
})

// ── source pins: behaviour that must never regress ────────────────────────────
const release = read('src/app/api/trips/[tripId]/rounds/[roundId]/release/route.ts')
const start = read('src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts')
const arrangements = read('src/app/api/trips/[tripId]/rounds/[roundId]/arrangements/route.ts')
const migration = read('supabase/migrations/101_round_arrangements_release.sql')

test('release route: organiser-only, never starts the round or creates scorecards, never touches profile/event handicaps', () => {
  assert.match(release, /role !== 'organiser'/)
  assert.doesNotMatch(release, /from\('scorecards'\)/)
  assert.doesNotMatch(release, /update\(\{[^}]*status/)
  assert.doesNotMatch(release, /from\('profiles'\)|from\('trip_members'\)\s*\.(update|upsert|insert)/)
  assert.match(release, /rpc\('release_round_arrangements'/)
  assert.match(release, /status === 'active'/)       // live rounds are protected
  assert.match(release, /status === 'cancelled'/)    // cancelled rounds never release
  assert.match(release, /unchanged: true/)           // repeated release sends nothing
  assert.match(release, /revision_conflict/)         // racing releases rejected
  assert.match(release, /migration_missing/)         // clear failure, not a silent half-feature
})
test('start route: released snapshot is authoritative for handicaps; stale release blocks start; one shared handicap calculation', () => {
  assert.match(start, /releasedHandicap\.get\(m\.profile_id\)/)
  assert.match(start, /arrangements_changed/)
  assert.match(start, /resolveRoundHandicap\(/)
  assert.doesNotMatch(start, /calculateDailyHandicap\(/)   // no second, competing calculation
  assert.match(start, /ROUND_NOT_UPCOMING|status === 'active'/) // double-start protection retained
})
test('player endpoint: members of THIS event only, snapshot only, round must belong to the trip', () => {
  assert.match(arrangements, /from\('trip_members'\)[\s\S]*eq\('trip_id', tripId\)[\s\S]*eq\('profile_id', user\.id\)/)
  assert.match(arrangements, /\.eq\('id', roundId\)\.eq\('trip_id', tripId\)/)
  assert.match(arrangements, /from\('round_arrangements'\)/)
  assert.doesNotMatch(arrangements, /from\('trip_members'\)\.select\([^)]*handicap/)
  assert.doesNotMatch(arrangements, /profiles\?\.handicap|from\('profiles'\)\.select\([^)]*handicap/)
})
test('migration 101: additive, idempotent, no write policies, function locked to service_role, independent of 100', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.round_arrangements/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS release_revision/)
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/)
  assert.match(migration, /FOR UPDATE;/) // row lock inside the function
  assert.match(migration, /ROW_NOT_IN_EVENT/); assert.match(migration, /NOT_ORGANISER/)
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /100_|finish|closed_early/i)
  assert.ok(existsSync(join(ROOT, 'supabase/tests/101_release_round_arrangements.test.sql')))
})
test('lobby: released arrangements show the ROUND handicap from the snapshot; the next released round is shown between rounds', () => {
  const grid = read('src/components/scoring/StartingGrid.tsx')
  const released = grid.slice(grid.indexOf('if (arr?.released'), grid.indexOf('const byGroup'))
  assert.match(released, /Playing handicap/); assert.match(released, /playing_handicap/)
  assert.doesNotMatch(released, /profiles\?\.handicap/)           // never the profile handicap
  assert.match(released, /Released \\u00B7 Awaiting start/)
  assert.match(grid, /\/arrangements`/); assert.match(grid, /visibilitychange/) // refreshes without reinstall / rejoin
  const home = read('src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx')
  assert.match(home, /const arrangementsRound = activeRound \?\? \(upcomingRound\?\.setup_released \? upcomingRound : focusRound\)/)
  assert.match(home, /roundId=\{arrangementsRound\.id\}/)
})
test('organiser window: sends resolved handicaps with release, restores released handicaps on reopen, blocks Start over unreleased changes', () => {
  const modal = read('src/components/scoring/BeginRoundModal.tsx')
  assert.match(modal, /body: JSON\.stringify\(\{ announceLegacy, handicaps:/)
  assert.match(modal, /setHandicapOverrides\(Object\.fromEntries\(data\.snapshot/)
  assert.match(modal, /Confirm & Re-release to Players/)
  assert.match(modal, /if \(unreleasedChangeCount > 0\)/)
  assert.match(modal, /Released to Players \(version/)
})
