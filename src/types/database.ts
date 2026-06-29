// Auto-generated shape — replace with: npx supabase gen types typescript --local
// after running migrations against your Supabase project.
//
// IMPORTANT: This file must contain EVERY table defined in supabase/migrations/.
// Missing tables cause `.from('table_name')` to infer `never`, breaking inserts/selects.

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

export type RoundStatus      = 'upcoming' | 'active' | 'completed'
export type ScorecardStatus  = 'active' | 'completed' | 'withdrawn'
export type SideCompType     = 'nearest_pin' | 'longest_drive' | 'best_on_day' | 'custom'

// ─── Database shape ───────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {

      // ── 001: profiles ───────────────────────────────────────────────────────
      profiles: {
        Row: {
          id:          string
          email:       string
          full_name:   string
          avatar_url:  string | null
          handicap:    number | null
          created_at:  string
          updated_at:  string
        }
        Insert: {
          id:          string
          email:       string
          full_name?:  string
          avatar_url?: string | null
          handicap?:   number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?:      string
          full_name?:  string
          avatar_url?: string | null
          handicap?:   number | null
          updated_at?: string
        }
      }

      // ── 002: trips ──────────────────────────────────────────────────────────
      trips: {
        Row: {
          id:              string
          organiser_id:    string
          name:            string
          description:     string | null
          event_type:      string | null
          location:        string | null
          start_date:      string
          end_date:        string
          status:          TripStatus
          logo_url:        string | null
          cover_image_url: string | null
          invite_code:     string
          created_at:      string
          updated_at:      string
        }
        Insert: {
          id?:              string
          organiser_id:     string
          name:             string
          description?:     string | null
          event_type?:      string | null
          location?:        string | null
          start_date:       string
          end_date:         string
          status?:          TripStatus
          logo_url?:        string | null
          cover_image_url?: string | null
          invite_code?:     string
          created_at?:      string
          updated_at?:      string
        }
        Update: {
          name?:            string
          description?:     string | null
          event_type?:      string | null
          location?:        string | null
          start_date?:      string
          end_date?:        string
          status?:          TripStatus
          logo_url?:        string | null
          cover_image_url?: string | null
          updated_at?:      string
        }
      }

      // ── 002: trip_members ───────────────────────────────────────────────────
      trip_members: {
        Row: {
          id:         string
          trip_id:    string
          profile_id: string
          role:       TripRole
          nickname:   string | null
          team:       string | null
          joined_at:  string
        }
        Insert: {
          id?:         string
          trip_id:     string
          profile_id:  string
          role?:       TripRole
          nickname?:   string | null
          team?:       string | null
          joined_at?:  string
        }
        Update: {
          role?:     TripRole
          nickname?: string | null
          team?:     string | null
        }
      }

      // ── 003: trip_accommodations ────────────────────────────────────────────
      trip_accommodations: {
        Row: {
          id:         string
          trip_id:    string
          name:       string
          address:    string | null
          check_in:   string | null
          check_out:  string | null
          notes:      string | null
          sort_order: number
        }
        Insert: {
          id?:         string
          trip_id:     string
          name:        string
          address?:    string | null
          check_in?:   string | null
          check_out?:  string | null
          notes?:      string | null
          sort_order?: number
        }
        Update: {
          name?:       string
          address?:    string | null
          check_in?:   string | null
          check_out?:  string | null
          notes?:      string | null
          sort_order?: number
        }
      }

      // ── 003: trip_courses ───────────────────────────────────────────────────
      trip_courses: {
        Row: {
          id:          string
          trip_id:     string
          name:        string
          play_date:   string | null
          address:     string | null
          website_url: string | null
          tee_time:    string | null
          notes:       string | null
          sort_order:  number
        }
        Insert: {
          id?:          string
          trip_id:      string
          name:         string
          play_date?:   string | null
          address?:     string | null
          website_url?: string | null
          tee_time?:    string | null
          notes?:       string | null
          sort_order?:  number
        }
        Update: {
          name?:        string
          play_date?:   string | null
          address?:     string | null
          website_url?: string | null
          tee_time?:    string | null
          notes?:       string | null
          sort_order?:  number
        }
      }

      // ── 003: trip_itinerary_items ───────────────────────────────────────────
      trip_itinerary_items: {
        Row: {
          id:          string
          trip_id:     string
          title:       string
          description: string | null
          item_date:   string | null
          item_time:   string | null
          sort_order:  number
        }
        Insert: {
          id?:          string
          trip_id:      string
          title:        string
          description?: string | null
          item_date?:   string | null
          item_time?:   string | null
          sort_order?:  number
        }
        Update: {
          title?:       string
          description?: string | null
          item_date?:   string | null
          item_time?:   string | null
          sort_order?:  number
        }
      }

      // ── 004: rounds ─────────────────────────────────────────────────────────
      rounds: {
        Row: {
          id:             string
          trip_id:        string
          course_id:      string | null
          course_name:    string | null
          name:           string
          play_date:      string
          tee_time:       string | null
          scoring_format: ScoringFormat
          status:         RoundStatus
          holes:          9 | 18
          created_at:     string
        }
        Insert: {
          id?:             string
          trip_id:         string
          course_id?:      string | null
          course_name?:    string | null
          name:            string
          play_date:       string
          tee_time?:       string | null
          scoring_format?: ScoringFormat
          status?:         RoundStatus
          holes?:          9 | 18
          created_at?:     string
        }
        Update: {
          name?:           string
          course_name?:    string | null
          play_date?:      string
          tee_time?:       string | null
          scoring_format?: ScoringFormat
          status?:         RoundStatus
          course_id?:      string | null
        }
      }

      // ── 004: holes ──────────────────────────────────────────────────────────
      holes: {
        Row: {
          id:           string
          round_id:     string
          hole_number:  number
          par:          number
          stroke_index: number
        }
        Insert: {
          id?:           string
          round_id:      string
          hole_number:   number
          par:           number
          stroke_index:  number
        }
        Update: {
          par?:          number
          stroke_index?: number
        }
      }

      // ── 004: scorecards ─────────────────────────────────────────────────────
      scorecards: {
        Row: {
          id:               string
          round_id:         string
          player_id:        string
          playing_handicap: number
          status:           ScorecardStatus
          submitted_at:     string | null
        }
        Insert: {
          id?:               string
          round_id:          string
          player_id:         string
          playing_handicap?: number
          status?:           ScorecardStatus
          submitted_at?:     string | null
        }
        Update: {
          playing_handicap?: number
          status?:           ScorecardStatus
          submitted_at?:     string | null
        }
      }

      // ── 004: score_entries ──────────────────────────────────────────────────
      score_entries: {
        Row: {
          id:             string
          scorecard_id:   string
          hole_id:        string
          gross_score:    number
          stableford_pts: number | null
          is_no_return:   boolean
          entered_by:     string
          entered_at:     string
          client_id:      string
        }
        Insert: {
          id?:              string
          scorecard_id:     string
          hole_id:          string
          gross_score:      number
          stableford_pts?:  number | null
          is_no_return?:    boolean
          entered_by:       string
          entered_at?:      string
          client_id:        string
        }
        Update: {
          gross_score?:  number
          is_no_return?: boolean
        }
      }

      // ── 005: side_comps ─────────────────────────────────────────────────────
      side_comps: {
        Row: {
          id:          string
          trip_id:     string
          round_id:    string | null
          name:        string
          comp_type:   SideCompType
          hole_number: number | null
          description: string | null
        }
        Insert: {
          id?:          string
          trip_id:      string
          round_id?:    string | null
          name:         string
          comp_type:    SideCompType
          hole_number?: number | null
          description?: string | null
        }
        Update: {
          name?:        string
          comp_type?:   SideCompType
          hole_number?: number | null
          description?: string | null
        }
      }

      // ── 005: side_comp_results ──────────────────────────────────────────────
      side_comp_results: {
        Row: {
          id:           string
          side_comp_id: string
          player_id:    string
          result_value: string | null
          notes:        string | null
          awarded_at:   string
          awarded_by:   string
        }
        Insert: {
          id?:           string
          side_comp_id:  string
          player_id:     string
          result_value?: string | null
          notes?:        string | null
          awarded_at?:   string
          awarded_by:    string
        }
        Update: {
          result_value?: string | null
          notes?:        string | null
        }
      }

      // ── 006: trip_photos ────────────────────────────────────────────────────
      trip_photos: {
        Row: {
          id:           string
          trip_id:      string
          uploaded_by:  string
          storage_path: string
          caption:      string | null
          taken_at:     string | null
          is_selected:  boolean
          uploaded_at:  string
        }
        Insert: {
          id?:           string
          trip_id:       string
          uploaded_by:   string
          storage_path:  string
          caption?:      string | null
          taken_at?:     string | null
          is_selected?:  boolean
          uploaded_at?:  string
        }
        Update: {
          caption?:     string | null
          taken_at?:    string | null
          is_selected?: boolean
        }
      }

      // ── 006: memory_packs ───────────────────────────────────────────────────
      memory_packs: {
        Row: {
          id:                 string
          trip_id:            string
          winner_id:          string | null
          winner_graphic_url: string | null
          collage_url:        string | null
          summary_url:        string | null
          share_card_url:     string | null
          generated_at:       string | null
          generated_by:       string | null
        }
        Insert: {
          id?:                 string
          trip_id:             string
          winner_id?:          string | null
          winner_graphic_url?: string | null
          collage_url?:        string | null
          summary_url?:        string | null
          share_card_url?:     string | null
          generated_at?:       string | null
          generated_by?:       string | null
        }
        Update: {
          winner_id?:          string | null
          winner_graphic_url?: string | null
          collage_url?:        string | null
          summary_url?:        string | null
          share_card_url?:     string | null
          generated_at?:       string | null
          generated_by?:       string | null
        }
      }

    }

    Views: {
      leaderboard_view: {
        Row: {
          round_id:            string
          trip_id:             string
          player_id:           string
          full_name:           string
          playing_handicap:    number
          total_stableford_pts: number
          holes_played:        number
          rank:                number
        }
      }
    }

    Functions: Record<string, unknown>
  }
}
