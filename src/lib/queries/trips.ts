import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { TripSummary } from '@/types/app'

export const tripKeys = {
  all:     ['trips'] as const,
  lists:   () => [...tripKeys.all, 'list'] as const,
  detail:  (id: string) => [...tripKeys.all, 'detail', id] as const,
  members: (id: string) => [...tripKeys.all, id, 'members'] as const,
  rounds:  (id: string) => [...tripKeys.all, id, 'rounds'] as const,
}

// ─── My Trips ─────────────────────────────────────────────────────────────────

export function useMyTrips() {
  const supabase = createClient()

  return useQuery({
    queryKey: tripKeys.lists(),
    queryFn: async (): Promise<TripSummary[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('trip_members')
        .select(`
          role,
          trips (
            id, name, description, event_type, location,
            start_date, end_date, status, logo_url, invite_code,
            trip_members ( count ),
            rounds ( count )
          )
        `)
        .eq('profile_id', user.id)

      if (error) throw error

      return (data ?? [])
        .filter((m) => m.trips !== null && (m.trips as any).status !== 'archived')
        .map((m) => {
          const t = m.trips as any
          return {
            id:           t.id,
            name:         t.name,
            description:  t.description,
            event_type:   t.event_type,
            location:     t.location,
            start_date:   t.start_date,
            end_date:     t.end_date,
            status:       t.status,
            logo_url:     t.logo_url,
            invite_code:  t.invite_code,
            user_role:    m.role,
            player_count: Number(t.trip_members?.[0]?.count ?? 0),
            round_count:  Number(t.rounds?.[0]?.count ?? 0),
          } satisfies TripSummary
        })
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
    },
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Update status ────────────────────────────────────────────────────────────

export function useUpdateTripStatus() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ tripId, status }: { tripId: string; status: string }) => {
      const { error } = await supabase
        .from('trips')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', tripId)
      if (error) throw error
    },
    onSuccess: (_, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}

// ─── Create trip ──────────────────────────────────────────────────────────────

export function useCreateTrip() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      name: string; event_type: string; location: string
      start_date: string; end_date: string; description: string
      rounds: Array<{
        name: string; course_name: string; play_date: string
        tee_time: string; holes: 9 | 18; scoring_format: 'stableford'
      }>
    }) => {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create trip')
      }
      return res.json() as Promise<{ tripId: string; inviteCode: string }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}

// ─── Join trip ────────────────────────────────────────────────────────────────

export function useJoinTrip() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (inviteCode: string) => {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to join trip')
      }
      return res.json() as Promise<{ tripId: string; tripName: string; alreadyMember: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}
