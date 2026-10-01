# EVENT MEMORIES V1 -- FUNCTIONAL SPECIFICATION + INFRASTRUCTURE
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access, no live database or Storage connection. Full test suite:
**485/485 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 52 SQL-scanning migration tests (40 existing +
12 new) + 63 trips.

**Headline: the gallery, favourites, individual download, and the
Event Memory Manifest are built. Download Selected/All (server-side
ZIP) was investigated and honestly deferred per the brief's own stop
condition, and the manifest's Champion/standings field is deferred for
a separate, specific reason** -- both explained fully below, not
glossed over.

---

## 1. EXISTING MOMENTS/MEDIA ARCHITECTURE DISCOVERED

moments (migration 028) is already the single canonical record for a
captured photo. One row per Moment, carrying trip_id, round_id
(nullable), hole_number, player_id, caption, image_path,
audience ('everyone'/'group'), created_at. It already has a mirrored
event_messages row (message_type = 'moment', linked via moment_id)
so Chat shows Moments without a second feed, and
side_comp_entries.moment_id/side_comp_lead_changes.moment_id already
link a verified Side Game result back to its photo -- exactly the
"one canonical record, multiple consuming surfaces" model the brief
asked for confirmed, not assumed, before building anything.
published_round_highlights has no direct link to a specific Moment --
Highlights are text (statLine/caption), not photo-attached --
confirmed by searching every highlights source file for moment_id
and finding none.

## 2. EXISTING STORAGE ARCHITECTURE/PATH

Bucket event-moments. Path convention (confirmed from the actual
upload call in MomentCapture.tsx, established in the prior Event
Management phase):
${tripId}/${roundId ?? 'general'}/${userId}/${timestamp}.${ext}.
Images are resized client-side to a 1600px maximum dimension before
upload -- confirmed directly in the capture component. This means the
stored file already is the effective "original" this app keeps; there
is no separate higher-resolution copy to fall back to for downloads,
and no separate thumbnail generation was needed for the gallery grid
either, since 1600px is already a reasonable size for both.

## 3. SCHEMA CHANGES MADE AND WHY

One migration, 085_moments_event_favourite.sql: a single column,
moments.is_event_favourite BOOLEAN NOT NULL DEFAULT false. Chosen
over a separate event_memory_selections relationship table because
only one selection category exists right now (the organiser's own
pick) -- per the brief's own "do not over-engineer," a relationship
table earns its complexity once a second category actually needs
relating against, not before. Additive only; every existing Moment
defaults to false.

## 4. EVENT MEMORIES CANONICAL DATA SOURCE

GET /api/trips/[tripId]/memory-manifest -- see item 10. The gallery
page consumes this same manifest directly rather than a separate
"gallery" endpoint, so there is exactly one data-fetching path for
Event Memories, not two that could drift apart.

## 5. HOW DUPLICATE PHOTOS ARE PREVENTED

Structural, not a de-duplication step: the manifest's memories array
comes from one SELECT against moments, scoped to trip_id, with no
join that fans out rows (confirmed and locked in by a dedicated test).
Because moments was already the single canonical record before this
work started (item 1), "the same Moment appearing once in Chat, My
Golf, and Event Memories" was never a duplication risk to solve --
every surface reads the same row.

## 6. GALLERY/FILTER IMPLEMENTATION

/trips/[tripId]/memories (page.tsx). Header shows event name and
photo/round counts; an "All / R1 / R2 / ..." filter row is generated
from manifest.rounds directly (never a hard-coded round count, per
the explicit instruction). A responsive 3-column grid renders each
Memory's signed thumbnail with a star badge for organiser favourites.
Selecting a photo opens a lightbox with caption, player, hole, and
round context -- only fields that genuinely exist on the Moment are
shown, nothing fabricated (Side Game/Highlight context per photo was
not added to the detail view, since no direct linkage exists to read
from -- see item 1).

## 7. FAVOURITE/SELECTION PERSISTENCE IMPLEMENTATION

PATCH /api/trips/[tripId]/memories/[momentId]/favourite,
organiser-only (403 otherwise, checked before the write), scoped to
both momentId and trip_id together in the same UPDATE (a momentId
belonging to another trip matches zero rows, confirmed by test). The
write is a plain boolean assignment -- idempotent by construction:
setting an already-true value to true again is the same no-op UPDATE,
not a special-cased branch that could diverge between "set" and
"already set."

## 8. INDIVIDUAL DOWNLOAD IMPLEMENTATION

