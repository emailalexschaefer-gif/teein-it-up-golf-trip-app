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

/** The only shape of a query result the layout reads (Supabase responses satisfy it). */
export interface LookupResult<T> { data: T | null }

/**
 * The four lookups, supplied by the layout (which builds them from the real
 * Supabase client) or by a test. Keeping them as typed callbacks means this
 * module needs no untyped client.
 */
export interface TripLayoutFetchers {
  getUser: () => PromiseLike<{ data: { user: { id: string } | null } }>
  getMembership: (userId: string) => PromiseLike<LookupResult<{ role: string | null }>>
  getPractice: () => PromiseLike<LookupResult<{ is_practice: boolean | null }>>
  getActiveRound: () => PromiseLike<LookupResult<{ id: string; name: string }>>
}

export async function loadTripLayoutData(
  fetchers: TripLayoutFetchers,
  timeouts: TripLayoutTimeouts = DEFAULT_LAYOUT_TIMEOUTS,
): Promise<TripLayoutData> {
  const userResult = await withTimeout(fetchers.getUser(), timeouts.userMs).catch(() => null)
  const user = userResult?.data?.user ?? null
  if (!user) return { user: null, isOrganiser: false, isPractice: false, activeRound: null }

  const [membershipResult, tripResult, activeRoundResult] = await Promise.all([
    withTimeout(fetchers.getMembership(user.id), timeouts.membershipMs).catch(() => null),
    withTimeout(fetchers.getPractice(), timeouts.practiceMs).catch(() => null),
    withTimeout(fetchers.getActiveRound(), timeouts.activeRoundMs).catch(() => null),
  ])

  return {
    user,
    isOrganiser: membershipResult?.data?.role === 'organiser',
    isPractice: tripResult?.data?.is_practice === true,
    activeRound: activeRoundResult?.data ?? null,
  }
}
