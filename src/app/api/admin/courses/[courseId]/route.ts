/**
 * GET   /api/admin/courses/[courseId] — course + all tee sets + all hole
 *       data, for the admin detail/edit screen. Unlike the organiser-
 *       facing tee-sets route, this returns tee sets/holes regardless of
 *       is_active, since an admin needs to see and fix a draft/
 *       unpublished tee set too.
 * PATCH /api/admin/courses/[courseId] — update course fields, including
 *       is_active (publish/deactivate).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

interface RouteProps { params: Promise<{ courseId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { courseId } = await params

  const admin = createAdminClient()
  const courseRes = await admin.from('courses').select('*').eq('id', courseId).maybeSingle()
  if (!courseRes.data) return NextResponse.json({ error: 'Course not found.' }, { status: 404 })

  const teeSetsRes = await admin.from('course_tee_sets').select('*').eq('course_id', courseId).order('name', { ascending: true })
  const teeSetIds = (teeSetsRes.data ?? []).map((t: { id: string }) => t.id)
  const holesRes = teeSetIds.length > 0
    ? await admin.from('course_tee_holes').select('*').in('tee_set_id', teeSetIds).order('hole_number', { ascending: true })
    : { data: [] as { tee_set_id: string }[] }

  const holesByTeeSet = new Map<string, unknown[]>()
  for (const h of (holesRes.data ?? []) as { tee_set_id: string }[]) {
    if (!holesByTeeSet.has(h.tee_set_id)) holesByTeeSet.set(h.tee_set_id, [])
    holesByTeeSet.get(h.tee_set_id)!.push(h)
  }

  return NextResponse.json({
    course: courseRes.data,
    teeSets: (teeSetsRes.data ?? []).map((t: { id: string }) => ({ ...t, holes: holesByTeeSet.get(t.id) ?? [] })),
  })
}

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { courseId } = await params

  const body = await req.json().catch(() => ({}))
  const allowed = ['club_name', 'course_name', 'suburb', 'state', 'country', 'is_active', 'source', 'source_url', 'verified_at'] as const
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  update.updated_by = auth.userId

  if (Object.keys(update).length === 1) { // only updated_by got set — nothing real to change
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('courses').update(update).eq('id', courseId)
  if (error) return NextResponse.json({ error: `Could not update course: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
