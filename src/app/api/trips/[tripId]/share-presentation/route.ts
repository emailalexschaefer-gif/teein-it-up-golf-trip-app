/**
 * Release 3S -- Share, Celebrate & Preserve.
 *
 * GET    -> publication status (any member; the link itself only for the organiser)
 * POST   -> { action: 'preview' | 'publish', ... } organiser only
 * DELETE -> revoke the active publication, organiser only
 *
 * Publishing is always a deliberate organiser action. The stored snapshot is
 * two privacy-filtered decks built by the existing presentation engine; media
 * is stored by reference (never as signed URLs) and authorised on every request.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchEventMemoryData } from '@/lib/trips/eventMemoryData'
import { publishRequestSchema, validateConfigAgainstEvent } from '@/lib/sharing/configSchema'
import { buildSnapshot } from '@/lib/sharing/snapshot'
import { EXCLUSION_LABEL, type ExclusionReason } from '@/lib/sharing/eligibility'
import { sharePath } from '@/lib/sharing/chatMessage'
import { publishSnapshot, revokePublication } from '@/lib/sharing/publish'
import { SCOPE_KEY } from '@/lib/sharing/publish'
import { getAdmin, getMemberRole, originFromRequest, NO_STORE_HEADERS } from '@/lib/sharing/server'
import type { PresentationConfig } from '@/lib/trips/slideshowDeck'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

function summariseExclusions(items: { momentId: string; reason: ExclusionReason }[], nameById: Map<string, string | null>) {
  const byReason = new Map<ExclusionReason, number>()
  for (const i of items) byReason.set(i.reason, (byReason.get(i.reason) ?? 0) + 1)
  return {
    byReason: [...byReason.entries()].map(([reason, count]) => ({ reason, label: EXCLUSION_LABEL[reason], count })),
    items: items.map(i => ({ momentId: i.momentId, reason: i.reason, label: EXCLUSION_LABEL[i.reason], playerName: nameById.get(i.momentId) ?? null })),
  }
}

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  const role = await getMemberRole(admin, tripId, user.id)
  if (!role) return json({ error: 'Not a trip member.' }, 403)

  const { data: row } = await admin.from('shared_presentations')
    .select('id, token, status, public_enabled, version, published_at, public_name_mode, approved_event_moment_ids, approved_public_moment_ids, excluded_summary, chat_message_id')
    .eq('trip_id', tripId).eq('scope_key', SCOPE_KEY).eq('status', 'active').maybeSingle()
  if (!row) return json({ published: false })
  const isOrganiser = role === 'organiser'
  return json({
    published: true, publicEnabled: row.public_enabled === true, version: row.version, publishedAt: row.published_at, nameMode: row.public_name_mode,
    eventMediaCount: (row.approved_event_moment_ids ?? []).length, publicMediaCount: (row.approved_public_moment_ids ?? []).length,
    chatPosted: row.chat_message_id !== null,
    ...(isOrganiser ? { excluded: row.excluded_summary, publicUrl: `${originFromRequest(req)}${sharePath(row.token)}` } : {}),
  })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  if ((await getMemberRole(admin, tripId, user.id)) !== 'organiser') return json({ error: 'Only the organiser can publish the presentation.' }, 403)

  const parsed = publishRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'The presentation settings were not valid.' }, 400)
  const body = parsed.data
  if (body.publicEnabled && !body.attestCleared) return json({ error: 'Confirm the media has been cleared for sharing outside the event, or publish for event members only.' }, 400)
  if (body.nameMode === 'full' && !body.attestFullNames) return json({ error: 'Confirm that players’ full names may be shown publicly, or keep abbreviated names.' }, 400)

  const data = await fetchEventMemoryData(tripId, { generateSignedUrls: false })
  if (!data) return json({ error: 'Event not found.' }, 404)
  const config = body.config as PresentationConfig
  const configError = validateConfigAgainstEvent(config, data.rounds.map(r => r.id))
  if (configError) return json({ error: configError }, 400)

  const facts = { publicEnabled: body.publicEnabled, excludedMomentIds: new Set(body.excludedMomentIds) }
  const snap = buildSnapshot({ data, config, facts, nameMode: body.nameMode })
  const nameById = new Map(data.memories.map(m => [m.momentId, m.playerName ?? m.capturedByName]))
  const excluded = summariseExclusions(snap.publicExcluded, nameById)

  if (body.action === 'preview') {
    return json({
      ok: true, preview: true,
      counts: { eventMedia: snap.approvedEventMomentIds.length, publicMedia: snap.approvedPublicMomentIds.length, publicSlides: snap.publicDeck.slides.length, eventSlides: snap.eventDeck.slides.length },
      excluded,
    })
  }

  // ---- publish (create, or republish keeping the same link) ----
  const record = {
    title: data.event.name, event_deck: snap.eventDeck, public_deck: snap.publicDeck,
    duration_seconds: body.durationSeconds,
    approved_event_moment_ids: snap.approvedEventMomentIds, approved_public_moment_ids: snap.approvedPublicMomentIds,
    excluded_summary: excluded, public_name_mode: body.nameMode,
    public_enabled: body.publicEnabled, public_cleared_at: body.publicEnabled ? new Date().toISOString() : null,
    published_by: user.id, published_at: new Date().toISOString(),
  }
  const result = await publishSnapshot(admin, { tripId, userId: user.id, eventName: data.event.name, origin: originFromRequest(req), record })
  if (!result.ok) return json({ error: result.error }, result.status)
  return json({
    ok: true, published: true, republished: result.republished, version: result.version, publicUrl: result.publicUrl, chatPosted: result.chatPosted,
    counts: { eventMedia: snap.approvedEventMomentIds.length, publicMedia: snap.approvedPublicMomentIds.length }, excluded,
  })
}

export async function DELETE(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  if ((await getMemberRole(admin, tripId, user.id)) !== 'organiser') return json({ error: 'Only the organiser can unpublish the presentation.' }, 403)
  const r = await revokePublication(admin, tripId, SCOPE_KEY)
  if (!r.ok) return json({ error: 'Could not unpublish. Please try again.' }, 500)
  return json({ ok: true, revoked: r.revoked })
}
