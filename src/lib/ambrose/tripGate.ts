// Package 4 / V8 -- per-event gate for the team API routes in a PRODUCTION deployment.
// When the deployment is not restricted to a list of events the deployment-level switch is enough (nothing is resolved, no query is made). When it
// is restricted (the production test), an Ambrose request is allowed only if the event it belongs to is on NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS. The event is resolved with the SIGNED-IN USER's client, so
// row-level security applies: a non-member cannot resolve it, which reads as "not allowed" (the route then answers 404 as if it did not exist).
import { ambroseEnabledForTrip, ambroseRestrictedToTrips } from './featureFlag'

export interface TripRef { tripId?: string; roundId?: string; entryId?: string; flagId?: string }
interface Row { data: Record<string, unknown> | null; error: unknown }
interface Db { from(table: string): { select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<Row> } } } }

async function one(db: Db, table: string, col: string, id: string, pick: string): Promise<string | null> {
  const r = await db.from(table).select(pick).eq(col, id).maybeSingle()
  const v = !r.error && r.data ? r.data[pick] : null
  return typeof v === 'string' && v ? v : null
}

/** Resolve the event (trip) a team request belongs to, or null when it cannot be resolved (missing, or hidden from this user by RLS). */
export async function resolveTripId(db: Db, ref: TripRef): Promise<string | null> {
  if (ref.tripId) return ref.tripId
  let roundId = ref.roundId ?? null
  let entryId = ref.entryId ?? null
  if (!roundId && !entryId && ref.flagId) entryId = await one(db, 'team_score_flags', 'id', ref.flagId, 'entry_id')
  if (!roundId && entryId) roundId = await one(db, 'round_team_entries', 'id', entryId, 'round_id')
  if (!roundId) return null
  return one(db, 'rounds', 'id', roundId, 'trip_id')
}

/**
 * Build the `tripAllowed` dependency for handleTeamAction. `perTrip` defaults to "this build is restricted to listed events"; otherwise it returns true without
 * touching the database (the deployment-level flag was already checked). Any lookup failure means NOT allowed (fail closed).
 */
export function makeTripAllowed(db: Db, perTrip: boolean = ambroseRestrictedToTrips()): (ref: TripRef) => Promise<boolean> {
  return async ref => {
    if (!perTrip) return true
    try { return ambroseEnabledForTrip(await resolveTripId(db, ref)) } catch { return false }
  }
}
