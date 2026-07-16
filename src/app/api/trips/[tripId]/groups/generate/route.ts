// POST /api/trips/[tripId]/groups/generate
// Auto-generates groups based on expected_players and players_per_group.
// Deletes existing groups and recreates them (unassigned members stay unassigned).

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string }> }

export async function POST(_req: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  // Try with Sprint 3 columns; fall back to base if columns missing
  let tripRes = await admin
    .from('trips')
    .select('organiser_id, expected_players, players_per_group')
    .eq('id', tripId).single()

  if (tripRes.error) {
    const m: string = tripRes.error?.message ?? ''
    if (m.includes('expected_players') || m.includes('players_per_group') || m.includes('does not exist')) {
      tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
      if (tripRes.data) tripRes.data = { ...tripRes.data, expected_players: 0, players_per_group: 4 }
    }
  }

  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  const expected_players: number  = tripRes.data.expected_players  ?? 0
  const players_per_group: number = tripRes.data.players_per_group ?? 4
  if (!expected_players || !players_per_group) {
    return NextResponse.json({ error: 'Set expected players and group size first' }, { status: 400 })
  }

  const numGroups = Math.ceil(expected_players / players_per_group)

  // Clear existing group assignments
  const existingGroups = await admin.from('trip_groups').select('id').eq('trip_id', tripId)
  if (existingGroups.data?.length) {
    await admin.from('trip_members').update({ group_id: null }).eq('trip_id', tripId)
    await admin.from('trip_groups').delete().eq('trip_id', tripId)
  }

  // Create new groups
  const groups = Array.from({ length: numGroups }, (_, i) => ({
    trip_id:    tripId,
    name:       `Group ${i + 1}`,
    sort_order: i,
  }))

  const result = await admin.from('trip_groups').insert(groups).select()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  return NextResponse.json({ groups: result.data, count: numGroups }, { status: 201 })
}
