import type { Database, TripStatus, TripRole, ScoringFormat, RoundStatus } from './database'

type Tables = Database['public']['Tables']

export type Profile    = Tables['profiles']['Row']
export type Trip       = Tables['trips']['Row']
export type TripMember = Tables['trip_members']['Row']
export type TripGroup  = Tables['trip_groups']['Row']
export type Round      = Tables['rounds']['Row']

// ─── Trip status ──────────────────────────────────────────────────────────────

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft:        'Draft',
  open:         'Open for Invitations',
  groups_ready: 'Groups Ready',
  ready:        'Ready to Start',
  live:         'Live Event',
  completed:    'Completed',
  archived:     'Archived',
}

export const TRIP_STATUS_COLORS: Record<TripStatus, string> = {
  draft:        'text-text-muted   bg-cream-200 border-cream-300',
  open:         'text-blue-700     bg-blue-50   border-blue-200',
  groups_ready: 'text-violet-700   bg-violet-50 border-violet-200',
  ready:        'text-amber-700    bg-amber-50  border-amber-200',
  live:         'text-green-700    bg-green-50  border-green-200',
  completed:    'text-brand-700    bg-brand-50  border-brand-200',
  archived:     'text-text-subtle  bg-cream-200 border-cream-300',
}

export const TRIP_STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft:        ['open', 'archived'],
  open:         ['groups_ready', 'draft', 'archived'],
  groups_ready: ['ready', 'open', 'archived'],
  ready:        ['live', 'groups_ready', 'archived'],
  live:         ['completed'],
  completed:    ['archived'],
  archived:     ['completed', 'open', 'draft'],  // restore: inferred from trip data
}

// ─── Event types ──────────────────────────────────────────────────────────────

export const EVENT_TYPE_OPTIONS = [
  { value: 'golf_trip',     label: 'Golf Trip' },
  { value: 'social_golf',   label: 'Social Golf' },
  { value: 'corporate_day', label: 'Corporate Day' },
  { value: 'charity_day',   label: 'Charity Day' },
  { value: 'golf_society',  label: 'Golf Society' },
  { value: 'bucks_weekend', label: 'Bucks Weekend' },
  { value: 'other',         label: 'Other' },
] as const

export type EventType = typeof EVENT_TYPE_OPTIONS[number]['value']

// ─── Dashboard trip summary ───────────────────────────────────────────────────

export interface TripSummary {
  id: string
  name: string
  description: string | null
  event_type: string | null
  location: string | null
  start_date: string
  end_date: string
  status: TripStatus
  logo_url: string | null
  invite_code: string
  user_role: TripRole
  player_count: number
  round_count: number
  group_count: number
  expected_players: number
  players_per_group: number
}

// ─── Trip detail (server-fetched) ─────────────────────────────────────────────

export interface MemberProfile {
  id: string
  full_name: string
  avatar_url: string | null
  email?: string
}

export interface TripMemberWithProfile extends TripMember {
  profiles: MemberProfile | null
}

export interface TripGroupWithMembers extends TripGroup {
  members: TripMemberWithProfile[]
}

// ─── Wizard types ─────────────────────────────────────────────────────────────

export interface WizardTripDetails {
  name: string
  event_type: EventType
  location: string
  start_date: string
  end_date: string
  description: string
  expected_players: number
  players_per_group: number
  organiser_is_playing: boolean
}

// Sprint 9 — Side Competitions + Powerplay, configured per round, at
// setup time, before Begin Round. Corrected model: a round can hold
// MULTIPLE instances of the same competition type (two NTPs on
// different holes, two Powerplay holes) — comp_type is a category, not
// a unique slot. `id` here is a client-generated temporary id (for React
// keys and add/remove in the wizard before the round exists server-side)
// — never sent to the server, which assigns its own row id on insert.
export interface WizardSideComp {
  id: string
  comp_type: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay'
  hole_number: number
}

export interface WizardRound {
  id: string
  name: string
  course_name: string
  play_date: string
  tee_time: string
  holes: 9 | 18
  scoring_format: 'stableford'
  side_comps?: WizardSideComp[]
  // Only present when editing an existing trip (prefilled from trip.rounds
  // — see TripDetailClient.tsx's editUrl construction). Absent entirely
  // for a brand-new round being created for the first time, which is
  // never locked. Drives the "configuration locked once started" UI —
  // the client-side mirror of the DB trigger in migration 037.
  status?: string
}

// ─── Offline queue ────────────────────────────────────────────────────────────

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

export type ScoreCaptureRole = 'self' | 'marker'

export interface OfflineScoreEntry {
  clientId: string
  scorecardId: string
  holeId: string
  /** Which of this scorecard's two independent captures this is — see the
   * self+marker scoring model. Existing single-entry rows are 'self'. */
  captureRole: ScoreCaptureRole
  grossScore: number | null
  isNoReturn: boolean
  enteredAt: string
  syncStatus: SyncStatus
  retryCount: number
  lastError?: string
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export const SCORING_FORMAT_LABELS: Record<ScoringFormat, string> = {
  stableford:            'Stableford',
  stroke:                'Stroke Play',
  match_play:            'Match Play',
  ambrose:               'Ambrose',
  four_ball_better_ball: 'Four Ball Better Ball',
}

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  upcoming:  'Upcoming',
  active:    'Live',
  completed: 'Completed',
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export function groupsRequired(expectedPlayers: number | undefined, playersPerGroup: number | undefined): number {
  const ep = expectedPlayers  ?? 0
  const ppg = playersPerGroup ?? 4
  if (!ep || !ppg || ppg === 0) return 0
  return Math.ceil(ep / ppg)
}

export type { TripStatus, TripRole, ScoringFormat, RoundStatus }
