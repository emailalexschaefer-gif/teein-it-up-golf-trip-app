// PATCH /api/trips/[tripId]/groups/[groupId] — rename or update tee time
// DELETE /api/trips/[tripId]/groups/[groupId] — delete group (clears member assignments)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string; groupId: string }> }

export async function PATCH(req: NextRequest, { params }: Props) {
  const { tripId, groupId } = await params
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
  if (body.name     !== undefined) update.name     = body.name
  if (body.tee_time !== undefined) update.tee_time = body.tee_time || null

  const result = await admin.from('trip_groups').update(update).eq('id', groupId).eq('trip_id', tripId).select().single()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json(result.data)
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const { tripId, groupId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Clear group assignments before deleting
  await admin.from('trip_members').update({ group_id: null }).eq('group_id', groupId)
  const result = await admin.from('trip_groups').delete().eq('id', groupId).eq('trip_id', tripId)
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
