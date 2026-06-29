import type { Database, TripStatus, TripRole, ScoringFormat, RoundStatus } from './database'

type Tables = Database['public']['Tables']

export type Profile    = Tables['profiles']['Row']
export type Trip       = Tables['trips']['Row']
export type TripMember = Tables['trip_members']['Row']
export type Round      = Tables['rounds']['Row']

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
  draft:     'text-slate-500     bg-slate-100',
  open:      'text-blue-600      bg-blue-50',
  ready:     'text-violet-600    bg-violet-50',
  live:      'text-green-600     bg-green-50',
  completed: 'text-brand-600     bg-brand-50',
  archived:  'text-gray-500      bg-gray-100',
}

export const TRIP_STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft:     ['open', 'archived'],
  open:      ['ready', 'draft', 'archived'],
  ready:     ['live', 'open', 'archived'],
  live:      ['completed'],
  completed: ['archived'],
  archived:  [],
}

// ─── Event types ──────────────────────────────────────────────────────────────

export const EVENT_TYPE_OPTIONS = [
  { value: 'golf_trip',     label: 'Golf Trip' },
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
}

// ─── Trip detail (server-fetched) ─────────────────────────────────────────────

export interface TripMemberWithProfile extends TripMember {
  profiles: {
    id: string
    full_name: string
    avatar_url: string | null
    email?: string
  } | null
}

export interface TripDetail extends Trip {
  trip_members: TripMemberWithProfile[]
  rounds: Round[]
}

// ─── Wizard types ─────────────────────────────────────────────────────────────

export interface WizardTripDetails {
  name: string
  event_type: EventType
  location: string
  start_date: string
  end_date: string
  description: string
}

export interface WizardRound {
  id: string
  name: string
  course_name: string
  play_date: string
  tee_time: string
  holes: 9 | 18
  scoring_format: 'stableford'
}

// ─── Offline queue ────────────────────────────────────────────────────────────

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

export interface OfflineScoreEntry {
  clientId: string
  scorecardId: string
  holeId: string
  grossScore: number
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

export type { TripStatus, TripRole, ScoringFormat, RoundStatus }
