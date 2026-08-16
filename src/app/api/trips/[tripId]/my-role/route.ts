/**
 * GET /api/trips/[tripId]/my-role
 *
 * Item 1 — Chat role leakage fix. Returns only the authenticated
 * caller's own role for this trip — never any other member's data, so
 * this is safe to call from any client component without an explicit
 * membership check first (the query itself is scoped to auth.uid()).
 *
 * Exists specifically as a fast, minimal re-verification a client
 * component can call on mount to defensively confirm isOrganiser
 * against the value it was server-rendered with — Next.js's client-side
 * router cache can serve a stale RSC payload briefly even on a
 * dynamic='force-dynamic' page (a known App Router behaviour, not
 * specific to this app), which is the most plausible explanation for
 * "a newly joined player briefly sees organiser controls": their first
 * Chat visit could momentarily reuse a cached render from whenever the
 * organiser last visited the same route on the same device/session
 * during testing, before the real, correctly-scoped fetch resolves.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { data: membership } = await supabase
    .from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  return NextResponse.json({ role: membership?.role ?? null })
}
