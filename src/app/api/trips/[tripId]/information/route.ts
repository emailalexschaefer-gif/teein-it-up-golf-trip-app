/**
 * GET/PATCH /api/trips/[tripId]/information
 *
 * V1 Trip Information — a single free-text field the organiser pastes
 * an itinerary/general info into, visible read-only to every trip
 * member. Deliberately its own dedicated route rather than folded into
 * whatever the Overview page's existing trip-fetch does: the trips
 * table has a broader "Anyone: read by invite code" RLS policy for the
 * pre-join flow, which is row-level (not column-level) and would
 * technically also expose trip_information to non-members if this field
 * were fetched through that path. GET here explicitly checks
 * trip_members before returning anything, and PATCH explicitly checks
 * organiser_id — server-side enforcement, not just an RLS side-effect
 * and not just hiding the Edit button client-side.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateTripInformation } from '@/lib/trips/tripInformation'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Explicit membership check — this is what actually keeps a non-member
  // from reading trip_information, independent of what the trips table's
  // own RLS policies would otherwise allow for this row.
  const membership = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const tripRes = await admin.from('trips').select('trip_information').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })

  return NextResponse.json({ trip_information: tripRes.data.trip_information ?? null })
}

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Organiser-only — matches the trips table's own "Organisers: full
  // access" RLS condition (organiser_id = auth.uid()), checked
  // explicitly here as the actual enforcement rather than assuming the
  // client only shows the Edit button to organisers.
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the trip organiser can update Trip Information.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const { trip_information } = (body ?? {}) as { trip_information?: unknown }
  const validation = validateTripInformation(trip_information ?? null)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const normalised = validation.normalised

  const { error: updateError } = await admin
    .from('trips')
    .update({ trip_information: normalised })
    .eq('id', tripId)

  if (updateError) {
    console.error('[trip information PATCH]', {
      code: updateError.code, message: updateError.message,
      details: updateError.details, hint: updateError.hint, tripId,
    })
    // TEMPORARY diagnostic detail — the brief explicitly asked for the
    // real backend error to be visible during this specific
    // investigation, while also explicitly saying not to expose
    // database errors permanently. This is a compact, one-line summary
    // (postgres error code + message only — no table/column internals
    // beyond what postgres itself already puts in `message`, no stack
    // trace), returned as a separate `debug` field the client can
    // choose to show a small line of, not blended into the main error
    // text a real user would see. Remove this `debug` field once the
    // root cause is confirmed and fixed.
    return NextResponse.json({
      error: "Couldn't save Trip Information. Please try again.",
      debug: `${updateError.code ?? 'unknown'}: ${updateError.message ?? 'no message'}`,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, trip_information: normalised })
}
