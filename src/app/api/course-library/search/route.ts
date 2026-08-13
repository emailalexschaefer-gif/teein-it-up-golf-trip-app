/**
 * GET /api/course-library/search?q=...
 *
 * Organiser-facing course search. Read-only, no trip/round scoping — the
 * library is global, not tied to any one trip. Uses the REGULAR
 * (RLS-subject) Supabase client deliberately: the "Members: read
 * published courses" policy (migration 039) already correctly restricts
 * this to is_active=true rows for any authenticated user, so there's no
 * need for the admin client or a manual membership check here — RLS is
 * the actual boundary. Returns at most 20 matches; the four seeded
 * courses today, more as the library grows, with zero code changes
 * required for that growth.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()

  let query = supabase
    .from('courses')
    .select('id, club_name, course_name, suburb, state')
    .eq('is_active', true)
    .order('club_name', { ascending: true })
    .limit(20)

  // Empty query returns the first 20 published courses (useful for an
  // initial "browse" state) rather than nothing — matches how the four
  // seeded courses should be immediately visible without the organiser
  // needing to type anything first.
  if (q.length > 0) {
    query = query.or(`club_name.ilike.%${q}%,course_name.ilike.%${q}%,suburb.ilike.%${q}%`)
  }

  const { data, error: queryError } = await query
  if (queryError) {
    console.error('[course-library search]', queryError)
    return NextResponse.json({ error: 'Could not search courses.' }, { status: 500 })
  }

  return NextResponse.json({ courses: data ?? [] })
}
