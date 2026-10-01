# EVENT MEMORIES V1.1 -- PHASE 2 IMPLEMENTATION
## Delivery Report

**Build/test caveat, unchanged from every prior round, with one
addition this time:** no network access, no live database/Storage
connection, and -- new this session -- no way to npm install a
package, meaning the new archiver dependency could not actually be
installed or executed here. Everything about its usage is written
against its well-established, stable public API from directly
reasoning about it, not verified by running it. This must be the
first thing checked on a real machine before trusting this delivery.

Full test suite: 522/522 pass -- 291 pure-function scoring + 64
highlights + 8 analytics + 7 profile + 61 SQL-scanning migration tests
(52 existing + 9 new, after fixing 4 that needed updating for a
refactor -- see item 10) + 91 trips (63 existing + 28 already present
from this engagement's own earlier work this session, confirmed
correct by running them).

The Vercel tier was still the literal placeholder when this brief
arrived. Per item 9's own explicit instruction, I did not guess at it
to make an implementation decision. I built the export route using
streaming (the safer default regardless of tier), and the route's own
file-level comment states plainly that this has not been load-tested
against a realistically large event or a confirmed tier -- see item 7.

---

## 1. FINAL EXPORT ARCHITECTURE

POST /api/trips/[tripId]/export streams a ZIP directly in the HTTP
response using archiver, piped through a TransformStream so bytes
reach the client as each photo downloads, rather than buffering the
whole archive in memory first. The route: authenticates, verifies
organiser ownership, fetches canonical event data via the shared
fetchEventMemoryData() function (see item 2), builds the deterministic
export entry list via the already-existing, already-tested
buildExportManifest(), generates EVENT-SUMMARY.txt via the already-
existing buildEventSummaryText(), serialises EVENT-MANIFEST.json from
the same data, then downloads and appends each photo in turn.

## 2. MANIFEST CHANGES

Found that the manifest extension (per-memory sourceType, round
ordinal, side_comps.name as the authoritative label, captured_by) was
already built before this session started, matching my own Phase 1
audit's recommendations precisely -- confirmed by reading it directly
rather than assuming from file presence alone. The new work this
session: extracted its actual data-fetching logic out of
memory-manifest/route.ts into src/lib/trips/eventMemoryData.ts
(fetchEventMemoryData()), so the new export route reads the exact
same canonical data without a second, duplicate query path -- directly
satisfying "do not create a second competing source of truth."
memory-manifest/route.ts's own response shape is unchanged; it now
simply calls the shared function and returns its result, plus the
signed URLs the gallery grid specifically needs (the export route
skips that call entirely, since it downloads bytes directly).

## 3. FOLDER-GENERATION RULES

Already built and tested (28 tests, all passing) in
src/lib/trips/exportManifest.ts. Event-level Memories (no round) go
under 00 - EVENT/GENERAL. Round folders are NN - ROUND N using the
derived chronological ordinal (never a stored field, since none
exists -- confirmed in Phase 1). Side Game Memories get their own
SIDE GAMES/{REAL GAME NAME} subfolder, using side_comps.name directly.
No empty folders are ever created -- folders only exist because an
actual entry was placed in them.

## 4. FILENAME RULES

Also already built and tested. Deterministic, sanitised (accented
characters normalised rather than dropped, unsafe characters
stripped), length-capped at 180 characters, collision-safe via a
per-folder+base-name sequence counter. Every fragment (hole, player,
Side Game name) is included only if genuinely known -- confirmed by a
dedicated existing test that a missing hole/player/caption is omitted
entirely, never replaced with a placeholder.

## 5. FAVOURITE HANDLING

Already built and tested. A Favourite produces two real ZIP entries --
its normal contextual location and an identical-filename copy under
90 - FAVOURITE HIGHLIGHTS/ -- confirmed this is genuine duplication
inside the archive, not a symlink or reference, matching the explicit
portability requirement.

## 6. SUMMARY FORMAT

Already built and tested (eventSummaryText.ts). No AI, no invented
prose -- confirmed the function's own type signature gives it no
access to anything beyond its typed inputs, so it cannot fabricate
even if extended carelessly later. "Champion: not available in this
export" is stated plainly rather than guessed. Filenames referenced in
the summary come from the exact same ExportResult the ZIP itself
used -- never a second, independently derived naming pass.

New this session: wired into the export route so the summary/manifest
are scoped to exactly what's in a given export (an "Export Round 2"
package describes Round 2 only, not the whole event's history) -- this
scoping did not exist until this session, since the pure function
alone doesn't know about export scope; the route is what applies it.

## 7. ZIP IMPLEMENTATION AND WHY IT IS SAFE FOR OUR VERCEL TIER

Cannot confirm this is safe for your actual tier, because the tier was
never supplied -- stated as plainly as possible, not glossed over.
What was done: streaming via archiver + TransformStream, which bounds
memory use to roughly one image at a time rather than the whole
archive -- the safer of the two architectures identified in the Phase
1 audit, and a reasonable default regardless of which tier this turns
out to be. What this does not solve: execution-time risk. A 100+
photo export still means 100+ sequential Storage downloads inside one
request; a short timeout (Hobby-tier Vercel, for one concrete example)
could still cut this off partway through regardless of how little
memory it used. This is stated directly in the route's own file-level
comment, not just this report, so it's visible to whoever next works
on this file. This has not been load-tested against a real 100+ photo
event -- confirm the actual tier and test against a realistically
large event before relying on this for Darren's trip specifically.

## 8. EXPORT UX

