// Package 4 / M2 -- the switches for Ambrose. OFF by default.
//
// NON-PRODUCTION, no list (appEnv !== 'production'): on for every event when NEXT_PUBLIC_AMBROSE_ENABLED === 'true'.
//
// RESTRICTED (NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS lists one or more events -- comma-separated UUIDs): Ambrose is available ONLY for those events,
// whatever the environment name says. This is how a production test is run: an explicit, per-event, reversible decision -- not a general release.
// PRODUCTION without a list (appEnv === 'production'): fully off, exactly as before, even if the flag is set.
//
// Two questions, two functions:
//   ambroseEnabled()            -- could Ambrose be live for SOME event in this deployment? (gates the 404 on team routes and decides whether
//                                  the legacy-score guard looks at the Ambrose tables at all)
//   ambroseEnabledForTrip(id)   -- is it live for THIS event? (screens, close/start/release behaviour, team routes after sign-in)
//
// The team API routes enforce both on the SERVER, so hiding screens is never the only protection.
// NEXT_PUBLIC_* values are read as literals so Next.js can inline them for the browser (they are fixed at BUILD time: change them, redeploy).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Parse the production allowlist. Anything that is not a well-formed UUID is ignored (a typo can never widen access). */
export function parseTripAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim().toLowerCase()
    if (UUID.test(id)) out.add(id)
  }
  return out
}

/** True when the deployment limits Ambrose to a listed set of events. */
export function ambroseRestrictedToTrips(prodTripIds: string | undefined = process.env.NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS): boolean {
  return parseTripAllowlist(prodTripIds).size > 0
}

export function ambroseEnabled(
  flag: string | undefined = process.env.NEXT_PUBLIC_AMBROSE_ENABLED,
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  prodTripIds: string | undefined = process.env.NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS,
): boolean {
  if (flag !== 'true') return false
  return ambroseRestrictedToTrips(prodTripIds) || appEnv !== 'production'
}

export function ambroseEnabledForTrip(
  tripId: string | null | undefined,
  flag: string | undefined = process.env.NEXT_PUBLIC_AMBROSE_ENABLED,
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  prodTripIds: string | undefined = process.env.NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS,
): boolean {
  if (flag !== 'true') return false
  const list = parseTripAllowlist(prodTripIds)
  if (list.size > 0) return !!tripId && list.has(tripId.trim().toLowerCase())
  return appEnv !== 'production'
}
