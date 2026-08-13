/**
 * POST /api/admin/courses/[courseId]/tee-sets — create a new tee set,
 * optionally pre-populated with 18 (or 9) blank holes so the admin can
 * immediately start filling in par/stroke index/distance per hole
 * without a separate "add hole" step for every single hole.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

interface RouteProps { params: Promise<{ courseId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { courseId } = await params

  const body = await req.json().catch(() => ({}))
  const { name, colour, gender, holeCount } = body as { name?: string; colour?: string | null; gender?: string | null; holeCount?: number }
  if (!name?.trim()) return NextResponse.json({ error: 'Tee set name is required.' }, { status: 400 })

  const admin = createAdminClient()
  const teeSetRes = await admin.from('course_tee_sets').insert({
    course_id: courseId, name: name.trim(), colour: colour || null, gender: gender || null,
    is_active: false, updated_by: auth.userId,
  }).select('id').single()

  if (teeSetRes.error) {
    return NextResponse.json({ error: `Could not create tee set: ${teeSetRes.error.message}` }, { status: 500 })
  }

  const holes = Math.min(Math.max(holeCount ?? 18, 1), 18)
  const holeRows = Array.from({ length: holes }, (_, i) => ({
    tee_set_id: teeSetRes.data.id, hole_number: i + 1, par: 4, stroke_index: null, distance: null,
  }))
  const { error: holesError } = await admin.from('course_tee_holes').insert(holeRows)
  if (holesError) {
    // The tee set itself was created successfully; blank holes are a
    // convenience, not a requirement — logged, not fatal to the request.
    console.error('[admin tee-sets] blank hole scaffold insert failed', holesError)
  }

  return NextResponse.json({ id: teeSetRes.data.id }, { status: 201 })
}
