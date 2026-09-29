import { groupSideCompsByRound, toWizardSideCompPrefill, type SideCompRow } from './sideCompRoundTrip'

export interface RunAgainSourceTrip {
  name: string; event_type: string | null; location: string | null; description: string | null
  expected_players: number | null; players_per_group: number | null; organiser_is_playing: boolean | null
}
export interface RunAgainSourceRound {
  id: string; name: string; course_name: string | null; tee_time: string | null
  holes: number; scoring_format: string; starting_hole_number: number | null
  tee_set_source_id: string | null; tee_name: string | null
  course_rating: number | null; slope_rating: number | null
  library_holes_snapshot: unknown
}

export interface RunAgainPrefillDetails {
  name: string; event_type: string; location: string; start_date: string; end_date: string
  description: string; expected_players: number; players_per_group: number; organiser_is_playing: boolean
}
export interface RunAgainPrefillRound {
  name: string; course_name: string; play_date: string; tee_time: string
  holes: number; scoring_format: string; starting_hole_number: number
  side_comps: { id: string; comp_type: string; hole_number: number }[]
  library_tee_set_id: string | null; tee_name: string | null
  course_rating: number | null; slope_rating: number | null; library_holes_snapshot: unknown
}
export interface RunAgainPrefill { details: RunAgainPrefillDetails; rounds: RunAgainPrefillRound[] }

/**
 * Event Management Phase 2 (10 Sep) -- the pure mapping at the heart
 * of Run Again: source trip + rounds + side_comps -> a wizard prefill
 * payload. Extracted from the route itself so the field classification
 * (what's copied, what's reset, what's never even present) can be
 * tested directly, without a live database. The route's own job is
 * reduced to fetching these three inputs and calling this function --
 * it contains no field-mapping logic of its own to drift out of sync
 * with these tests.
 */
export function buildRunAgainPrefill(trip: RunAgainSourceTrip, rounds: RunAgainSourceRound[], sideCompRows: SideCompRow[]): RunAgainPrefill {
  const sideCompsByRound = groupSideCompsByRound(sideCompRows)
  return {
    details: {
      name: `${trip.name} \u2014 Copy`,
      event_type: trip.event_type ?? 'golf_trip',
      location: trip.location ?? '',
      start_date: '', end_date: '',
      description: trip.description ?? '',
      expected_players: trip.expected_players ?? 0,
      players_per_group: trip.players_per_group ?? 4,
      organiser_is_playing: trip.organiser_is_playing ?? false,
    },
    rounds: rounds.map(r => ({
      name: r.name,
      course_name: r.course_name ?? '',
      play_date: '',
      tee_time: r.tee_time ?? '',
      holes: r.holes,
      scoring_format: r.scoring_format,
      starting_hole_number: r.starting_hole_number ?? 1,
      side_comps: toWizardSideCompPrefill(sideCompsByRound.get(r.id) ?? []),
      library_tee_set_id: r.tee_set_source_id ?? null,
      tee_name: r.tee_name ?? null,
      course_rating: r.course_rating ?? null,
      slope_rating: r.slope_rating ?? null,
      library_holes_snapshot: r.library_holes_snapshot ?? null,
    })),
  }
}
