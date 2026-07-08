import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { TripSummary } from '@/types/app'
import type { TripRole } from '@/types/database'

export const tripKeys = {
  all:     ['trips'] as const,
  lists:   () => [...tripKeys.all, 'list'] as const,
  detail:  (id: string) => [...tripKeys.all, 'detail', id] as const,
  members: (id: string) => [...tripKeys.all, id, 'members'] as const,
  rounds:  (id: string) => [...tripKeys.all, id, 'rounds'] as const,
}

interface UpdateStatusVars { tripId: string; status: string }

interface CreateTripVars {
  name: string; event_type: string; location: string
  start_date: string; end_date: string; description: string
  expected_players: number; players_per_group: number
  rounds: Array<{
    name: string; course_name: string; play_date: string
    tee_time: string; holes: 9 | 18; scoring_format: 'stableford'
  }>
}

interface CreateTripResult { tripId: string; inviteCode: string }
interface JoinTripResult   { tripId: string; tripName: string; alreadyMember: boolean }

// ─── useMyTrips ───────────────────────────────────────────────────────────────

export function useMyTrips(): UseQueryResult<TripSummary[], Error> {
  return useQuery<TripSummary[], Error>({
    queryKey: tripKeys.lists(),
    queryFn: async (): Promise<TripSummary[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = createClient()

      const authResult = await db.auth.getUser()
      const user: { id: string } | null = authResult?.data?.user ?? null
      if (!user) throw new Error('Not authenticated')

      // Step 1: Get the trip IDs and roles this user belongs to
      const memberResult = await db
        .from('trip_members')
        .select('trip_id, role')
        .eq('profile_id', user.id)

      if (memberResult.error) {
        throw new Error(`trip_members query failed: ${memberResult.error.message}`)
      }

      const memberships: Array<{ trip_id: string; role: TripRole }> = memberResult.data ?? []

      if (memberships.length === 0) return []

      const tripIds = memberships.map((m) => m.trip_id)

      // Step 2: Get the trips by ID (avoids PostgREST relationship join issues)
      const tripsResult = await db
        .from('trips')
        .select('id, name, description, event_type, location, start_date, end_date, status, logo_url, invite_code, expected_players, players_per_group')
        .in('id', tripIds)

      if (tripsResult.error) {
        throw new Error(`trips query failed: ${tripsResult.error.message}`)
      }

      const tripsData: any[] = tripsResult.data ?? []

      // Build a role lookup
      const roleByTripId: Record<string, TripRole> = {}
      for (const m of memberships) {
        roleByTripId[m.trip_id] = m.role
      }

      const summaries: TripSummary[] = tripsData
        .filter((t: any) => t.status !== 'archived')
        .map((t: any): TripSummary => ({
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
          user_role:         roleByTripId[t.id] ?? 'player' as TripRole,
          player_count:      0,
          round_count:       0,
          expected_players:  t.expected_players  ?? 0,
          players_per_group: t.players_per_group ?? 4,
        }))

      summaries.sort((a, b) => a.start_date.localeCompare(b.start_date))
      return summaries
    },
    staleTime: 1000 * 60 * 2,
    retry: 1,
  })
}

// ─── useUpdateTripStatus ──────────────────────────────────────────────────────

export function useUpdateTripStatus(): UseMutationResult<void, Error, UpdateStatusVars> {
  const queryClient = useQueryClient()

  return useMutation<void, Error, UpdateStatusVars>({
    mutationFn: async ({ tripId, status }: UpdateStatusVars): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = createClient()
      const result = await db
        .from('trips')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', tripId)
      if (result?.error) throw new Error(result.error.message)
    },
    onSuccess: (_data: void, variables: UpdateStatusVars): void => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(variables.tripId) })
      void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}

// ─── useCreateTrip ────────────────────────────────────────────────────────────

export function useCreateTrip(): UseMutationResult<CreateTripResult, Error, CreateTripVars> {
  const queryClient = useQueryClient()

  return useMutation<CreateTripResult, Error, CreateTripVars>({
    mutationFn: async (payload: CreateTripVars): Promise<CreateTripResult> => {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody: { error?: string } = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      return res.json() as Promise<CreateTripResult>
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}

// ─── useJoinTrip ─────────────────────────────────────────────────────────────

export function useJoinTrip(): UseMutationResult<JoinTripResult, Error, string> {
  const queryClient = useQueryClient()

  return useMutation<JoinTripResult, Error, string>({
    mutationFn: async (inviteCode: string): Promise<JoinTripResult> => {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode }),
      })
      if (!res.ok) {
        const errBody: { error?: string } = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      return res.json() as Promise<JoinTripResult>
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}
