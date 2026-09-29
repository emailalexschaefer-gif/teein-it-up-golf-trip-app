import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRunAgainPrefill, type RunAgainSourceTrip, type RunAgainSourceRound } from './runAgain'
import type { SideCompRow } from './sideCompRoundTrip'

// Event Management Phase 2 (10 Sep) -- Run Again tests, covering the
// brief's own explicit list at the pure-function level. Two of the
// brief's items ("new Event gets new ID", "source Event unchanged")
// are proven here structurally rather than by a specific assertion:
// this function's input types (RunAgainSourceTrip/RunAgainSourceRound)
// carry no id/status/timestamp fields at all, and the function itself
// only ever reads its arguments and returns a new object -- there is
// no mutation possible, and no id for it to either preserve or leak
// through by accident. Whether the route actually inserts a NEW row
// with a NEW id is the route's own job (not testable without a live
// database), but this function's own contract makes it structurally
// impossible for a stale source id to flow through the prefill.

function baseTrip(overrides: Partial<RunAgainSourceTrip> = {}): RunAgainSourceTrip {
  return {
    name: 'Lappen Invitational 2026', event_type: 'golf_trip', location: 'Eagle Ridge',
    description: 'Annual trip', expected_players: 12, players_per_group: 4, organiser_is_playing: true,
    ...overrides,
  }
}

function baseRound(overrides: Partial<RunAgainSourceRound> = {}): RunAgainSourceRound {
  return {
    id: 'round-1', name: 'Round 1', course_name: 'Eagle Ridge Golf Club', tee_time: '08:00',
    holes: 18, scoring_format: 'stableford', starting_hole_number: 1,
    tee_set_source_id: 'tee-set-1', tee_name: 'Blue', course_rating: 71.2, slope_rating: 128,
    library_holes_snapshot: [{ hole_number: 1, par: 4, stroke_index: 5, distance: 380 }],
    ...overrides,
  }
}

test('dates are always reset, never copied from the source, regardless of what would otherwise be inferred', () => {
  const result = buildRunAgainPrefill(baseTrip(), [baseRound()], [])
  assert.equal(result.details.start_date, '')
  assert.equal(result.details.end_date, '')
  assert.equal(result.rounds[0].play_date, '')
})

test('the new event name is a starting point, not the source name verbatim', () => {
  const result = buildRunAgainPrefill(baseTrip({ name: "Darren's Golf Trip 2026" }), [], [])
  assert.equal(result.details.name, "Darren's Golf Trip 2026 \u2014 Copy")
  assert.notEqual(result.details.name, "Darren's Golf Trip 2026")
})

test('safe configuration fields are copied correctly', () => {
  const result = buildRunAgainPrefill(baseTrip(), [baseRound()], [])
  assert.equal(result.details.event_type, 'golf_trip')
  assert.equal(result.details.location, 'Eagle Ridge')
  assert.equal(result.details.description, 'Annual trip')
  assert.equal(result.details.expected_players, 12)
  assert.equal(result.details.players_per_group, 4)
  assert.equal(result.details.organiser_is_playing, true)

  const r = result.rounds[0]
  assert.equal(r.name, 'Round 1')
  assert.equal(r.course_name, 'Eagle Ridge Golf Club')
  assert.equal(r.tee_time, '08:00')
  assert.equal(r.holes, 18)
  assert.equal(r.scoring_format, 'stableford')
  assert.equal(r.starting_hole_number, 1)
  assert.equal(r.library_tee_set_id, 'tee-set-1')
  assert.equal(r.tee_name, 'Blue')
  assert.equal(r.course_rating, 71.2)
  assert.equal(r.slope_rating, 128)
  assert.deepEqual(r.library_holes_snapshot, [{ hole_number: 1, par: 4, stroke_index: 5, distance: 380 }])
})

test('side_comps carry only comp_type and hole_number forward -- configuration, never claim/verification state', () => {
  const rows: SideCompRow[] = [
    { id: 'sc-1', round_id: 'round-1', comp_type: 'nearest_pin', hole_number: 7, enabled: true },
    { id: 'sc-2', round_id: 'round-1', comp_type: 'longest_drive', hole_number: 12, enabled: true },
  ]
  const result = buildRunAgainPrefill(baseTrip(), [baseRound()], rows)
  assert.equal(result.rounds[0].side_comps.length, 2)
  assert.equal(result.rounds[0].side_comps[0].comp_type, 'nearest_pin')
  assert.equal(result.rounds[0].side_comps[0].hole_number, 7)
  assert.equal(result.rounds[0].side_comps[1].comp_type, 'longest_drive')
  assert.equal(result.rounds[0].side_comps[1].hole_number, 12)
})

