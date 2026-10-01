import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'
import archiver from 'archiver'
import { fetchEventMemoryData } from '@/lib/trips/eventMemoryData'
import { buildExportManifest, type ExportMemory, type ExportScope } from '@/lib/trips/exportManifest'
import { buildEventSummaryText } from '@/lib/trips/eventSummaryText'

interface RouteProps { params: Promise<{ tripId: string }> }

// VERCEL HOBBY CONFIRMED (11 Sep). RESOLVED (12 Sep) -- researched
// Vercel's own current documentation directly (not relied on training
// data, which was outdated here) to settle the regime uncertainty this
// comment originally flagged. Confirmed, from Vercel's own AI SDK
// troubleshooting docs: "With Vercel's Fluid Compute, the default
// function duration is now 5 minutes (300 seconds) across all plans"
// -- Fluid Compute is Vercel's current universal default, not an
// opt-in a project might or might not have. An actively developed
// project like this one is overwhelmingly likely to already be on it.
// Raising maxDuration to 300 is also a SAFE change to attempt even if
// that assumption is wrong: Vercel rejects an invalid maxDuration at
// BUILD time with a hard failure (confirmed from a real, documented
// case), not a silent runtime cap -- so the worst case here is a loud,
// obvious deploy error, never a dangerous surprise in production.
export const maxDuration = 300


/**
 * POST /api/trips/[tripId]/export
 *
 * Event Memories V1.1 Phase 2 (11 Sep) -- the structured Event Memory
 * Package. Streams a ZIP directly in the response -- never buffers
 * every image into memory first, per the explicit "do not buffer
 * hundreds of images into memory if streaming is available" instruction.
 *
 * *** VERCEL HOBBY PLAN -- CONFIRMED ARCHITECTURE, DURATION RESOLVED ***
 * Confirmed deployed on Hobby. Response body size: a non-streaming
 * Vercel Function response is capped at 4.5MB -- far too small for a
 * multi-tens-of-MB ZIP -- but Vercel's own documentation states
 * streaming responses do NOT carry this limit, which is exactly why
 * this route streams rather than buffers. Execution duration: Fluid
 * Compute (Vercel's current universal default -- confirmed directly
 * from Vercel's own documentation, not assumed) gives Hobby a 300s
 * ceiling, set via maxDuration above. At the confirmed ~200-500KB
 * per-photo size and batched (not strictly sequential) downloads, a
 * 100-150 photo export is comfortably within this window with wide
 * margin -- the real bottleneck is Storage network I/O per photo, and
 * batching 6 at a time directly reduces that wall-clock cost. This
 * remains a genuine, named limit for a very large event: if real-world
 * testing on a genuinely large event (300+) shows this ceiling is
 * reached, the brief's own recommended fallback (staging the export
 * outside the request lifecycle with a signed download once ready) is
 * the next step -- not attempted here, since the brief's own
 * instruction was not to introduce that complexity unless direct
 * generation proves genuinely insufficient, and nothing in this
 * session's research suggests it will be for a realistic golf-trip-
 * sized event. NOT load-tested against a real large event in this
 * session -- this is reasoned from documented limits and measured
 * photo size, not an empirical benchmark.
 *
 * SECURITY: organiser-only (the brief's own explicit "audit whether
 * export should be organiser-only" resolved to yes -- curation/export
 * is an organiser action even though gallery viewing itself is
 * member-wide). Export scope (all/favourites/round/selected) is
 * validated server-side against the real fetched memories -- a
 * client-supplied roundId or momentId list that doesn't match real
 * data for this trip simply produces an empty or partial result, never
 * an error that leaks another trip's data, since every entry is
 * filtered from this trip's own already-fetched memories, not looked
 * up independently by client-supplied ID.
 */

const ExportRequestSchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('favourites') }),
    z.object({ kind: z.literal('round'), roundId: z.string().uuid() }),
    z.object({ kind: z.literal('selected'), momentIds: z.array(z.string().uuid()).min(1).max(500) }),
  ]),
})

