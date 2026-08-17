/**
 * GET /api/trips/[tripId]/members
 *
 * A lightweight member-list read, added for Package 1's shared-data
 * freshness fix. Deliberately a general-purpose endpoint, not a page-
 * specific one — returns the same TripMemberRow shape TripDetailClient
 * already expects from its initial server-rendered prop, so the client
 * can poll this and merge/replace without any shape translation.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const { data: members, error } = await admin
    .from('trip_members')
    .select('id, role, profile_id, group_id, playing_handicap, profiles ( id, full_name, avatar_url, handicap, golf_club, occupation )')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Could not load members.' }, { status: 500 })

  return NextResponse.json({ members: members ?? [] })
}
