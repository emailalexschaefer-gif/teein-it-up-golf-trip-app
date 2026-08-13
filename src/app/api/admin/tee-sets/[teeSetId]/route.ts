/**
 * PATCH /api/admin/tee-sets/[teeSetId] — edit tee-level fields
 * independently of any hole data. Same granular-editing principle as
 * the per-hole route: an admin fixing the slope rating shouldn't need
 * to touch anything else about this tee set or its course.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

interface RouteProps { params: Promise<{ teeSetId: string }> }

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { teeSetId } = await params

  const body = await req.json().catch(() => ({}))
  const allowed = ['name', 'colour', 'gender', 'par', 'total_distance', 'course_rating', 'slope_rating', 'is_active'] as const
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  update.updated_by = auth.userId

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('course_tee_sets').update(update).eq('id', teeSetId)
  if (error) return NextResponse.json({ error: `Could not update tee set: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
