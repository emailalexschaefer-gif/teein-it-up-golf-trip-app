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
  groups:  (id: string) => [...tripKeys.all, id, 'groups'] as const,
}

interface UpdateStatusVars { tripId: string; status: string }

interface CreateTripVars {
  name: string; event_type: string; location: string
  start_date: string; end_date: string; description: string
  expected_players: number; players_per_group: number; organiser_is_playing: boolean
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

      // Step 2: Get the trips — include ALL statuses (archived too, for the Archived tab)
      const tripsResult = await db
        .from('trips')
        .select('id, name, description, event_type, location, start_date, end_date, status, logo_url, invite_code')
        .in('id', tripIds)

      if (tripsResult.error) {
        throw new Error(`trips query failed: ${tripsResult.error.message}`)
      }

      const tripsData: any[] = tripsResult.data ?? []
      const roleByTripId: Record<string, TripRole> = {}
      for (const m of memberships) roleByTripId[m.trip_id] = m.role

      // Step 3: Fetch real player, round and group counts — batched, not N+1
      const [membersResult, roundsResult, groupsResult] = await Promise.all([
        db.from('trip_members').select('trip_id, role').in('trip_id', tripIds),
        db.from('rounds').select('id, trip_id').in('trip_id', tripIds),
        db.from('trip_groups').select('id, trip_id').in('trip_id', tripIds),
      ])

      // Build count maps
      const playerCountByTrip: Record<string, number> = {}
      if (membersResult.data) {
        for (const m of membersResult.data) {
          if (m.role === 'player') {
            playerCountByTrip[m.trip_id] = (playerCountByTrip[m.trip_id] ?? 0) + 1
          }
        }
      }

      const roundCountByTrip: Record<string, number> = {}
      if (roundsResult.data) {
        for (const r of roundsResult.data) {
          roundCountByTrip[r.trip_id] = (roundCountByTrip[r.trip_id] ?? 0) + 1
        }
      }

      const groupCountByTrip: Record<string, number> = {}
      const groupsData = Array.isArray(groupsResult?.data) ? groupsResult.data : []
      for (const g of groupsData) {
        groupCountByTrip[g.trip_id] = (groupCountByTrip[g.trip_id] ?? 0) + 1
      }


      const summaries: TripSummary[] = tripsData.map((t: any): TripSummary => ({
        id:                t.id,
        name:              t.name,
        description:       t.description,
        event_type:        t.event_type,
        location:          t.location,
        start_date:        t.start_date,
        end_date:          t.end_date,
        status:            t.status,
        logo_url:          t.logo_url,
        invite_code:       t.invite_code,
        user_role:         roleByTripId[t.id] ?? 'player' as TripRole,
        player_count:      playerCountByTrip[t.id] ?? 0,
        round_count:       roundCountByTrip[t.id]  ?? 0,
        group_count:       groupCountByTrip[t.id]  ?? 0,
        expected_players:  t.expected_players  ?? 0,
        players_per_group: t.players_per_group ?? 4,
      }))

      summaries.sort((a, b) => a.start_date.localeCompare(b.start_date))
      return summaries
    },
    // Low stale time so dashboard reflects changes quickly
    staleTime: 0,
    // Refetch when window regains focus and when user navigates back
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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

// ─── useGroupCount ───────────────────────────────────────────────────────────
// Fetches the real group count for a trip from the DB.
// Used by TripDetailClient so Overview always shows the actual count,
// not a calculated estimate — regardless of which tab is active.

export function useGroupCount(tripId: string): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: tripKeys.groups(tripId),
    queryFn: async (): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = createClient()
      const result = await db
        .from('trip_groups')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', tripId)
      if (result.error) {
        // If trip_groups table doesn't exist yet, return 0 gracefully
        const m: string = result.error.message ?? ''
        if (m.includes('does not exist') || m.includes('relation')) return 0
        throw new Error(result.error.message)
      }
      return result.count ?? 0
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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
