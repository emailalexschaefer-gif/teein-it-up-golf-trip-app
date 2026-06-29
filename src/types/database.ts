// Auto-generated shape — replace with: npx supabase gen types typescript --local
// after running migrations against your Supabase project.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ─── Enum types ───────────────────────────────────────────────────────────────

export type TripStatus =
  | 'draft'
  | 'open'
  | 'ready'
  | 'live'
  | 'completed'
  | 'archived'

export type TripRole = 'organiser' | 'player'

export type ScoringFormat =
  | 'stableford'
  | 'stroke'
  | 'match_play'
  | 'ambrose'
  | 'four_ball_better_ball'

export type RoundStatus = 'upcoming' | 'active' | 'completed'
export type ScorecardStatus = 'active' | 'completed' | 'withdrawn'
export type SideCompType = 'nearest_pin' | 'longest_drive' | 'best_on_day' | 'custom'

// ─── Database shape ───────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          avatar_url: string | null
          handicap: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string
          avatar_url?: string | null
          handicap?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string
          full_name?: string
          avatar_url?: string | null
          handicap?: number | null
          updated_at?: string
        }
      }
      trips: {
        Row: {
          id: string
          organiser_id: string
          name: string
          description: string | null
          event_type: string | null
          location: string | null
          start_date: string
          end_date: string
          status: TripStatus
          logo_url: string | null
          cover_image_url: string | null
          invite_code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organiser_id: string
          name: string
          description?: string | null
          event_type?: string | null
          location?: string | null
          start_date: string
          end_date: string
          status?: TripStatus
          logo_url?: string | null
          cover_image_url?: string | null
          invite_code?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          event_type?: string | null
          location?: string | null
          start_date?: string
          end_date?: string
          status?: TripStatus
          logo_url?: string | null
          cover_image_url?: string | null
          updated_at?: string
        }
      }
      trip_members: {
        Row: {
          id: string
          trip_id: string
          profile_id: string
          role: TripRole
          nickname: string | null
          team: string | null
          joined_at: string
        }
        Insert: {
          id?: string
          trip_id: string
          profile_id: string
          role?: TripRole
          nickname?: string | null
          team?: string | null
          joined_at?: string
        }
        Update: {
          role?: TripRole
          nickname?: string | null
          team?: string | null
        }
      }
      rounds: {
        Row: {
          id: string
          trip_id: string
          course_id: string | null
          course_name: string | null
          name: string
          play_date: string
          tee_time: string | null
          scoring_format: ScoringFormat
          status: RoundStatus
          holes: 9 | 18
          created_at: string
        }
        Insert: {
          id?: string
          trip_id: string
          course_id?: string | null
          course_name?: string | null
          name: string
          play_date: string
          tee_time?: string | null
          scoring_format?: ScoringFormat
          status?: RoundStatus
          holes?: 9 | 18
          created_at?: string
        }
        Update: {
          name?: string
          course_name?: string | null
          play_date?: string
          tee_time?: string | null
          scoring_format?: ScoringFormat
          status?: RoundStatus
          course_id?: string | null
        }
      }
      score_entries: {
        Row: {
          id: string
          scorecard_id: string
          hole_id: string
          gross_score: number
          stableford_pts: number | null
          is_no_return: boolean
          entered_by: string
          entered_at: string
          client_id: string
        }
        Insert: {
          id?: string
          scorecard_id: string
          hole_id: string
          gross_score: number
          stableford_pts?: number | null
          is_no_return?: boolean
          entered_by: string
          entered_at?: string
          client_id: string
        }
        Update: {
          gross_score?: number
          is_no_return?: boolean
        }
      }
    }
    Views: {
      leaderboard_view: {
        Row: {
          round_id: string
          trip_id: string
          player_id: string
          full_name: string
          playing_handicap: number
          total_stableford_pts: number
          holes_played: number
          rank: number
        }
      }
    }
    Functions: Record<string, unknown>
  }
}
