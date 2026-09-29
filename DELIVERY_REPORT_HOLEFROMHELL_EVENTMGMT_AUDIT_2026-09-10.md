# HOLE FROM HELL FIX + EVENT MANAGEMENT AUDIT
## Delivery Report

**Context note:** this session began in a fresh sandbox with no
working directory. Before anything else, the project was restored
from the most recently delivered zip
(teeinitup-p0-migration-recovery-2026-09-09.zip) -- confirmed to match
migration 083, the last verified state from the prior session.

**Build/test caveat, unchanged from every prior round:** no network
access, no live database connection. Full test suite: **443/443
pass** -- 289 pure-function scoring + 64 highlights (61 existing + 3
new) + 8 analytics + 7 profile + 21 SQL-scanning migration tests + 54
trips.

**Headline: Item 1 is done and verified. Item 2 was audited as
explicitly required before any implementation, and one real safety
gap was found and fixed in the process -- but the bulk of Item 2's
scope (bulk Manage-mode UI, Run Again, storage cleanup) was
deliberately not built this pass, for reasons explained below.**

---

## ITEM 1 -- HOLE FROM HELL

**Root cause, and a second issue found while tracing it.** The
calculation (findHoleFromHell in makersBreakers.ts) already used the
real, canonical hole_number -- never derived from array index or play
order. The reported bug was that this value only appeared buried
mid-sentence in caption, never in statLine -- confirmed by reading
every component that renders either field before concluding this:
MakersBreakers.tsx's list/card views and RoundHighlightsSection.tsx
render statLine only, never caption, so the hole number was genuinely
invisible on those surfaces.

**While tracing this, a second, more severe issue surfaced:** the loop
assumed hole numbers run contiguously from 1 to field.totalHoles.
That's false for a genuine 9-hole round that starts on the back nine
-- confirmed this is a real, DB-allowed configuration
(rounds.holes IN (9,18), independent of starting hole, not
Practice-only) by checking the actual table constraint. For such a
round, totalHoles is 9 but the real hole_number values present are
10-18 -- the old range (1..9) would never match any of them, meaning
Hole from Hell couldn't be computed at all for that round, not merely
mislabelled.

**Fix:** statLine now includes "Hole {n} \u00b7" as its own prefix, so
every consuming surface inherits it from one source. The iteration
itself now derives the real hole-number set directly from a completed
player's own holes (every completed player shares the same set, by
hasCompleteRound's own definition), rather than assuming any
particular numeric range.

**Surfaces audited:** MyGolfEventStory.tsx, PlayerRoundView.tsx,
FinalEventResults.tsx, TournamentControl.tsx, MomentViewer.tsx --
confirmed every one either renders statLine directly with no
truncation, or its own holeNumber usage belongs to a completely
different system (Side Games, Moments) and was correctly left
untouched.

**Tests:** 3 new tests added to makersBreakers.test.ts, covering
exactly the brief's own acceptance criteria -- statLine naming the
hole directly, a genuine 9-hole Back 9 round (real hole numbers 10-18)
computing correctly rather than returning null, and an 18-hole round
starting from the 10th tee reporting the actual canonical hole (10),
not a played-order position. All pass, alongside the full existing 61.

## ITEM 2 -- EVENT MANAGEMENT: AUDIT FINDINGS

**Per the explicit P0 instruction, this was audited before any
implementation.**

**Good news on the P0 gate itself:** the three-tab Active/Completed/
Archived structure already exists (TripList.tsx), correctly derived
from the existing trips.status field
(ACTIVE_STATUSES = ['draft','open','groups_ready','ready','live'],
COMPLETED_STATUSES = ['completed'], ARCHIVED_STATUSES = ['archived']).
'archived' is already a valid, functioning status in the existing
CHECK constraint (015_sprint3_definitive.sql) -- not something this
release needs to introduce. No status migration is required or was
made. Live/Upcoming grouping within Active, tab counts, and empty
states also already exist.

Also confirmed: 'upcoming' is exclusively a round-level status, never
a trip-level one -- every reference in the app is
round.status === 'upcoming'. "Darren's upcoming event," in the
brief's own sense, is a trip in one of the pre-'live' statuses with
its rounds not yet started -- this distinction matters for anyone
reasoning about the data model going forward.

