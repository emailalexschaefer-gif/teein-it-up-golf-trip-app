# EVENT MEMORIES V1.1 -- PHASE 1 AUDIT
## Provenance + Architecture Investigation ONLY

**No code was written this session.** Per the explicit "do not start
broad implementation until the audit establishes that the model is
correct" instruction, this is a report, not a delivery. Every claim
below was confirmed by reading the actual schema/migrations/route code
directly -- not assumed from naming or prior summaries.

---

## 1. EXISTING MOMENT PROVENANCE DISCOVERED

moments (028, extended by 030 and 063) is the single canonical
record. Confirmed columns: id, trip_id, round_id (nullable),
hole_number (nullable), player_id, captured_by (nullable, added by
063), group_id (nullable), caption, image_path (nullable, made
nullable by 030), audience, moment_type ('photo'|'text', added by
030), created_at, plus is_event_favourite (085, this engagement's
own prior work).

captured_by is NOT "who uploaded it" in general -- it is specifically
the proxy-capture field: NULL means the subject (player_id) captured
their own Moment (the overwhelming majority of rows); non-null means
someone else captured it of that player (a same-group teammate or
organiser proxy), confirmed directly in moments/route.ts's own insert
logic.

There is no source_type or moment_type-equivalent column
distinguishing "where this Moment was captured from" (Chat vs. a Side
Game vs. anything else). moment_type is a different concept entirely
-- photo vs. text, not provenance.

## 2. EVERY MOMENT CREATION PATH

Exactly one server-side insertion point: POST
/api/trips/[tripId]/moments -- confirmed by searching the entire
codebase for .from('moments').insert and finding this single match.
There is no scattered creation logic to reconcile.

Three distinct client entry points, all rendering the same
MomentCapture component, which all call the one route above:
1. EventMessages.tsx (the Chat tab) -- chat/page.tsx passes
   roundId={activeRound?.id ?? null}. Confirmed this means a Moment
   captured from Chat during an active round carries the exact same
   round_id as any other in-round Moment -- round_id being non-null
   does not distinguish "came from Chat" from any other round-scoped
   capture, because there is no third, separate "general round
   Moment" UI surface outside Chat and Side Games at all. This is a
   genuine finding, not an assumption: Chat is currently the only UI
   for a non-Side-Game Moment.
2. SideCompEntryPanel.tsx -- capturing a photo alongside submitting a
   Side Game claim.
3. NewLeaderPrompt.tsx -- capturing a photo at the moment a player
   takes the lead in a Side Game.

(2) and (3) pass sideCompId/sideCompEntryId/leadChangeId to the
route. Important: sideCompId is received by the route but never
stored anywhere -- only sideCompEntryId/leadChangeId are used, to
update side_comp_entries.moment_id/side_comp_lead_changes.moment_id
AFTER the Moment itself is created, via a reverse link (the Side Game
row points at the Moment; the Moment itself has no forward pointer to
the Side Game). This reverse-link pattern is also how this
engagement's earlier work (the shared-device Moment merge fix)
already relies on this exact relationship.

## 3. WHICH DESIRED METADATA ALREADY SURVIVES

- Event/trip: AVAILABLE -- moments.trip_id
- Round: AVAILABLE (nullable) -- moments.round_id; null for an
  event-level Moment
- Hole: AVAILABLE (nullable) -- moments.hole_number
- Player/uploader: AVAILABLE, with nuance -- player_id is the
  subject; captured_by is who actually took it, if different
- Capture timestamp: AVAILABLE -- moments.created_at
- Caption: AVAILABLE (nullable) -- moments.caption
- Favourite: AVAILABLE -- is_event_favourite (085)
- Side Game link: DERIVABLE -- reverse lookup: side_comp_entries/
  side_comp_lead_changes WHERE moment_id = X -> side_comp_id ->
  side_comps.comp_type/name
- Exact Side Game name: DERIVABLE, and more authoritative than
  previously used -- side_comps.name, a real, organiser-set text
  field, confirmed to exist separately from comp_type. Correction to
  this engagement's own prior work: the memory-manifest route's
  SIDE_COMP_LABEL map is a hardcoded fallback keyed by comp_type, and
  is also incomplete (missing 'best_on_day' and 'custom', both valid
  per the real CHECK constraint) -- side_comps.name should be used
  directly instead, and is the only meaningful label at all for a
  'custom' comp_type.
- Round number (for "Round 1/2/3" naming): DERIVABLE, not stored --
  no round_number column exists on rounds at all -- only name
  (organiser-given) and play_date. Ordinal position must be derived by
  chronological sort, the same sortRoundsChronologically pattern
  final-results/route.ts already uses.