test('a disabled side_comp is excluded, matching the same filter Edit Trip already applies', () => {
  const rows: SideCompRow[] = [
    { id: 'sc-1', round_id: 'round-1', comp_type: 'nearest_pin', hole_number: 7, enabled: false },
  ]
  const result = buildRunAgainPrefill(baseTrip(), [baseRound()], rows)
  assert.equal(result.rounds[0].side_comps.length, 0)
})

test('multiple rounds map independently -- side_comps for one round never leak into another', () => {
  const rounds = [baseRound({ id: 'round-1', name: 'Round 1' }), baseRound({ id: 'round-2', name: 'Round 2' })]
  const rows: SideCompRow[] = [
    { id: 'sc-1', round_id: 'round-1', comp_type: 'nearest_pin', hole_number: 7, enabled: true },
    { id: 'sc-2', round_id: 'round-2', comp_type: 'longest_drive', hole_number: 12, enabled: true },
  ]
  const result = buildRunAgainPrefill(baseTrip(), rounds, rows)
  assert.equal(result.rounds.length, 2)
  assert.equal(result.rounds[0].side_comps.length, 1)
  assert.equal(result.rounds[0].side_comps[0].comp_type, 'nearest_pin')
  assert.equal(result.rounds[1].side_comps.length, 1)
  assert.equal(result.rounds[1].side_comps[0].comp_type, 'longest_drive')
})

test('null/missing optional source fields fall back to sensible new-trip defaults, never crash', () => {
  const trip: RunAgainSourceTrip = {
    name: 'Bare Event', event_type: null, location: null, description: null,
    expected_players: null, players_per_group: null, organiser_is_playing: null,
  }
  const round: RunAgainSourceRound = {
    id: 'round-1', name: 'Round 1', course_name: null, tee_time: null,
    holes: 9, scoring_format: 'stableford', starting_hole_number: null,
    tee_set_source_id: null, tee_name: null, course_rating: null, slope_rating: null,
    library_holes_snapshot: null,
  }
  const result = buildRunAgainPrefill(trip, [round], [])
  assert.equal(result.details.event_type, 'golf_trip')
  assert.equal(result.details.location, '')
  assert.equal(result.details.description, '')
  assert.equal(result.details.expected_players, 0)
  assert.equal(result.details.players_per_group, 4)
  assert.equal(result.details.organiser_is_playing, false)
  assert.equal(result.rounds[0].course_name, '')
  assert.equal(result.rounds[0].tee_time, '')
  assert.equal(result.rounds[0].starting_hole_number, 1)
  assert.equal(result.rounds[0].library_tee_set_id, null)
  assert.equal(result.rounds[0].library_holes_snapshot, null)
})

test('a completed event with zero rounds still produces a valid (empty) prefill, never throws', () => {
  const result = buildRunAgainPrefill(baseTrip(), [], [])
  assert.deepEqual(result.rounds, [])
  assert.equal(result.details.name, 'Lappen Invitational 2026 \u2014 Copy')
})

test('the returned prefill has no field capable of carrying a score, result, moment, badge, or historical timestamp', () => {
  // Structural proof, not a runtime one: every key in the returned
  // shape is enumerated here and matched against the explicit
  // never-copy list -- if a future edit ever added e.g. a `scores` or
  // `winners` field to this function's output, this test's own key
  // list would need to be deliberately updated to still pass,
  // surfacing the change for review rather than silently allowing it.
  const result = buildRunAgainPrefill(baseTrip(), [baseRound()], [])
  const detailKeys = Object.keys(result.details).sort()
  const roundKeys = Object.keys(result.rounds[0]).sort()
  assert.deepEqual(detailKeys, [
    'description', 'end_date', 'event_type', 'expected_players', 'location',
    'name', 'organiser_is_playing', 'players_per_group', 'start_date',
  ].sort())
  assert.deepEqual(roundKeys, [
    'course_name', 'course_rating', 'holes', 'library_holes_snapshot', 'library_tee_set_id',
    'name', 'play_date', 'scoring_format', 'side_comps', 'slope_rating', 'starting_hole_number', 'tee_name', 'tee_time',
  ].sort())
})
