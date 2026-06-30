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
  return useQuery({
    queryKey: tripKeys.lists(),
    queryFn: async (): Promise<TripSummary[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = createClient()

      const authResult = await db.auth.getUser()
      const user = authResult?.data?.user
      if (!user) throw new Error('Not authenticated')

      const queryResult = await db
        .from('trip_members')
        .select(
          `role, trips ( id, name, description, event_type, location, start_date, end_date, status, logo_url, invite_code, trip_members ( count ), rounds ( count ) )`
        )
        .eq('profile_id', user.id)

      const queryError: unknown = queryResult ? queryResult.error : undefined
      if (queryError) throw queryError

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = (queryResult && queryResult.data) || []

      const summaries: TripSummary[] = []
      for (const row of rows) {
        const t = row ? row.trips : null
        if (!t) continue
        if (t.status === 'archived') continue

        summaries.push({
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
          user_role:    row.role,
          player_count: Number((t.trip_members && t.trip_members[0] && t.trip_members[0].count) || 0),
          round_count:  Number((t.rounds && t.rounds[0] && t.rounds[0].count) || 0),
        })
      }

      summaries.sort((a, b) => a.start_date.localeCompare(b.start_date))
      return summaries
    },
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Update status ────────────────────────────────────────────────────────────

export function useUpdateTripStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ tripId, status }: { tripId: string; status: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = createClient()

      const result = await db
        .from('trips')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', tripId)

      const updateError: unknown = result ? result.error : undefined
      if (updateError) throw updateError
    },
    onSuccess: (_data: unknown, variables: { tripId: string }) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.detail(variables.tripId) })
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
    }): Promise<{ tripId: string; inviteCode: string }> => {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to create trip')
      }
      return res.json()
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
    mutationFn: async (
      inviteCode: string
    ): Promise<{ tripId: string; tripName: string; alreadyMember: boolean }> => {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to join trip')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}
