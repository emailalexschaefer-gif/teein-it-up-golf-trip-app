// This file mirrors the output of: npx supabase gen types typescript --local
// It uses `type` (not `interface`) and includes all required keys (Enums, CompositeTypes)
// to satisfy the GenericSchema constraint in @supabase/supabase-js.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      holes: {
        Row: {
          id: string
          round_id: string
          hole_number: number
          par: number
          stroke_index: number
        }
        Insert: {
          id?: string
          round_id: string
          hole_number: number
          par: number
          stroke_index: number
        }
        Update: {
          par?: number
          stroke_index?: number
        }
        Relationships: []
      }
      memory_packs: {
        Row: {
          id: string
          trip_id: string
          winner_id: string | null
          winner_graphic_url: string | null
          collage_url: string | null
          summary_url: string | null
          share_card_url: string | null
          generated_at: string | null
          generated_by: string | null
        }
        Insert: {
          id?: string
          trip_id: string
          winner_id?: string | null
          winner_graphic_url?: string | null
          collage_url?: string | null
          summary_url?: string | null
          share_card_url?: string | null
          generated_at?: string | null
          generated_by?: string | null
        }
        Update: {
          winner_id?: string | null
          winner_graphic_url?: string | null
          collage_url?: string | null
          summary_url?: string | null
          share_card_url?: string | null
          generated_at?: string | null
          generated_by?: string | null
        }
        Relationships: []
      }
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
        Relationships: []
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
          scoring_format: string
          status: string
          holes: number
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
          scoring_format?: string
          status?: string
          holes?: number
          created_at?: string
        }
        Update: {
          name?: string
          course_name?: string | null
          play_date?: string
          tee_time?: string | null
          scoring_format?: string
          status?: string
          course_id?: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      scorecards: {
        Row: {
          id: string
          round_id: string
          player_id: string
          playing_handicap: number
          status: string
          submitted_at: string | null
        }
        Insert: {
          id?: string
          round_id: string
          player_id: string
          playing_handicap?: number
          status?: string
          submitted_at?: string | null
        }
        Update: {
          playing_handicap?: number
          status?: string
          submitted_at?: string | null
        }
        Relationships: []
      }
      side_comp_results: {
        Row: {
          id: string
          side_comp_id: string
          player_id: string
          result_value: string | null
          notes: string | null
          awarded_at: string
          awarded_by: string
        }
        Insert: {
          id?: string
          side_comp_id: string
          player_id: string
          result_value?: string | null
          notes?: string | null
          awarded_at?: string
          awarded_by: string
        }
        Update: {
          result_value?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      side_comps: {
        Row: {
          id: string
          trip_id: string
          round_id: string | null
          name: string
          comp_type: string
          hole_number: number | null
          description: string | null
        }
        Insert: {
          id?: string
          trip_id: string
          round_id?: string | null
          name: string
          comp_type: string
          hole_number?: number | null
          description?: string | null
        }
        Update: {
          name?: string
          comp_type?: string
          hole_number?: number | null
          description?: string | null
        }
        Relationships: []
      }
      trip_accommodations: {
        Row: {
          id: string
          trip_id: string
          name: string
          address: string | null
          check_in: string | null
          check_out: string | null
          notes: string | null
          sort_order: number
        }
        Insert: {
          id?: string
          trip_id: string
          name: string
          address?: string | null
          check_in?: string | null
          check_out?: string | null
          notes?: string | null
          sort_order?: number
        }
        Update: {
          name?: string
          address?: string | null
          check_in?: string | null
          check_out?: string | null
          notes?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      trip_courses: {
        Row: {
          id: string
          trip_id: string
          name: string
          play_date: string | null
          address: string | null
          website_url: string | null
          tee_time: string | null
          notes: string | null
          sort_order: number
        }
        Insert: {
          id?: string
          trip_id: string
          name: string
          play_date?: string | null
          address?: string | null
          website_url?: string | null
          tee_time?: string | null
          notes?: string | null
          sort_order?: number
        }
        Update: {
          name?: string
          play_date?: string | null
          address?: string | null
          website_url?: string | null
          tee_time?: string | null
          notes?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      trip_itinerary_items: {
        Row: {
          id: string
          trip_id: string
          title: string
          description: string | null
          item_date: string | null
          item_time: string | null
          sort_order: number
        }
        Insert: {
          id?: string
          trip_id: string
          title: string
          description?: string | null
          item_date?: string | null
          item_time?: string | null
          sort_order?: number
        }
        Update: {
          title?: string
          description?: string | null
          item_date?: string | null
          item_time?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      trip_members: {
        Row: {
          id: string
          trip_id: string
          profile_id: string
          role: string
          nickname: string | null
          team: string | null
          joined_at: string
        }
        Insert: {
          id?: string
          trip_id: string
          profile_id: string
          role?: string
          nickname?: string | null
          team?: string | null
          joined_at?: string
        }
        Update: {
          role?: string
          nickname?: string | null
          team?: string | null
        }
        Relationships: []
      }
      trip_photos: {
        Row: {
          id: string
          trip_id: string
          uploaded_by: string
          storage_path: string
          caption: string | null
          taken_at: string | null
          is_selected: boolean
          uploaded_at: string
        }
        Insert: {
          id?: string
          trip_id: string
          uploaded_by: string
          storage_path: string
          caption?: string | null
          taken_at?: string | null
          is_selected?: boolean
          uploaded_at?: string
        }
        Update: {
          caption?: string | null
          taken_at?: string | null
          is_selected?: boolean
        }
        Relationships: []
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
          status: string
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
          status?: string
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
          status?: string
          logo_url?: string | null
          cover_image_url?: string | null
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases matching Supabase CLI output conventions
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// Keep named types for backwards compatibility with app.ts
export type TripStatus     = 'draft' | 'open' | 'ready' | 'live' | 'completed' | 'archived'
export type TripRole       = 'organiser' | 'player'
export type ScoringFormat  = 'stableford' | 'stroke' | 'match_play' | 'ambrose' | 'four_ball_better_ball'
export type RoundStatus    = 'upcoming' | 'active' | 'completed'
export type ScorecardStatus = 'active' | 'completed' | 'withdrawn'
export type SideCompType   = 'nearest_pin' | 'longest_drive' | 'best_on_day' | 'custom'
