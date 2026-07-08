// GET  /api/trips/[tripId]/groups  — list groups with members
// POST /api/trips/[tripId]/groups  — create a group

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase
  const result = await db
    .from('trip_groups')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json(result.data)
}

export async function POST(req: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name  = (body.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify organiser
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Get current max sort_order
  const countRes = await admin.from('trip_groups').select('sort_order').eq('trip_id', tripId).order('sort_order', { ascending: false }).limit(1)
  const sortOrder = (countRes.data?.[0]?.sort_order ?? -1) + 1

  const insertRes = await admin.from('trip_groups').insert({
    trip_id: tripId, name, sort_order: sortOrder,
  }).select().single()

  if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 500 })
  return NextResponse.json(insertRes.data, { status: 201 })
}
