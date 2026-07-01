import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { TripSummary } from '@/types/app'

// ─── Query keys ───────────────────────────────────────────────────────────────

export const tripKeys = {
  all:     ['trips'] as const,
  lists:   () => [...tripKeys.all, 'list'] as const,
  detail:  (id: string) => [...tripKeys.all, 'detail', id] as const,
  members: (id: string) => [...tripKeys.all, id, 'members'] as const,
  rounds:  (id: string) => [...tripKeys.all, id, 'rounds'] as const,
}

// ─── Variable types — explicit, not inferred ──────────────────────────────────

interface UpdateStatusVars {
  tripId: string
  status: string
}

interface CreateTripVars {
  name: string
  event_type: string
  location: string
  start_date: string
  end_date: string
  description: string
  rounds: Array<{
    name: string
    course_name: string
    play_date: string
    tee_time: string
    holes: 9 | 18
    scoring_format: 'stableford'
  }>
}

interface CreateTripResult {
  tripId: string
  inviteCode: string
}

interface JoinTripResult {
  tripId: string
  tripName: string
  alreadyMember: boolean
}

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

      const queryResult = await db
        .from('trip_members')
        .select(
          'role, trips ( id, name, description, event_type, location, start_date, end_date, status, logo_url, invite_code, trip_members ( count ), rounds ( count ) )'
        )
        .eq('profile_id', user.id)

      if (queryResult?.error) throw queryResult.error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = queryResult?.data ?? []
      const summaries: TripSummary[] = []

      for (const row of rows) {
        const t = row?.trips ?? null
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
          player_count: Number(t.trip_members?.[0]?.count ?? 0),
          round_count:  Number(t.rounds?.[0]?.count ?? 0),
        })
      }

      summaries.sort((a, b) => a.start_date.localeCompare(b.start_date))
      return summaries
    },
    staleTime: 1000 * 60 * 2,
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
      if (result?.error) throw result.error
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
        throw new Error(errBody.error ?? 'Failed to create trip')
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
        throw new Error(errBody.error ?? 'Failed to join trip')
      }
      return res.json() as Promise<JoinTripResult>
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    },
  })
}
