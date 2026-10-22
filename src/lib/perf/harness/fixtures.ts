// Deterministic fixture data for the route-equivalence tests: one event with
// two rounds (R1 completed, R2 active), a second unrelated event, an
// organiser, players in two groups (one shared-device pair), self + marker
// score entries, an organiser override, side competitions with lead changes
// and a Moment.
import type { Row } from './fakeDb'

export const IDS = {
  trip: 'trip-1', otherTrip: 'trip-2', practiceTrip: 'trip-p',
  r1: 'round-1', r2: 'round-2', rOther: 'round-x', rGroupScorer: 'round-gs',
  org: 'u-org', p1: 'u-p1', p2: 'u-p2', p3: 'u-p3', p4: 'u-p4', stranger: 'u-stranger', solo: 'u-solo',
  g1: 'grp-1', g2: 'grp-2',
} as const

const NAMES: Record<string, string> = {
  [IDS.org]: 'Olive Organiser', [IDS.p1]: 'Pat One', [IDS.p2]: 'Sam Two', [IDS.p3]: 'Kim Three', [IDS.p4]: 'Lee Four', [IDS.solo]: 'Solo Sue',
}

function holesFor(roundId: string, n = 9): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${roundId}-h${i + 1}`, round_id: roundId, hole_number: i + 1,
    par: [4, 4, 3, 5, 4, 4, 3, 4, 5][i % 9], stroke_index: [7, 3, 15, 1, 9, 11, 17, 5, 13][i % 9],
  }))
}

let eid = 0
function entry(roundId: string, hole: number, gross: number, pts: number, role: 'self' | 'marker', by: string, extra: Row = {}): Row {
  return {
    id: `e${++eid}`, hole_id: `${roundId}-h${hole}`, gross_score: gross, stableford_pts: pts, is_no_return: false,
    capture_role: role, entered_by: by, admin_overridden: false, entered_at: `2026-10-20T0${hole % 9}:00:00.000Z`, ...extra,
  }
}

function card(roundId: string, player: string, opts: { id?: string; hcp?: number; status?: string; method?: string; group?: string | null; submittedAt?: string | null; entries: Row[] }): Row {
  return {
    id: opts.id ?? `sc-${roundId}-${player}`, round_id: roundId, player_id: player,
    playing_handicap: opts.hcp ?? 12, status: opts.status ?? 'in_progress', submitted_at: opts.submittedAt ?? null,
    scoring_method: opts.method ?? 'digital', group_id: opts.group ?? null,
    profiles: { id: player, full_name: NAMES[player] ?? 'Player', avatar_url: null },
    score_entries: opts.entries,
  }
}

export function buildTables(): Record<string, Row[]> {
  eid = 0
  const R1 = IDS.r1, R2 = IDS.r2
  const mk = (r: string, p: string, hs: number[], base = 4, role: 'self' | 'marker' = 'self', by = p) =>
    hs.map(h => entry(r, h, base + (h % 2), 2 + (h % 3), role, by))
  return {
    trips: [
      { id: IDS.trip, is_practice: false }, { id: IDS.otherTrip, is_practice: false }, { id: IDS.practiceTrip, is_practice: true },
    ],
    trip_members: [
      { id: 'm1', trip_id: IDS.trip, profile_id: IDS.org, role: 'organiser', group_id: IDS.g1 },
      { id: 'm2', trip_id: IDS.trip, profile_id: IDS.p1, role: 'player', group_id: IDS.g1 },
      { id: 'm3', trip_id: IDS.trip, profile_id: IDS.p2, role: 'player', group_id: IDS.g1 },
      { id: 'm4', trip_id: IDS.trip, profile_id: IDS.p3, role: 'player', group_id: IDS.g2 },
      { id: 'm5', trip_id: IDS.trip, profile_id: IDS.p4, role: 'player', group_id: IDS.g2 },
      { id: 'm6', trip_id: IDS.trip, profile_id: IDS.solo, role: 'player', group_id: null },
      { id: 'm7', trip_id: IDS.otherTrip, profile_id: IDS.stranger, role: 'organiser', group_id: null },
      { id: 'm8', trip_id: IDS.practiceTrip, profile_id: IDS.p1, role: 'organiser', group_id: null },
    ],
    trip_groups: [
      { id: IDS.g1, trip_id: IDS.trip, name: 'Group A', sort_order: 1 },
      { id: IDS.g2, trip_id: IDS.trip, name: 'Group B', sort_order: 2 },
    ],
    rounds: [
      { id: R1, trip_id: IDS.trip, name: 'Round 1', holes: 9, status: 'completed', scoring_format: 'stableford', score_capture_mode: 'self_and_marker', course_name: 'Links', starting_hole_number: 1, play_date: '2026-10-19', created_at: '2026-10-01T00:00:00.000Z' },
      { id: R2, trip_id: IDS.trip, name: 'Round 2', holes: 9, status: 'active', scoring_format: 'stableford', score_capture_mode: 'self_and_marker', course_name: 'Dunes', starting_hole_number: 10, play_date: '2026-10-20', created_at: '2026-10-01T00:00:00.000Z' },
      { id: IDS.rGroupScorer, trip_id: IDS.trip, name: 'Scramble', holes: 9, status: 'active', scoring_format: 'stableford', score_capture_mode: 'group_scorer', course_name: null, starting_hole_number: 1, play_date: '2026-10-21', created_at: '2026-10-02T00:00:00.000Z' },
      { id: IDS.rOther, trip_id: IDS.otherTrip, name: 'Elsewhere', holes: 9, status: 'active', scoring_format: 'stableford', score_capture_mode: 'self_and_marker', course_name: null, starting_hole_number: 1, play_date: '2026-10-20', created_at: '2026-10-01T00:00:00.000Z' },
    ],
    holes: [...holesFor(R1), ...holesFor(R2), ...holesFor(IDS.rGroupScorer), ...holesFor(IDS.rOther)],
    scorecards: [
      // Round 1 (completed)
      card(R1, IDS.p1, { status: 'submitted', group: IDS.g1, entries: mk(R1, IDS.p1, [1, 2, 3, 4, 5, 6, 7, 8, 9], 4) }),
      card(R1, IDS.p2, { status: 'submitted', group: IDS.g1, entries: mk(R1, IDS.p2, [1, 2, 3, 4, 5, 6, 7, 8, 9], 5) }),
      card(R1, IDS.p3, { status: 'submitted', group: IDS.g2, entries: mk(R1, IDS.p3, [1, 2, 3, 4, 5, 6, 7, 8, 9], 4) }),
      // Round 2 (active) — Round 2 starts on the 10th tee
      card(R2, IDS.p1, { group: IDS.g1, entries: [...mk(R2, IDS.p1, [1, 2, 3, 4], 4), entry(R2, 5, 6, 1, 'self', IDS.p1)] }),
      card(R2, IDS.p2, { group: IDS.g1, entries: [...mk(R2, IDS.p2, [1, 2, 3], 5), entry(R2, 1, 4, 3, 'marker', IDS.p1)] }),
      card(R2, IDS.p3, { group: IDS.g2, method: 'digital', entries: mk(R2, IDS.p3, [1, 2], 4) }),
      card(R2, IDS.p4, { group: IDS.g2, method: 'paper', entries: [] }),
      card(R2, IDS.solo, { group: null, entries: mk(R2, IDS.solo, [1], 4) }),
      card(R2, IDS.org, { group: IDS.g1, status: 'withdrawn', entries: [] }),
      // another event's round
      card(IDS.rOther, IDS.stranger, { entries: mk(IDS.rOther, IDS.stranger, [1, 2], 4) }),
    ],
    round_markers: [
      { round_id: R2, player_id: IDS.p1, marker_player_id: IDS.p2 },
      { round_id: R2, player_id: IDS.p2, marker_player_id: IDS.p1 },
      { round_id: IDS.rOther, player_id: IDS.stranger, marker_player_id: IDS.stranger },
    ],
    score_override_audit: [
      { scorecard_id: `sc-${R2}-${IDS.p1}`, hole_id: `${R2}-h5`, old_gross_score: 7, new_gross_score: 6, reason: 'Marker confirmed 6', overridden_at: '2026-10-20T05:00:00.000Z', profiles: { full_name: 'Olive Organiser' } },
      { scorecard_id: `sc-${R2}-${IDS.p1}`, hole_id: `${R2}-h2`, old_gross_score: null, new_gross_score: 4, reason: 'Missed entry', overridden_at: '2026-10-20T06:00:00.000Z', profiles: null },
      { scorecard_id: `sc-${R2}-${IDS.p2}`, hole_id: `${R2}-h1`, old_gross_score: 6, new_gross_score: 4, reason: 'Typo', overridden_at: '2026-10-20T04:00:00.000Z', profiles: { full_name: 'Olive Organiser' } },
    ],
    side_comps: [
      { id: 'sc-ntp', round_id: R2, enabled: true, comp_type: 'nearest_pin', hole_number: 3 },
      { id: 'sc-ld', round_id: R2, enabled: true, comp_type: 'longest_drive', hole_number: 5 },
      { id: 'sc-off', round_id: R2, enabled: false, comp_type: 'nearest_pin', hole_number: 7 },
    ],
    side_comp_lead_changes: [
      { id: 'lc1', side_comp_id: 'sc-ntp', player_id: IDS.p1, result_value: 6, sequence_number: 1, moment_id: 'mo-1', created_at: '2026-10-20T04:10:00.000Z', profiles: { full_name: 'Pat One' } },
      { id: 'lc2', side_comp_id: 'sc-ntp', player_id: IDS.p2, result_value: 4, sequence_number: 2, moment_id: 'mo-1', created_at: '2026-10-20T04:20:00.000Z', profiles: { full_name: 'Sam Two' } },
      { id: 'lc3', side_comp_id: 'sc-ld', player_id: IDS.p3, result_value: 230, sequence_number: 1, moment_id: null, created_at: '2026-10-20T04:30:00.000Z', profiles: { full_name: 'Kim Three' } },
      { id: 'lc4', side_comp_id: 'sc-ld', player_id: IDS.p1, result_value: 240, sequence_number: 2, moment_id: 'mo-missing', created_at: '2026-10-20T04:40:00.000Z', profiles: { full_name: 'Pat One' } },
    ],
    side_comp_entries: [
      { side_comp_id: 'sc-ntp', player_id: IDS.p1, verification_status: 'verified', result_value: 6 },
      { side_comp_id: 'sc-ntp', player_id: IDS.p2, verification_status: 'verified', result_value: 4 },
      { side_comp_id: 'sc-ld', player_id: IDS.p3, verification_status: 'pending', result_value: 230 },
      { side_comp_id: 'sc-ld', player_id: IDS.p1, verification_status: 'verified', result_value: 240 },
    ],
    moments: [{ id: 'mo-1', image_path: 'trip-1/mo-1.jpg' }],
  }
}