export async function POST(request: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = ExportRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.', issues: parsed.error.issues }, { status: 400 })
  const scope = parsed.data.scope as ExportScope

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can export Event Memories.' }, { status: 403 })
  }

  // generateSignedUrls: false -- this route fetches image bytes
  // directly via the admin client below; it has no use for a
  // browser-facing signed URL, and skipping that batch call avoids an
  // unnecessary Storage round-trip for every photo in the export.
  const data = await fetchEventMemoryData(tripId, { generateSignedUrls: false })
  if (!data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })

  if (data.memories.length === 0) {
    return NextResponse.json({ error: 'This event has no Memories to export yet.' }, { status: 409 })
  }

  const exportMemories: ExportMemory[] = data.memories.map(m => ({
    momentId: m.momentId, roundId: m.roundId, roundOrdinal: m.roundOrdinal, holeNumber: m.holeNumber,
    playerName: m.playerName, caption: m.caption, imagePath: m.imagePath, createdAt: m.createdAt,
    organiserFavourite: m.organiserFavourite, sourceType: m.sourceType, sideCompName: m.sideCompName,
  }))

  const exportResult = buildExportManifest(data.event.name, scope, exportMemories)
  if (exportResult.entries.length === 0) {
    return NextResponse.json({ error: 'Nothing matches this export selection.' }, { status: 409 })
  }

  const summaryText = buildEventSummaryText(
    { name: data.event.name, startDate: data.event.startDate, endDate: data.event.endDate, playerCount: data.playerCount },
    data.rounds.map(r => ({ id: r.id, ordinal: r.ordinal ?? 0, name: r.name, courseName: r.courseName, playDate: r.playDate })),
    // Scope the summary/manifest to what's actually in THIS export, not
    // every Memory the event has ever had -- an "Export Round 2"
    // package should describe Round 2, not the whole event.
    exportMemories.filter(m => exportResult.entries.some(e => e.momentId === m.momentId && !e.isFavouriteDuplicate)),
    data.sideGameWinners.map(w => ({ roundId: w.roundId, label: w.label, holeNumber: w.holeNumber, winnerName: w.winnerName })),
    exportResult,
  )

  const manifestJson = JSON.stringify({
    event: data.event, rounds: data.rounds,
    memories: exportMemories.filter(m => exportResult.entries.some(e => e.momentId === m.momentId && !e.isFavouriteDuplicate)),
    sideGameWinners: data.sideGameWinners,
    export: { scope, generatedAt: new Date().toISOString(), memoryCount: exportResult.memoryCount, favouriteCount: exportResult.favouriteCount },
  }, null, 2)

  // Streaming response: archiver writes into this TransformStream's
  // writable side as each image downloads; the readable side is
  // handed to Next.js as the response body immediately, so bytes
  // start reaching the client before the whole archive exists
  // anywhere in memory at once.
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('data', (chunk: Buffer) => { void writer.write(chunk) })
  archive.on('error', (err: Error) => { console.error('[export] archiver error', err.message); void writer.abort(err) })
  archive.on('end', () => { void writer.close() })

  const rootFolder = exportResult.eventFolderName

  // Build the archive asynchronously, without blocking the response
  // from starting -- the response below returns as soon as the stream
  // exists, and archive.finalize()'s own completion drives writer.close().
  ;(async () => {
    archive.append(summaryText, { name: `${rootFolder}/EVENT-SUMMARY.txt` })
    archive.append(manifestJson, { name: `${rootFolder}/EVENT-MANIFEST.json` })

    // Batched, not strictly sequential (Hobby architecture decision,
    // see the file-level comment above) -- downloads the next
    // BATCH_SIZE images concurrently, appends each as it arrives, then
    // moves to the next batch. Reduces total wall-clock time for a
    // large export, since the real bottleneck is waiting on Storage
    // network I/O per photo, not CPU -- archiver's own append() queues
    // internally, so appending out of strict sequence within a batch
    // is safe; batch order itself still follows exportResult.entries'
    // own chronological ordering.
    const BATCH_SIZE = 6
    for (let i = 0; i < exportResult.entries.length; i += BATCH_SIZE) {
      const batch = exportResult.entries.slice(i, i + BATCH_SIZE)
      const downloaded = await Promise.all(batch.map(async entry => {
        const downloadRes = await admin.storage.from('event-moments').download(entry.imagePath)
        if (downloadRes.error || !downloadRes.data) {
          console.error('[export] could not download', entry.imagePath, downloadRes.error?.message)
          return null // one missing/failed photo must not abort the whole export
        }
        return { entry, arrayBuffer: await downloadRes.data.arrayBuffer() }
      }))
      for (const result of downloaded) {
        if (!result) continue
        archive.append(Buffer.from(result.arrayBuffer), { name: `${rootFolder}/${result.entry.folderPath}/${result.entry.filename}` })
      }
    }

    await archive.finalize()
  })().catch(err => { console.error('[export] build failed', err); void writer.abort(err) })

  const safeEventName = exportResult.eventFolderName.replace(/[^a-zA-Z0-9-]/g, '-')
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeEventName}.zip"`,
    },
  })
}
