// PATCH /api/trips/[tripId]/members/[memberId] — assign group
// DELETE /api/trips/[tripId]/members/[memberId] — remove player from trip

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string; memberId: string }> }

export async function PATCH(req: NextRequest, { params }: Props) {
  const { tripId, memberId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if ('group_id' in body) update.group_id = body.group_id || null

  const result = await admin.from('trip_members').update(update).eq('id', memberId).eq('trip_id', tripId).select().single()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json(result.data)
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const { tripId, memberId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Prevent organiser from removing themselves
  const memberRes = await admin.from('trip_members').select('profile_id, role').eq('id', memberId).single()
  if (memberRes.data?.role === 'organiser') {
    return NextResponse.json({ error: 'Cannot remove the organiser' }, { status: 400 })
  }

  const result = await admin.from('trip_members').delete().eq('id', memberId).eq('trip_id', tripId)
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
