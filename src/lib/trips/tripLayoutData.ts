// Release 3 / Package 3A — data loading for the trip-scoped layout, extracted
// so it can be unit-tested (a .tsx layout cannot be imported by the test
// runner) and so its three independent reads can run together.
//
// Behaviour is deliberately identical to the previous inline code:
//   - the signed-in user is resolved FIRST (4 s cap); no user => `user: null`
//     and NOTHING else is queried (the layout then redirects to /login)
//   - membership (4 s cap), practice flag (4 s cap) and the active round
//     (10 s cap) each fall back to "unknown" independently on timeout or
//     error, exactly as before — one slow/failed lookup never affects another
//   - the lookups only drive navigation display; they gate nothing
// The only change is that the three lookups after the user check are issued
// together instead of one after another.

export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve(promise),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

export interface TripLayoutTimeouts { userMs: number; membershipMs: number; practiceMs: number; activeRoundMs: number }
export const DEFAULT_LAYOUT_TIMEOUTS: TripLayoutTimeouts = { userMs: 4000, membershipMs: 4000, practiceMs: 4000, activeRoundMs: 10000 }

export interface TripLayoutData {
  user: { id: string } | null
  isOrganiser: boolean
  isPractice: boolean
  activeRound: { id: string; name: string } | null
}

// Structural subset of the Supabase server client the layout uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LayoutClient = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryResult = { data?: any; error?: unknown }

export async function loadTripLayoutData(
  supabase: LayoutClient,
  tripId: string,
  timeouts: TripLayoutTimeouts = DEFAULT_LAYOUT_TIMEOUTS,
): Promise<TripLayoutData> {
  const userResult = await withTimeout<QueryResult>(supabase.auth.getUser(), timeouts.userMs).catch(() => null)
  const user = userResult?.data?.user ?? null
  if (!user) return { user: null, isOrganiser: false, isPractice: false, activeRound: null }

  const [membershipResult, tripResult, activeRoundResult] = await Promise.all([
    withTimeout<QueryResult>(
      supabase.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
      timeouts.membershipMs,
    ).catch(() => null),
    withTimeout<QueryResult>(
      supabase.from('trips').select('is_practice').eq('id', tripId).maybeSingle(),
      timeouts.practiceMs,
    ).catch(() => null),
    withTimeout<QueryResult>(
      supabase.from('rounds').select('id, name').eq('trip_id', tripId).eq('status', 'active').maybeSingle(),
      timeouts.activeRoundMs,
    ).catch(() => null),
  ])

  return {
    user,
    isOrganiser: membershipResult?.data?.role === 'organiser',
    isPractice: tripResult?.data?.is_practice === true,
    activeRound: activeRoundResult?.data ?? null,
  }
}
