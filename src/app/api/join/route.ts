import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const JoinSchema = z.object({
  invite_code:      z.string().min(1).max(20),
  playing_handicap: z.number().nullable().optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Please sign in again before joining this trip.' }, { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const parsed = JoinSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "We couldn't find a trip with that invite code." }, { status: 400 })
  }

  const { invite_code, playing_handicap = null } = parsed.data
  const code = invite_code.trim().toUpperCase()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Look up trip by invite code (case-insensitive via toUpperCase normalisation)
  const tripResult = await admin
    .from('trips')
    .select('id, name, status')
    .ilike('invite_code', code)
    .single()

  if (tripResult?.error || !tripResult?.data) {
    return NextResponse.json({ error: "We couldn't find a trip with that invite code." }, { status: 404 })
  }

  const trip = tripResult.data

  if (trip.status === 'archived') {
    return NextResponse.json({ error: 'This trip is no longer accepting players.' }, { status: 410 })
  }

  if (trip.status === 'completed' || trip.status === 'live') {
    // Still allow joining live/completed trips — organiser controls this
  }

  // Check if already a member — return success without inserting
  const existingResult = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (existingResult?.data) {
    return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: true })
  }

  // Build the insert payload — only include playing_handicap if it has a value
  // This prevents schema cache errors when the column hasn't been added yet
  const memberRow: Record<string, unknown> = {
    trip_id:    trip.id,
    profile_id: user.id,
    role:       'player',
  }
  if (playing_handicap !== null && playing_handicap !== undefined) {
    memberRow.playing_handicap = playing_handicap
  }

  const { error: insertError } = await admin
    .from('trip_members')
    .insert(memberRow)

  if (insertError) {
    console.error('[POST /api/join] insert error', {
      message: insertError.message,
      code:    insertError.code,
      details: insertError.details,
      hint:    insertError.hint,
    })

    const m = (insertError.message ?? '').toLowerCase()

    if (m.includes('unique') || m.includes('duplicate')) {
      // Race condition — already a member by the time we inserted
      return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: true })
    }

    return NextResponse.json({
      error: "We couldn't join the trip. Please try again."
    }, { status: 500 })
  }

  // Best-effort: update permanent profile handicap if one was provided
  if (playing_handicap !== null && playing_handicap !== undefined) {
    await admin
      .from('profiles')
      .update({ handicap: playing_handicap })
      .eq('id', user.id)
      .then(() => {})
  }

  return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: false }, { status: 201 })
}
