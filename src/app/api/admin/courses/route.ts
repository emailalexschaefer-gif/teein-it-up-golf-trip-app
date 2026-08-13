/**
 * GET  /api/admin/courses — list every course (published and
 *      unpublished) — the organiser-facing search route only ever
 *      returns is_active=true, so this is deliberately a separate route
 *      rather than an ?includeInactive= flag on that one, keeping the
 *      member-facing route simple and impossible to accidentally expose
 *      unpublished data through.
 * POST /api/admin/courses — create a new course record.
 *
 * Both require requireAdmin() — the actual security boundary, not the
 * Admin UI's own nav hiding. Uses the admin client throughout: RLS would
 * independently block a non-admin from writing here too, but this route
 * doesn't rely on that as the only check.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('courses')
    .select('id, club_name, course_name, suburb, state, country, is_active, source, source_url, verified_at, updated_at')
    .order('club_name', { ascending: true })

  if (error) return NextResponse.json({ error: 'Could not load courses.' }, { status: 500 })
  return NextResponse.json({ courses: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const { club_name, course_name, suburb, state, country, source, source_url } = body as {
    club_name?: string; course_name?: string; suburb?: string | null; state?: string | null
    country?: string; source?: string | null; source_url?: string | null
  }
  if (!club_name?.trim() || !course_name?.trim()) {
    return NextResponse.json({ error: 'Club name and course name are required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from('courses').insert({
    club_name: club_name.trim(), course_name: course_name.trim(),
    suburb: suburb || null, state: state || null, country: country || 'Australia',
    source: source || null, source_url: source_url || null,
    is_active: false, // new courses start unpublished — admin publishes explicitly once satisfied, matching "Publish/Activate Course" as its own deliberate action
    updated_by: auth.userId,
  }).select('id').single()

  if (error) return NextResponse.json({ error: `Could not create course: ${error.message}` }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
