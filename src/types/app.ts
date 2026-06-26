// ─────────────────────────────────────────────────────────────────────────────
// TEEIN' IT UP — APP TYPES
// Application-level types derived from database types.
// These shape data for UI consumption.
// ─────────────────────────────────────────────────────────────────────────────

import type { Database, TripStatus, TripRole, ScoringFormat, RoundStatus } from './database'

// ─── Row shorthand ────────────────────────────────────────────────────────────
type Tables = Database['public']['Tables']

export type Profile       = Tables['profiles']['Row']
export type Trip          = Tables['trips']['Row']
export type TripMember    = Tables['trip_members']['Row']
export type Round         = Tables['rounds']['Row']
export type Hole          = Tables['holes']['Row']
export type Scorecard     = Tables['scorecards']['Row']
export type ScoreEntry    = Tables['score_entries']['Row']
export type SideComp      = Tables['side_comps']['Row']
export type SideCompResult = Tables['side_comp_results']['Row']
export type TripPhoto     = Tables['trip_photos']['Row']
export type MemoryPack    = Tables['memory_packs']['Row']

// ─── Enriched types for UI ────────────────────────────────────────────────────

/** Trip card shown on My Trips dashboard */
export interface TripSummary {
  id: string
  name: string
  description: string | null
  start_date: string
  end_date: string
  status: TripStatus
  logo_url: string | null
  cover_image_url: string | null
  invite_code: string
  /** The current user's role on this trip */
  user_role: TripRole
  /** Number of confirmed players */
  player_count: number
  /** Number of rounds in the trip */
  round_count: number
}

/** Full trip detail with all relations */
export interface TripDetail extends Trip {
  members: TripMemberWithProfile[]
  rounds: Round[]
}

/** Trip member with their profile data joined */
export interface TripMemberWithProfile extends TripMember {
  profile: Profile
}

/** Leaderboard row from the DB view */
export interface LeaderboardRow {
  round_id: string
  player_id: string
  full_name: string
  playing_handicap: number
  total_stableford_pts: number
  holes_played: number
  rank: number
}

// ─── Auth types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  profile: Profile | null
}

// ─── Trip status helpers ──────────────────────────────────────────────────────

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft:     'Draft',
  open:      'Open for Invitations',
  ready:     'Ready',
  live:      'Live',
  completed: 'Completed',
  archived:  'Archived',
}

export const TRIP_STATUS_COLORS: Record<TripStatus, string> = {
  draft:     'text-status-draft     bg-slate-100',
  open:      'text-status-open      bg-blue-50',
  ready:     'text-status-ready     bg-violet-50',
  live:      'text-status-live      bg-green-50',
  completed: 'text-status-completed bg-brand-50',
  archived:  'text-status-archived  bg-gray-100',
}

/** Valid status transitions from any given status */
export const TRIP_STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft:     ['open', 'archived'],
  open:      ['ready', 'draft', 'archived'],
  ready:     ['live', 'open', 'archived'],
  live:      ['completed'],
  completed: ['archived'],
  archived:  [],
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

export const SCORING_FORMAT_LABELS: Record<ScoringFormat, string> = {
  stableford:           'Stableford',
  stroke:               'Stroke Play',
  match_play:           'Match Play / Ryder Cup',
  ambrose:              'Ambrose',
  four_ball_better_ball:'Four Ball Better Ball',
}

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  upcoming:  'Upcoming',
  active:    'Live',
  completed: 'Completed',
}

// ─── Offline queue types ──────────────────────────────────────────────────────

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

export interface OfflineScoreEntry {
  clientId: string         // UUID, idempotency key
  scorecardId: string
  holeId: string
  grossScore: number
  isNoReturn: boolean
  enteredAt: string        // ISO timestamp
  syncStatus: SyncStatus
  retryCount: number
  lastError?: string
}

// ─── API response types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
}

// ─── Trip creation wizard types ───────────────────────────────────────────────

export const EVENT_TYPE_OPTIONS = [
  { value: 'golf_trip',       label: 'Golf Trip' },
  { value: 'corporate_day',   label: 'Corporate Day' },
  { value: 'charity_day',     label: 'Charity Day' },
  { value: 'golf_society',    label: 'Golf Society' },
  { value: 'bucks_weekend',   label: 'Bucks Weekend' },
  { value: 'other',           label: 'Other' },
] as const

export type EventType = typeof EVENT_TYPE_OPTIONS[number]['value']

export interface WizardTripDetails {
  name: string
  event_type: EventType
  location: string
  start_date: string
  end_date: string
  description: string
}

export interface WizardRound {
  id: string          // temp client UUID for list key
  name: string
  course_name: string
  play_date: string
  tee_time: string
  holes: 9 | 18
  scoring_format: 'stableford'
}

export interface WizardState {
  step: 1 | 2 | 3
  tripDetails: WizardTripDetails
  rounds: WizardRound[]
}

// ─── Extended trip summary (Sprint 2) ────────────────────────────────────────

export interface TripSummaryExtended extends TripSummary {
  event_type: string | null
  location: string | null
}