Added to the gallery page (memories/page.tsx): an "Export Memories"
button opening a menu with "All Event Memories," "Favourites Only,"
and "This Round" (shown only when a round filter is active) -- each
triggers the export route and downloads the resulting ZIP via a
generated object URL. "Export Selected" is wired into the existing
Manage-mode bulk action bar (built in V1), reusing the same selection
state rather than a second selection mechanism. Added the brief's own
suggested Favourite explanation text: "Favourite Memories are
prioritised in your Event Highlights export and future post-event
content." Individual download (built in V1) is unchanged and still
present.

## 9. SECURITY MODEL

Export is organiser-only -- confirmed by a dedicated test that the
organiser check precedes fetching any event data at all. Export scope
is validated against a strict Zod schema (a client cannot submit an
arbitrary, unrecognised scope kind). A client-supplied roundId or
momentIds list is never used to query another trip's data directly --
it only filters this trip's own already-fetched, already-scoped
memories (confirmed by a dedicated test that no second, ID-keyed query
exists in the route at all). Storage objects are only ever read
(.download()); confirmed no write/update/remove call exists anywhere
in the route. No signed URLs or Storage credentials are ever exposed
to the client -- the ZIP contains real downloaded bytes, not links.

## 10. TESTS ADDED

9 new, in eventMemoriesExportV1_1.test.ts -- source-scanning contract
tests against the real export route (no live Storage/ZIP execution
possible here): organiser-only check precedes data fetching; scope
validated by a strict schema; no second ID-keyed query exists; Storage
objects are read-only; a failed individual photo download is skipped
rather than aborting the whole export; the route reads from the
shared fetchEventMemoryData rather than a duplicate query path; signed
URLs are skipped since bytes are fetched directly; the response
streams via a ReadableStream with archive.finalize() running
independently inside an async task, not blocking the response; and the
summary/manifest are scoped to exactly what's in the export.

Also found and fixed 4 existing tests (from the prior V1 session) that
broke as a direct, expected consequence of extracting
fetchEventMemoryData out of memory-manifest/route.ts -- they checked
for specific query patterns that are now in a different file. The
underlying behaviour these tests verify is completely unchanged
(confirmed, since eventMemoryData.ts's logic is the same logic,
relocated, not reimplemented); only the file they need to read from
changed. Fixed by pointing them at the new file, re-ran, confirmed all
12 in that suite pass for the right reason.

Found one bad test in my own first draft and fixed it before treating
anything as verified: an early version of one of the new streaming-
order tests contained a tautological assertion
(... === false || true) that would have passed regardless of what the
code actually did. Caught this before finalising the file and
replaced it with a genuine structural check.

28 existing tests for exportManifest.ts/eventSummaryText.ts (already
present before this session, built from this engagement's own earlier
Phase 1 audit) were re-run and confirmed passing, not just assumed
correct from their presence.

Not added, and why: genuine behavioural tests exercising a real ZIP
against real Storage (collision handling with real duplicate filenames
arriving from actual uploads, the actual byte-for-byte content of
exported files, a real 100+ photo load test) are not possible in this
sandbox -- no network, no installed archiver package, no live Supabase
connection. This is a real, named gap, not a substitute claimed as
equivalent to real-device testing.

## 11. FULL TEST RESULT

522/522 pass -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 61 SQL-scanning migration tests + 91 trips.
Confirmed via a fresh, complete run this session, including finding
and fixing both the 4 tests broken by the refactor and one bad
assertion in my own new test, before accepting the total as genuine.

## 12. FILES CHANGED

- `package.json` (added archiver/@types/archiver -- not installed; npm install must be run before this can actually run)
- `src/lib/trips/eventMemoryData.ts` (new -- extracted shared data-fetching)
- `src/app/api/trips/[tripId]/memory-manifest/route.ts` (refactored to use the shared function; response shape unchanged)
- `src/app/api/trips/[tripId]/export/route.ts` (new -- the ZIP export route)
- `src/app/(app)/trips/[tripId]/memories/page.tsx` (export UX added)
- `src/lib/scoring/eventMemoriesV1.test.ts` (4 tests fixed to point at the relocated logic)
- `src/lib/scoring/eventMemoriesExportV1_1.test.ts` (new -- 9 tests)

Pre-existing this session, found and verified correct, not modified:
src/lib/trips/exportManifest.ts, src/lib/trips/exportManifest.test.ts,
src/lib/trips/eventSummaryText.ts.

## 13. MIGRATIONS ADDED

None. Confirmed in Phase 1 and unchanged: Side Game provenance,
Favourites, round/hole/player/caption, and event metadata are all
already available without schema change.

## 14. ANYTHING REQUIRING LIVE SUPABASE/DEVICE VALIDATION

Everything -- nothing here has touched a live database, Storage
bucket, or actually executed archiver. In priority order:
1. Run npm install and confirm archiver actually installs and the
   route compiles/runs at all -- this is untested at the most basic
   level.
2. Confirm the actual Vercel plan/tier, then test the export route
   against a real event with 100+ photos specifically -- this is the
   single most important validation step, and the one this session
   could least verify.
3. The full brief Phase 2 workflow: Export All, Export Favourites,
   Export Round, Export Selected, each producing a real ZIP, opened on
   a real device, confirming folder structure, filenames, Favourite
   duplication, and that EVENT-SUMMARY.txt/EVENT-MANIFEST.json both
   read correctly.
4. Confirm a custom Side Game's real name renders correctly in both
   the folder structure and the summary, on live data.
5. Confirm an unauthorised (non-organiser) export attempt is genuinely
   rejected by a real request, not just by the source-scanning tests
   here.
6. The real-world test you described: uploading the resulting package
   to an external AI tool and confirming it can produce something
   useful from the structured summary/manifest plus Favourite
   Highlights -- genuinely outside what this session could attempt at
   all.