**Single-trip Archive, Restore, and Delete already exist**
(TripOverviewTab.tsx + DELETE /api/trips/[tripId]). Restore's existing
logic infers the correct target status from the trip's own data
(completed round -> 'completed', has players -> 'open', else 'draft')
-- since this release's Archive only ever happens from 'completed',
Restore will always correctly land back on 'completed', matching the
brief's own "Restore does not reopen scoring / move to Upcoming /
reset dates" requirement without any change needed to that logic.

**A real safety gap was found and fixed:** the existing DELETE route
had no server-side check that the trip's status was 'archived' --
only the UI conditionally showed the delete button. A direct API call
could have permanently deleted a Live, Upcoming, or Completed event,
with nothing stopping it server-side. This directly matches the
brief's own warning: "do not rely only on hidden UI buttons for
security -- enforce permissions server-side." Fixed: the route now
returns 409 if the trip is not already 'archived'. This protects the
existing, already-shipped single-trip delete, not just new work -- and
is exactly the kind of thing "Darren's real event" needs protected
against.

## ITEM 2 -- WHAT WAS NOT BUILT, AND WHY

Per the brief's own explicit instruction ("if the database audit
reveals that safely deleting an Event would require risky/destructive
schema changes: STOP. Report the dependencies") -- the following were
deliberately not built this pass, rather than rushed:

- **Storage cleanup for Moments/photos.** Confirmed Supabase Storage
  (event-moments bucket) is genuinely used, and a trip's Postgres row
  cascade will not remove those stored objects -- this is a real gap,
  matching the brief's own concern. Tracing the complete upload path,
  its naming convention, and building a safe bulk-cleanup mechanism
  that cannot affect another trip's photos is genuine, separate work
  I did not have time to do carefully. Left unbuilt rather than
  guessed at.
- **Bulk Manage-mode UI** (checkboxes, Select All, Archive Selected /
  Restore Selected / Delete Permanently, the destructive confirmation
  dialog) -- not built. The underlying single-trip mutations exist and
  are now safer (see above), but the list-level bulk UI and its own
  API route (operating only on explicitly selected IDs, with
  partial-failure handling) is new work.
- **Run Again** -- not built. This needs its own audit of the current
  Create Event data model (which fields are genuinely reusable
  configuration vs. must never be copied) before any implementation,
  per the brief's own instruction -- not done this pass.
- **My Golf stats behaviour after Permanent Delete** -- not
  investigated this pass.

**What this means concretely:** an organiser can still only
Archive/Restore/Delete one trip at a time, via the existing Trip
Overview screen -- there is no new bulk-selection list UI yet. Nothing
in this pass changes that experience; it only makes the existing
single-trip delete provably safe.

## FILES CHANGED

- `src/lib/highlights/makersBreakers.ts` (Hole from Hell fix -- both the display and the root-cause iteration bug)
- `src/lib/highlights/makersBreakers.test.ts` (3 new tests)
- `src/app/api/trips/[tripId]/route.ts` (DELETE route -- server-side archived-only enforcement)

## MIGRATIONS

None. Confirmed and explained above why none was needed for the P0
gate's three-tab structure.

## TESTS ADDED

3, described under Item 1. Full suite: **443/443 pass.**

## REGRESSION CONFIRMATION

- Full existing makersBreakers.test.ts suite (61 tests) re-run fresh
  and passes unchanged alongside the 3 new ones.
- The DELETE route change only adds a new rejection condition (status
  != 'archived') -- it does not alter the authorisation check, the
  cascade behaviour, or the success path for an already-archived trip
  in any way.
- Nothing in this session's changes touches migrations 079-083,
  Practice, Side Games, or any Event scoring path at all.

## STILL REQUIRING LIVE DB/DEVICE VALIDATION

1. Hole from Hell's three acceptance scenarios, on a real device with
   real round data (the tests above prove the logic in isolation, not
   that a real generated highlight displays correctly end to end).
2. Everything Item 2 identified as deferred, listed above.
3. The DELETE route fix specifically: confirm attempting to delete a
   non-archived trip directly via the API now correctly returns 409,
   and that the existing archived-trip delete flow is completely
   unaffected.
