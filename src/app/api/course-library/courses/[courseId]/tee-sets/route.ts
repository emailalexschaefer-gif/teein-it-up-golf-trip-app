/**
 * GET /api/course-library/courses/[courseId]/tee-sets
 *
 * Tee sets (with nested hole data) for a selected course. Read-only,
 * same RLS-boundary reasoning as the search route. Deliberately returns
 * everything a tee set has, including nulls — course_rating/slope_
 * rating/distance/stroke_index are all nullable in the schema, and this
 * route doesn't filter or hide incomplete tee sets. "The UI must handle
 * partial library records gracefully" starts here: this is the exact
 * shape the organiser Course Setup UI has to render sensibly even when
 * most fields are null (see the seeded Sandhurst Champions placeholder
 * tee set — real par/stroke index, no distance yet).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteProps { params: Promise<{ courseId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { courseId } = await params
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const courseRes = await supabase.from('courses').select('id, club_name, course_name, suburb, state, is_active').eq('id', courseId).maybeSingle()
  if (!courseRes.data || !courseRes.data.is_active) {
    return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
  }

  const teeSetsRes = await supabase
    .from('course_tee_sets')
    .select('id, name, colour, gender, par, total_distance, course_rating, slope_rating')
    .eq('course_id', courseId).eq('is_active', true)
    .order('name', { ascending: true })

  if (teeSetsRes.error) {
    console.error('[course-library tee-sets]', teeSetsRes.error)
    return NextResponse.json({ error: 'Could not load tee sets.' }, { status: 500 })
  }

  const teeSetIds = (teeSetsRes.data ?? []).map(t => t.id)
  const holesRes = teeSetIds.length > 0
    ? await supabase.from('course_tee_holes').select('tee_set_id, hole_number, par, stroke_index, distance').in('tee_set_id', teeSetIds).order('hole_number', { ascending: true })
    : { data: [] as { tee_set_id: string; hole_number: number; par: number; stroke_index: number | null; distance: number | null }[] }

  const holesByTeeSet = new Map<string, { hole_number: number; par: number; stroke_index: number | null; distance: number | null }[]>()
  for (const h of holesRes.data ?? []) {
    if (!holesByTeeSet.has(h.tee_set_id)) holesByTeeSet.set(h.tee_set_id, [])
    holesByTeeSet.get(h.tee_set_id)!.push({ hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index, distance: h.distance })
  }

  return NextResponse.json({
    course: courseRes.data,
    teeSets: (teeSetsRes.data ?? []).map(t => ({ ...t, holes: holesByTeeSet.get(t.id) ?? [] })),
  })
}
