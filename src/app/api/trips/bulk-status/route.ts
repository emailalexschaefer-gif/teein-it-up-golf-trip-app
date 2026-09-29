import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

/**
 * POST /api/trips/bulk-status
 *
 * Event Management Phase 2 (10 Sep), Parts 3 + 5 -- bulk Archive and
 * bulk Restore, one route, since both are the same shape of operation
 * (an explicit ID list, one eligible source status, one target
 * status) and the brief's own explicit safety rules apply identically
 * to each direction.
 *
 * EXPLICIT-ID MUTATION DESIGN, per the brief's own repeated emphasis:
 * this route NEVER constructs a query like
 * "UPDATE all organiser trips WHERE status = X" -- the WHERE clause
 * below is always scoped to `.in('id', tripIds)` AND the ownership/
 * status checks, together, in the same query. There is no code path
 * here that can touch a trip whose id was not explicitly supplied in
 * the request body.
 *
 * SERVER-SIDE ELIGIBILITY, not client-trusted: for 'archive', only
 * rows where status = 'completed' AND organiser_id = the
 * authenticated caller are eligible; for 'restore', only
 * status = 'archived' for the same organiser. A Live/Upcoming/Active
 * event can never be archived through this endpoint regardless of
 * what the client requests, and a trip owned by someone else is never
 * touched regardless of whether its id was supplied.
 *
 * PARTIAL FAILURE, not hidden: the UPDATE's own .select() returns
 * exactly the rows that were actually changed. Comparing that against
 * the requested id list produces an accurate succeeded/failed report
 * -- the response never claims more happened than genuinely did.
 */

const BulkStatusSchema = z.object({
  tripIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['archive', 'restore']),
})

const TRANSITIONS: Record<'archive' | 'restore', { from: string; to: string }> = {
  archive: { from: 'completed', to: 'archived' },
  restore: { from: 'archived', to: 'completed' },
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = BulkStatusSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.', issues: parsed.error.issues }, { status: 400 })
  const { tripIds, action } = parsed.data
  const { from, to } = TRANSITIONS[action]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Dedupe defensively — a client-side double-select shouldn't count
  // as two attempts against the same id in the reporting below.
  const uniqueIds = [...new Set(tripIds)]

  const updateRes = await admin.from('trips')
    .update({ status: to })
    .in('id', uniqueIds)
    .eq('organiser_id', user.id)
    .eq('status', from)
    .select('id')

  if (updateRes.error) {
    console.error('[bulk-status]', action, updateRes.error.message)
    return NextResponse.json({ error: 'Could not complete the bulk operation. Please try again.' }, { status: 500 })
  }

  const succeeded = new Set((updateRes.data ?? []).map((r: { id: string }) => r.id))
  const failed = uniqueIds.filter(id => !succeeded.has(id))

  // For every id that didn't succeed, distinguish "not yours" /
  // "already somewhere else" from "doesn't exist at all" — genuinely
  // useful for the client's retry/reporting UI, not just a flat
  // failure list. Read-only, and only for ids that already failed —
  // never touches anything.
  let failedDetail: { id: string; reason: string }[] = []
  if (failed.length > 0) {
    const lookupRes = await admin.from('trips').select('id, organiser_id, status').in('id', failed)
    const byId = new Map((lookupRes.data ?? []).map((t: { id: string; organiser_id: string; status: string }) => [t.id, t]))
    failedDetail = failed.map(id => {
      const t = byId.get(id) as { organiser_id: string; status: string } | undefined
      if (!t) return { id, reason: 'Event not found.' }
      if (t.organiser_id !== user.id) return { id, reason: 'Not authorised for this event.' }
      return { id, reason: `Event is not currently ${from === 'completed' ? 'completed' : 'archived'}.` }
    })
  }

  return NextResponse.json({
    succeededIds: [...succeeded],
    failed: failedDetail,
  })
}