GET /api/trips/[tripId]/memories/[momentId]/download returns a
5-minute signed URL to the exact stored object -- no recompression
(item 2). Access is derived from the identical rule Moments' own RLS
read policy already uses (everyone / shared group / own upload),
applied explicitly in this route since it uses the admin client and
must therefore enforce that rule itself rather than relying on RLS.
This is deliberately not organiser-only -- a player can download
exactly what they could already see, preserving existing access rather
than narrowing or widening it.

## 9. DOWNLOAD SELECTED/ALL FEASIBILITY FINDINGS

Investigated, not implemented, per the brief's own explicit stop
condition. Photos are already capped at 1600px client-side, so a
typical stored JPEG is roughly 200-500KB. For the brief's own target
range (100-500 photos per event), a full ZIP could range from
~30MB to ~250MB. Without knowing this deployment's actual Vercel plan
(execution time and memory limits vary significantly between Hobby,
Pro, and Enterprise), generating and streaming a ZIP of that size from
a serverless function is a genuine, unverifiable risk -- not something
to build and hope works. Per the brief's explicit "if not safe,
establish the selection infrastructure now and defer ZIP generation
rather than building something unreliable": the selection
infrastructure (Manage mode, multi-select, the favourite-selected
action) is built and working; Download Selected/All (ZIP) is not, and
no broken button was added for it -- there is no "Download Selected" or
"Download All" control in the shipped UI at all, matching "if ZIP
generation isn't production-safe yet, display no broken button."

## 10. EVENT MEMORY MANIFEST DESIGN

GET /api/trips/[tripId]/memory-manifest returns:

    { event: { id, name, eventType, location, startDate, endDate, status },
      rounds: [{ id, name, courseName, playDate, status, holes, publishedHighlights }],
      memories: [{ momentId, roundId, holeNumber, playerId, playerName, caption, imagePath, imageUrl, audience, createdAt, organiserFavourite }],
      sideGameWinners: [{ sideCompId, roundId, compType, label, holeNumber, winnerPlayerId, winnerName }],
      results: { champion: null } }

Every field is read from an existing canonical source (item 12 below)
except results.champion, deferred for the specific reason in item 19.
imageUrl is a batch-generated signed URL (Supabase's own
createSignedUrls, one call for every Memory, not one round-trip per
photo) -- directly addresses the Part 20 performance concern for a
100-500 photo event.

## 11. PERMISSIONS/SECURITY MODEL

