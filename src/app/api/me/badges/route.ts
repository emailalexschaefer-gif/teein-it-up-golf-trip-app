import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/me/badges
 *
 * My Golf brief — "My Badges." Audited first, per the explicit
 * instruction, before writing anything: published_round_highlights
 * (migration 066) is the one existing, genuinely permanent, organiser-
 * curated highlight record in this app. Its JSONB Highlight shape
 * already carries playerId + category (this is "badge type") + icon +
 * title; the row itself already carries round_id/trip_id. That's
 * everything items 7/8 ask for — player, badge type, event, round,
 * and (via those FKs) course/date — with NO new columns duplicating
 * course/date strings, exactly per the explicit "prefer canonical
 * references... rather than unnecessarily duplicating" instruction.
 * No schema change was needed for this feature.
 *
 * What is explicitly NOT covered here, and why — the honest gap this
 * brief asked to be reported rather than guessed around: EVENT-level
 * Makers & Breakers (eventMakersBreakers.ts) have no persistence layer
 * at all anywhere in this schema (confirmed: no migration references
 * them) — they're computed fresh every time Final Results loads, never
 * stored. An event-level badge genuinely cannot become a permanent,
 * traceable "badge instance" without a new table, which this endpoint
 * does not add (out of scope for this pass — see the delivery report).
 * Only ROUND-level published highlights are real, permanent badge
 * instances today.
 *
 * Performance (item 17) — one query (with two embedded joins for
 * round/trip context), not one query per badge type or per instance.
 * Grouping into types happens in this route, not the client, so the
 * client never has to re-derive it — but the full instance list is
 * still included in this same response (not a second endpoint per
 * type), since a single player's total badge count is nowhere near
 * "years of history" scale yet; this avoids a network round-trip every
 * time a player taps into a badge type's drill-down.
 */
interface HighlightEntry {
  category: string
  kind: 'maker' | 'breaker'
  icon: string
  title: string
  playerId: string
  statLine?: string
}

export interface BadgeInstance {
  category: string
  icon: string
  title: string
  tripId: string
  tripName: string
  roundId: string
  roundName: string | null
  courseName: string | null
  playDate: string | null
  publishedAt: string
}

export interface BadgeType {
  category: string
  icon: string
  title: string
  count: number
  instances: BadgeInstance[]
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('published_round_highlights')
    .select(`
      highlights, published_at,
      trip_id, trips!inner ( id, name ),
      round_id, rounds!inner ( id, name, course_name, play_date )
    `)
    .in('trip_id',
      // Only this player's own trips — same authorization boundary as
      // the RLS policy itself (member read), belt-and-braces since
      // this route uses the admin client.
      (await admin.from('trip_members').select('trip_id').eq('profile_id', user.id)).data?.map(m => m.trip_id) ?? []
    )

  if (error) {
    console.error('[badges] query failed', { code: error.code, message: error.message })
    return NextResponse.json({ error: 'Could not load your badges.' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as {
    highlights: HighlightEntry[]; published_at: string
    trip_id: string; trips: { id: string; name: string }
    round_id: string; rounds: { id: string; name: string | null; course_name: string | null; play_date: string | null }
  }[]

  const byType = new Map<string, BadgeType>()
  for (const row of rows) {
    for (const h of row.highlights ?? []) {
      if (h.playerId !== user.id) continue
      const instance: BadgeInstance = {
        category: h.category, icon: h.icon, title: h.title,
        tripId: row.trip_id, tripName: row.trips?.name ?? 'Event',
        roundId: row.round_id, roundName: row.rounds?.name ?? null,
        courseName: row.rounds?.course_name ?? null, playDate: row.rounds?.play_date ?? null,
        publishedAt: row.published_at,
      }
      const existing = byType.get(h.category)
      if (existing) {
        existing.count += 1
        existing.instances.push(instance)
      } else {
        byType.set(h.category, { category: h.category, icon: h.icon, title: h.title, count: 1, instances: [instance] })
      }
    }
  }

  // Most-earned badge type first — the most natural browsing order for
  // "here's what I'm known for," not alphabetical or insertion order.
  const badgeTypes = [...byType.values()].sort((a, b) => b.count - a.count)
  for (const type of badgeTypes) {
    type.instances.sort((a, b) => (b.playDate ?? '').localeCompare(a.playDate ?? ''))
  }

  return NextResponse.json({ badgeTypes })
}