- "Came from Chat" vs. "general round Moment": NOT DISTINGUISHABLE --
  see item 2 -- these are the same UI path currently.
- Makers & Breakers relationship: MISSING -- no column or join path
  links a Moment to a specific Maker/Breaker.
- Published Highlight relationship: MISSING -- confirmed directly: no
  highlights source file references moment_id anywhere.
  published_round_highlights is text (statLine/caption), never
  photo-attached.
- Champion/final standings (for the summary): DERIVABLE, but not from
  this audit's scope -- requires the same complex countback logic
  final-results/route.ts has; already flagged as deferred in the V1
  manifest for this same reason.

## 4. WHICH METADATA IS CURRENTLY LOST

Two genuine provenance gaps, not three (the brief's "Chat" is not a
gap -- it's simply not a real, distinct category yet):

**A. Makers & Breakers / Highlights have zero link to any Moment.**
If an organiser captures a photo specifically because of a Maker or
Breaker achievement, that relationship is lost the moment the photo is
saved -- there's no column anywhere to express it, unlike the Side
Game case (which does preserve this, via the reverse-link pattern).

**B. "Came from Chat" as a distinct provenance fact does not exist**,
because the underlying product behaviour doesn't yet distinguish it --
this isn't data loss so much as a category the brief proposed that
doesn't correspond to a real, separate workflow today.

Side Game provenance, by contrast, is not lost -- it's fully
preserved, just via a reverse lookup rather than a forward column.

## 5. WHETHER SCHEMA CHANGES ARE NECESSARY

Not for Side Game provenance, Favourites, round/hole/player/caption,
or event metadata -- all fully available or cleanly derivable from the
existing schema, confirmed above.

A genuinely additive, optional schema change would be needed only if
Makers & Breakers photo-linkage (gap A) is wanted for V1.1. The
smallest viable addition, following the exact same pattern already
proven for Side Games (a reverse pointer on the owning record, not a
new column on moments itself): nothing currently exists on
published_round_highlights to attach a Moment to a specific highlight
entry, since highlights are a JSON blob
(published_round_highlights.highlights), not individual rows -- this
would need either restructuring highlights into rows (out of scope, a
real redesign) or a new, narrow join table (highlight_moment_links or
similar). Recommend NOT building this for V1.1 -- it's a real redesign
of how highlights are stored, not a small additive change, and the
brief's own "do not redesign Moments" principle extends naturally to
"do not redesign Highlights" for this package. V1.1's sourceType
vocabulary should simply not include MAKER/BREAKER/HIGHLIGHT as real
values yet -- see item 9's recommendation.

## 6. EXISTING MANIFEST ARCHITECTURE -- CAN IT BECOME THE CANONICAL EXPORT MODEL?

Yes, with targeted extension, not a rebuild. The existing
GET /api/trips/[tripId]/memory-manifest (built in the prior V1
delivery) already assembles event, rounds, memories, sideGameWinners
from the exact canonical sources this audit just re-confirmed. It
already reads Side Game winners from official_winner_entry_id (never
recomputing), highlights from published_round_highlights (never
regenerating), and already reserves a results.champion: null field
for the deferred reason re-confirmed in item 3's table.

What it does not yet provide, that export generation would need:
per-Moment Side Game linkage (currently the manifest returns
sideGameWinners as a separate array, not joined onto each memory's own
record) and the sourceType classification itself. Both are additive
extensions to the existing route/shape, not a new, competing manifest
-- directly satisfying "do not create a second competing source of
truth."

## 7. ZIP GENERATION OPTIONS IN THE CURRENT NEXT.JS/VERCEL/SUPABASE ARCHITECTURE

Re-confirmed from the prior session's investigation, not re-derived:
photos are resized client-side to a 1600px max dimension before
upload, so a typical stored JPEG is roughly 200-500KB. This sandbox
cannot inspect the actual deployed Vercel plan/configuration
(execution time and memory limits differ significantly between
Hobby, Pro, and Enterprise tiers, and this is not discoverable from
the codebase alone) -- this is a real, unresolved unknown, not
something to assume favourably.

Two realistic architectural options exist in this stack:
- Buffer-and-respond: download every selected image from Storage into
  function memory, build the ZIP with a streaming-capable library
  (one that writes directly to the response rather than building the
  whole archive in memory first), and stream the response as it's
  built. Lower infrastructure complexity, but memory and execution
  time both scale with the number/size of images in one request.
- Background job + polling: a separate process (a queued function, or
  a longer-running job outside the standard request/response cycle)
  builds the ZIP to temporary storage, and the client polls for
  completion before downloading. More robust for large exports, but
  meaningfully more infrastructure (a job queue or equivalent) than
  this app currently has anywhere else -- confirmed by searching for
  any existing background-job pattern in this codebase and finding
  none; everything today is a direct request/response API route.

## 8. REALISTIC LIMITS FOR 100+ ORIGINAL PHOTOS

At ~200-500KB/photo (the real, confirmed stored size), 100 photos is
roughly 20-50MB; the brief's own upper estimate of "100+" could
reasonably reach 150-250MB for a very large, multi-round event.
Streaming a response of that size from a standard serverless function
is within plausible limits on a Pro-tier Vercel plan but is a genuine
risk on Hobby, and downloading 100+ individual objects from Supabase
Storage sequentially (rather than in parallel batches) would add
meaningful latency on top of the transfer size itself. This cannot be
stated as safe or unsafe with confidence without knowing the actual
deployed tier -- stated as an open question requiring a real answer
before implementation, not glossed over.

## 9. RECOMMENDED IMPLEMENTATION ARCHITECTURE

1. Confirm the actual Vercel plan/tier before any ZIP implementation
   decision -- this single fact changes which of item 7's two options
   is appropriate, and this audit cannot determine it.
2. Extend the existing manifest, don't replace it. Add a sourceType
   field per memory ('SIDE_GAME' | 'GENERAL' only, per item 5's
   finding -- not the brief's wider illustrative list, since
   MAKER/BREAKER/HIGHLIGHT/CHAT are not real, distinguishable
   categories in the current product), and join Side Game
   name/hole/type directly onto each affected memory record (reusing
   side_comps.name, not the incomplete hardcoded label).
3. Build filename/folder derivation as a pure function first,
   independent of ZIP generation itself -- this is directly testable
   without any Storage/network access (a buildExportManifest(trip,
   rounds, memories, sideGameWinners) -> { folders, filenames } style
   function), matching this engagement's own established pattern of
   isolating pure logic for genuine unit testing before wiring it into
   an API route.
4. Only then build the actual ZIP streaming/generation route, using
   whichever of item 7's two architectures item 9.1's answer supports.
5. EVENT-SUMMARY.txt generation is also a pure function over the same
   extended manifest shape -- no AI, no new data source, fully
   testable in isolation before any ZIP work.
6. EVENT-MANIFEST.json is the extended manifest's own JSON response,
   or a close derivative of it -- not a third, separate shape.

## 10. EXACT FILES/MIGRATIONS EXPECTED TO CHANGE (for implementation, not done this session)

- No new migration required for Side Game linkage, Favourites,
  round/hole/player/caption, or event metadata -- all already
  available. A migration would only be needed if Makers &
  Breakers/Highlights photo-linkage (item 5's gap A) were pursued --
  not recommended for V1.1, per item 5's reasoning.
- src/app/api/trips/[tripId]/memory-manifest/route.ts -- extended (not
  replaced) to add sourceType and joined Side Game context per memory.
- A new pure function, likely src/lib/trips/exportManifest.ts (or
  alongside the existing runAgain.ts/sideCompRoundTrip.ts pattern) for
  folder/filename derivation -- directly unit-testable.
- A new pure function for EVENT-SUMMARY.txt generation.
- A new export route (e.g. src/app/api/trips/[tripId]/export/route.ts)
  for the actual ZIP generation -- architecture pending item 9.1's
  answer.
- src/components/scoring/EventMemoriesCard.tsx and the gallery page
  would need an "Export Memories" entry point, built after the above.

---

## SUMMARY -- WHAT THIS AUDIT CONCLUDES

The model is correct enough to proceed, with two specific corrections
to the brief's own assumptions, both found by reading the real code
rather than assuming the suggested vocabulary was already supported:

1. sourceType should be SIDE_GAME | GENERAL for V1.1, not the
   six-value list in the brief -- MAKER/BREAKER/HIGHLIGHT/CHAT are not
   real, distinguishable categories in the current product, and
   inventing them would mean fabricating context Teein' It Up doesn't
   actually have -- directly contradicting the brief's own "do not ask
   AI [or anything else] to rediscover/invent context" principle.
2. Side Game naming should use side_comps.name directly, not the
   existing manifest route's incomplete hardcoded label map -- a
   small, specific fix to carry into the implementation phase.

No schema change is required to proceed with Favourites, Side Game
linkage, round/hole/player/caption, or event metadata. A schema change
would only be needed for Makers & Breakers/Highlights photo-linkage,
which this audit recommends deferring rather than building now.

Before implementation can proceed responsibly, one external fact is
needed that this audit cannot determine from the codebase alone: the
actual Vercel plan/tier this app is deployed on, since it directly
decides which of the two ZIP architectures in item 7 is viable.
