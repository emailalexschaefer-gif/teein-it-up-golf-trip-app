/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/published-highlights
 *      -> { publishedAt: string | null, highlights: Highlight[] }
 * POST /api/trips/[tripId]/rounds/[roundId]/published-highlights
 *      body: { highlights: Highlight[] } — organiser only
 *
 * Makers & Breakers Publish Lifecycle.
 *
 * GET is the ONLY read path this pass gives players — item 1's privacy
 * rule ("candidates visible only to the organiser... player-facing My
 * Golf must not expose the round's Makers & Breakers yet") is enforced
 * structurally here: if no row exists in published_round_highlights
 * for this round, this returns an empty array, full stop. There is no
 * fallback to recomputing candidates for a player caller — the
 * /highlights route (candidate generation) is organiser-only and stays
 * that way; this route never calls it. Item 12's "one qualification
 * engine -> one organiser selection -> one published result -> many
 * views" means My Golf can ONLY ever reach this endpoint, never the
 * candidate engine directly.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const { data, error } = await admin.from('published_round_highlights')
    .select('highlights, published_at').eq('round_id', roundId).eq('trip_id', tripId).maybeSingle()
  if (error) {
    console.error('[published-highlights GET]', { code: error.code, message: error.message, tripId, roundId })
    return NextResponse.json({ error: 'Could not load published highlights.' }, { status: 500 })
  }

  // No row = never published. Correctly returns an empty set, not an
  // error — an unpublished round is a normal, expected state, not a
  // failure.
  return NextResponse.json({ publishedAt: data?.published_at ?? null, highlights: data?.highlights ?? [] })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can publish Makers & Breakers.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const highlights = Array.isArray(body.highlights) ? body.highlights : null
  if (!highlights) return NextResponse.json({ error: 'highlights array is required.' }, { status: 400 })
  // Item 3 — "do not persist every unselected candidate." This is a
  // hard cap, not just documentation — the request body is exactly the
  // organiser's own selection from the curation screen, but this
  // sanity bound stops a genuinely broken client from silently
  // publishing the full candidate list as if it were curated.
  if (highlights.length > 12) {
    return NextResponse.json({ error: 'Too many highlights selected — choose the strongest few.' }, { status: 400 })
  }

  // Item 15 — republish replaces the row wholesale via UPSERT on the
  // UNIQUE round_id constraint, not a new row. published_at is only
  // set on true insert (COALESCE keeps the original publish timestamp
  // across an edit); updated_at always reflects the latest write.
  const existing = await admin.from('published_round_highlights').select('id, published_at').eq('round_id', roundId).maybeSingle()
  const { error } = await admin.from('published_round_highlights').upsert(
    {
      round_id: roundId, trip_id: tripId, highlights,
      published_by: user.id,
      published_at: existing.data?.published_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'round_id' },
  )
  if (error) {
    console.error('[published-highlights POST]', { code: error.code, message: error.message, tripId, roundId })
    return NextResponse.json({ error: "Couldn't publish. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, published: !existing.data, republished: !!existing.data })
}
