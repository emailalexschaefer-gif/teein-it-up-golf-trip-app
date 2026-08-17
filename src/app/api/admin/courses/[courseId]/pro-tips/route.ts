/**
 * PATCH /api/admin/courses/[courseId]/pro-tips
 * Body: { holeNumber: number, proTip: string | null }
 *
 * Pro Tip — course-level (course_id + hole_number), not tee-set-level,
 * per migration 056. Upserts a single hole's tip; an empty/null tip
 * simply deletes the row rather than storing an empty string, so "no
 * tip" is unambiguous (course_holes having no row for a hole) rather
 * than two different representations of the same "nothing here" state.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

interface RouteProps { params: Promise<{ courseId: string }> }

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { courseId } = await params

  const body = await req.json().catch(() => ({}))
  const holeNumber = typeof body.holeNumber === 'number' ? body.holeNumber : null
  const proTip = typeof body.proTip === 'string' ? body.proTip.trim() : null
  if (holeNumber === null || holeNumber < 1 || holeNumber > 18) {
    return NextResponse.json({ error: 'A valid hole number is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const courseCheck = await admin.from('courses').select('id').eq('id', courseId).maybeSingle()
  if (!courseCheck.data) return NextResponse.json({ error: 'Course not found.' }, { status: 404 })

  if (!proTip) {
    // Tips are optional — clearing it back to empty removes the row
    // entirely rather than storing '', so "no tip" is a single,
    // unambiguous state everywhere it's read from.
    const { error } = await admin.from('course_holes').delete().eq('course_id', courseId).eq('hole_number', holeNumber)
    if (error) return NextResponse.json({ error: `Could not clear tip: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, proTip: null })
  }

  const { error } = await admin
    .from('course_holes')
    .upsert({ course_id: courseId, hole_number: holeNumber, pro_tip: proTip, updated_at: new Date().toISOString() }, { onConflict: 'course_id,hole_number' })
  if (error) return NextResponse.json({ error: `Could not save tip: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, proTip })
}