- Manifest: any trip member (matching final-results's own rule) --
  players continue to see Event context, not organiser-only.
- Favourite: organiser-only, verified before the write.
- Download: matches Moments' own existing visibility rule exactly, not
  a new, broader one.
- Cross-trip protection: every mutation/lookup is scoped to both the
  resource id and trip_id together in the same query -- confirmed by
  dedicated tests for both the favourite and download routes. A
  momentId from another organiser's trip is simply never matched,
  regardless of the caller's own role in whichever trip they do own.

## 12. ARCHIVE/RESTORE BEHAVIOUR

Not modified, and confirmed nothing needed to be: moments has no
archived-specific logic anywhere, and Archive/Restore (from the Event
Management work) only ever changes trips.status -- it never touches
moments, event_messages, side_comps, or published_round_highlights
rows. Every table the manifest reads from is therefore untouched by
Archive/Restore, and the manifest/gallery work identically for an
Archived trip as for a Completed one (subject to the same
trip-membership check as any other status).

## 13. PERMANENT DELETE INTERACTION

Not modified, and confirmed to already compose correctly: the safety
gate built in the prior session (trip_has_protected_history()) already
checks for a moments row as one of its seven independent blocking
signals. An event containing any Event Memory is therefore already
ineligible for Permanent Delete under the existing rule -- nothing new
was needed here, and nothing in this delivery introduces a second
deletion path that could bypass it.

## 14. PERFORMANCE/PAGINATION STRATEGY

Signed URLs are batch-generated in one call (item 10). Full pagination
for a 500-photo gallery (incremental loading rather than one manifest
call returning everything) was not implemented this session -- the
manifest currently returns every Memory in one response. For the
brief's own upper target (500 photos), this is a real, named gap: the
response payload and the batch signed-URL call both grow linearly with
photo count, and neither was load-tested against that size. Flagged
honestly rather than assumed fine.

## 15. TESTS ADDED

12, in eventMemoriesV1.test.ts -- source-scanning contract tests
against the real routes and migration (no live Postgres/Storage
connection exists here): the favourite column is additive and
NOT NULL DEFAULT false; the manifest requires membership, not
organiser-only; the memories query is scoped to trip_id with no
fan-out join; Side Game winners are read from
official_winner_entry_id and never from side_comp_lead_changes
directly; highlights are read from published_round_highlights and
never regenerated from score_entries; champion is explicitly null,
not guessed; the favourite route checks organiser status before
writing; the favourite update and the download lookup are both scoped
to momentId + trip_id together; the favourite write is a plain
boolean assignment; the download route's access rule matches Moments'
own everyone/group/own-upload shape; and the download route returns a
signed URL, never a raw path.

Not added, and why: several of Part 24's 18 numbered scenarios
(round filtering, back-nine/starting-hole non-effect on association,
archived-event retention, cross-trip storage rejection at the actual
Storage layer) would need a live database and Storage bucket to
exercise genuinely -- the contract tests above verify the logic that
would produce those outcomes, not a substitute for running them for
real.

## 16. FULL TEST-SUITE RESULT

**485/485 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 52 SQL-scanning migration tests + 63 trips.
Confirmed via a fresh, complete run this session.

## 17. FILES CHANGED

- `supabase/migrations/085_moments_event_favourite.sql` (new)
- `src/app/api/trips/[tripId]/memory-manifest/route.ts` (new)
- `src/app/api/trips/[tripId]/memories/[momentId]/favourite/route.ts` (new)
- `src/app/api/trips/[tripId]/memories/[momentId]/download/route.ts` (new)
- `src/app/(app)/trips/[tripId]/memories/page.tsx` (new)
- `src/lib/scoring/eventMemoriesV1.test.ts` (new -- 12 tests)

**One real bug caught and fixed while building the gallery page, worth
surfacing directly:** the page originally assumed
GET /api/trips/[tripId] returns { isOrganiser } -- checking the actual
route revealed it only exports PATCH/DELETE, no GET at all. Found the
existing GET /api/trips/[tripId]/my-role route (returns { role }) and
fixed the client to use that instead, before this shipped as a silent
bug that would have hidden the Manage/Favourite controls from every
real organiser.

## 18. MIGRATIONS ADDED

One: 085_moments_event_favourite.sql, described in item 3. No table
schema change beyond the single new column; no data migration.

## 19. ANYTHING DEFERRED

- **Download Selected/All (ZIP generation)** -- item 9, deferred per
  the brief's own explicit instruction, with the selection
  infrastructure (Manage mode, multi-select) built and ready for it.
- **results.champion** -- computing this correctly needs the same
  multi-round countback logic final-results/route.ts already has
  (shotgun starts, per-hole play order, group starting holes).
  Re-implementing it inside the manifest risked exactly the
  duplicate-calculation outcome Part 12 explicitly warns against, or a
  second champion calculation that could subtly diverge from the
  canonical one. Extracting that route's logic into a shared function
  both routes call is the right next step, not attempted this session
  to avoid destabilising a complex, working route under time pressure.
  Consumers needing the champion today can call the existing
  final-results route directly; the manifest's shape already reserves
  the field so this isn't a breaking change later.
- **Pagination for large galleries** -- item 14, not implemented; a
  named, real gap for the brief's own upper size target.
- **Side Game/Highlight context in the photo detail view** -- not
  shown, since no direct Moment-to-Highlight linkage exists to read
  from (item 1); adding one would mean designing new linkage
  infrastructure, which the brief's own Part 3 says to avoid unless the
  audit shows it's already there.

## 20. ANYTHING REQUIRING LIVE SUPABASE/DEVICE VALIDATION

Everything -- nothing here has touched a live database or Storage
bucket. Most important specifically for this feature, roughly in the
brief's own Part 25 order:
1. The full real-device acceptance flow: capture several Moments
   including one Side-Game-linked photo, open Event Memories, confirm
   every photo appears exactly once, filter by round, open the detail
   view, favourite it, refresh, confirm the favourite persisted.
2. Download an individual original and confirm it's the genuine,
   uncompressed stored file.
3. Archive the event, confirm Memories remain exactly as they were;
   Restore, confirm nothing changed.
4. Confirm the batch signed-URL call actually performs acceptably at
   the brief's own upper end (100-500 photos) -- genuinely untested at
   that scale here.
5. Confirm cross-trip protection at the actual database/RLS layer, not
   just the query-construction level this session's tests can verify.
