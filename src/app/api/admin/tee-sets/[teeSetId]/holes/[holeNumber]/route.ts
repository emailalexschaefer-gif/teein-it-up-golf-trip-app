/**
 * PUT /api/admin/tee-sets/[teeSetId]/holes/[holeNumber] — upsert exactly
 * one hole's par/stroke index/distance. This is the concrete
 * implementation of "an admin should be able to open Sandhurst
 * Champions → White Tees → Hole 5 and change Par/Stroke Index/Distance"
 * without touching any other hole or requiring the whole course to be
 * replaced — every other hole row for this tee set is completely
 * untouched by this request.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/requireAdmin'

interface RouteProps { params: Promise<{ teeSetId: string; holeNumber: string }> }

export async function PUT(req: NextRequest, { params }: RouteProps) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { teeSetId, holeNumber } = await params
  const holeNum = Number(holeNumber)
  if (!Number.isInteger(holeNum) || holeNum < 1 || holeNum > 18) {
    return NextResponse.json({ error: 'Invalid hole number.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const { par, stroke_index, distance } = body as { par?: number; stroke_index?: number | null; distance?: number | null }
  if (typeof par !== 'number' || par < 3 || par > 6) {
    return NextResponse.json({ error: 'Par must be between 3 and 6.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('course_tee_holes').upsert({
    tee_set_id: teeSetId, hole_number: holeNum,
    par, stroke_index: stroke_index ?? null, distance: distance ?? null,
  }, { onConflict: 'tee_set_id,hole_number' })

  if (error) return NextResponse.json({ error: `Could not save hole ${holeNum}: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
