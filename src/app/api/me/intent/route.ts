import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isValidUserIntent, sanitizeOrganiserTypes } from '@/lib/profile/userIntent'

/**
 * POST /api/me/intent
 *
 * Crucial MVP Onboarding Update — persists the Player/Organiser/Both
 * segmentation captured during onboarding. Deliberately the player's
 * own row only (auth.uid(), never a client-supplied id) — this is
 * customer-segmentation metadata about the caller themselves, not
 * something one player could set for another.
 *
 * Explicitly does NOT touch app_role, trip_members, or any
 * organiser-permission surface — selecting "Organiser" here changes
 * nothing about what the caller is authorised to do in any existing or
 * future trip. That remains governed entirely by trips.organiser_id /
 * trip_members.role, exactly as before this feature.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const userIntent = body.userIntent
  const organiserTypes = body.organiserTypes

  if (!isValidUserIntent(userIntent)) {
    return NextResponse.json({ error: 'Invalid userIntent.' }, { status: 400 })
  }

  const cleanOrganiserTypes = sanitizeOrganiserTypes(userIntent, organiserTypes)

  const { error } = await supabase
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ user_intent: userIntent, organiser_types: cleanOrganiserTypes } as any)
    .eq('id', user.id)

  if (error) {
    console.error('[intent] update failed', { code: error.code, message: error.message })
    return NextResponse.json({ error: 'Could not save your answer.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
