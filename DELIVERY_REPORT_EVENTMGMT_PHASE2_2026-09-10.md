# EVENT MANAGEMENT PHASE 2 -- RUN AGAIN + BULK MANAGEMENT
## Delivery Report

**Phase 1 was not touched.** No file from the Hole from Hell fix or
the DELETE route's archived-only guard was modified this session.

**Build/test caveat, unchanged from every prior round:** no network
access, no live database connection. Full test suite: **452/452
pass** -- 289 pure-function scoring + 64 highlights + 8 analytics + 7
profile + 21 SQL-scanning migration tests + 63 trips (54 existing + 9
new Run Again tests).

**Headline: Run Again and bulk Archive/Restore are delivered and
tested. Permanent Delete was audited, not implemented -- per the
brief's own explicit stop condition, since the remaining scope (atomic
delete execution, stat recalculation confirmation, rejection tests)
was more than could be finished responsibly this session.**

---

## 1. CREATE EVENT ARCHITECTURE DISCOVERED

POST /api/trips (src/app/api/trips/route.ts) is the single, canonical
creation route -- a Zod-validated body creating one trips row, one
trip_members organiser row, then N rounds rows and their side_comps
rows. The wizard itself (src/app/(app)/trips/new/page.tsx) already
supports a ?prefill=<url-encoded JSON> query param that pre-populates
its details/rounds state before the organiser ever reaches the review
step -- this existed already, for the Edit Trip flow, and is exactly
the mechanism Run Again needed. Reused verbatim, not rebuilt.

## 2. RUN AGAIN FIELD-BY-FIELD COPY MAP

**A. SAFE REUSABLE (copied):**
- Trip: event_type, location, description, expected_players,
  players_per_group, organiser_is_playing
- Round: name, course_name, tee_time, holes, scoring_format,
  starting_hole_number, tee_set_source_id (as library_tee_set_id),
  tee_name, course_rating, slope_rating, library_holes_snapshot
- Side comps: comp_type, hole_number only (via the existing,
  already-tested toWizardSideCompPrefill, the same enabled-only
  filter Edit Trip already applies)

**B. REQUIRES RESET (deliberately not copied, left for the
organiser):**
- Trip: name (becomes "{original} — Copy", a starting point, not
  the old value), start_date, end_date (both left '')
- Round: play_date (left ''), id (the wizard's own defaultRound()
  generates a fresh client id on every added round)

**C. HISTORICAL DATA -- NEVER COPIED:** not a filtering rule applied to
data that was fetched -- these tables are never queried by the Run
Again route at all: trip_members (beyond the auth check),
scorecards, score_entries, marker entries, side_comp_entries,
side_comp_lead_changes, official_winner_entry_id, moments,
messages, published_round_highlights, badges, points,
invite_code, round/trip status, any timestamp.

## 3. FIELDS EXPLICITLY RESET/NOT COPIED

Covered in full under item 2 (category B). is_practice is not read
or carried forward at all -- Run Again only ever applies to a normal
Completed Event in the My Events lifecycle; the resulting draft is
always a normal Event (POST /api/trips defaults is_practice to
false when absent).

## 4. RUN AGAIN IMPLEMENTATION

- src/lib/trips/runAgain.ts -- the pure mapping function
  (buildRunAgainPrefill), taking a source trip/rounds/side_comps and
  returning the wizard prefill shape. No side effects, no id
  generation, no database access -- this is the piece that can be
  (and now is) unit-tested directly.
- src/app/api/trips/[tripId]/run-again/route.ts -- GET, read-only
  (no .insert/.update/.delete anywhere in the file). Verifies
  the caller is the trip's own organiser (403 otherwise) and that the
  trip is 'completed' (409 otherwise), both server-side. Fetches
  exactly the columns the prefill needs, calls
  buildRunAgainPrefill, and returns { prefillUrl } -- a ready
  /trips/new?prefill=... URL.
- src/app/(app)/trips/[tripId]/tabs/TripOverviewTab.tsx -- added the
  "↻ Run Again" button, gated strictly to trip.status === 'completed'
  (narrower than Archive's own !isArchived scope), positioned above
  Archive per the brief's stated action order. On click, fetches the
  route above and navigates to the returned URL -- the actual trip
  creation only happens if and when the organiser reviews and submits
  the wizard themselves.

## 5. PROOF SOURCE EVENT REMAINS UNCHANGED

Structural, not just tested-by-example: the entire Run Again path
(runAgain.ts + the run-again route) contains no write operation
anywhere -- confirmed by inspection, and by the fact that
buildRunAgainPrefill's own type signature
(RunAgainSourceTrip/RunAgainSourceRound) has no id field at all,
so there is nothing in its contract that could carry a source id
forward even by accident. The actual new trip is created later,
through the wizard's existing, unchanged POST /api/trips call --
which always inserts a fresh row and returns a new id; nothing in
this feature touches that route.

## 6. BULK MANAGE UI IMPLEMENTATION

src/components/trips/TripList.tsx:
- A "Manage" toggle appears only when filter !== 'active' and the
  tab has at least one event -- never on Active, per the explicit
  instruction.
- Manage mode replaces each TripCard's normal <Link> navigation
  with a non-navigating, checkbox-toggling row (the card's own content
  renders with pointerEvents: 'none' inside a clickable wrapper) --
  no accidental navigation while selecting, and the whole row (not
  just a small checkbox) is a large touch target for mobile.
- "Select all" toggles every currently-filtered trip; the selected
  count is shown inline.
- A sticky bulk action bar appears at the bottom only once at least
  one trip is selected -- "Archive Selected" on the Completed tab,
  "Restore Selected" on Archived. Easy to reach with a thumb, per the
  mobile UX requirement.
- "Done" exits Manage mode and clears selection; switching tabs also
  resets both, so a Completed-tab selection can never accidentally
  carry into Archived.
- Permanent Delete is intentionally not offered anywhere in this UI
  yet -- see items 14 and 22.

## 7. BULK ARCHIVE SERVER VALIDATION

POST /api/trips/bulk-status with { tripIds, action: 'archive' }.
The UPDATE is scoped to .in('id', tripIds).eq('organiser_id',
user.id).eq('status', 'completed') in one query -- a trip that is
Live, Upcoming, owned by someone else, or already Archived is simply
never touched, regardless of whether its id was included in the
request. There is no code path in this route that constructs a query
without the explicit id list.

## 8. BULK RESTORE SERVER VALIDATION

Same route, action: 'restore' -- .eq('status', 'archived') instead.
Identical safety properties. Restore transitions a trip back to
'completed' only -- it is a plain status UPDATE, touching no
round, score, or result data at all, so "the restored Event is the
same Event with the same ID and same history" holds by construction,
not by a separate check.

## 9. EXPLICIT-ID MUTATION DESIGN

Both bulk operations dedupe the incoming id list defensively, then run
exactly one UPDATE ... WHERE id IN (...) AND organiser_id = ... AND
status = ... per request. The response is built by diffing the
UPDATE's own .select('id') result (the rows that were actually
changed) against the requested ids -- this is the mechanism behind the
accurate partial-failure reporting in item 15, not a separate
before/after check that could drift from what really happened.

## 10. STORAGE ARCHITECTURE DISCOVERED

Traced the actual client-side upload call
(src/components/moments/MomentCapture.tsx) rather than guessing.
Bucket: event-moments. Path convention, confirmed directly from the
upload code: `${tripId}/${roundId ?? 'general'}/${user.id}/${Date.now()}.${extension}`
-- every uploaded photo's path begins with the exact trip id as its
top-level folder.

## 11. EXACT EVENT-MOMENTS PATH/OWNERSHIP MODEL

Because tripId is the path's own top-level segment, "these exact
storage objects belong exclusively to Event X" is answerable with high
confidence via storage.from('event-moments').list(tripId) -- a
prefix listing, not a loose string match. The Date.now()-based
filename combined with the per-trip/round/user folder structure makes
it extremely unlikely (structurally, not just empirically) for one
object to ever be shared across two different trips' folders. This is
genuinely good news relative to what Phase 1 could confirm -- it means
a safe, prefix-scoped storage cleanup is very likely achievable in a
follow-up, not an open architectural risk.

**Not yet done:** the actual bulk-delete-by-prefix implementation,
and confirming there is no other media path outside event-moments
(e.g. event logos) that would also need the same treatment -- this
second check specifically was not completed this session.

## 12. DATABASE FK/CASCADE AUDIT

Checked every table Part 7 of the brief listed, by reading the actual
REFERENCES clauses rather than assuming:
trip_members, rounds, scorecards, side_comps, moments,
messages, published_round_highlights all declare
trip_id/round_id as NOT NULL REFERENCES ... ON DELETE CASCADE.
This is consistent -- deleting a trips row correctly cascades through
every one of these. side_comp_entries/side_comp_lead_changes
cascade from side_comps (confirmed in earlier sessions' migration
work), and side_comps.official_winner_entry_id is ON DELETE SET
NULL against side_comp_entries -- irrelevant in practice for a full
trip deletion, since both rows are removed together in the same
cascade.

**Not yet done:** groups/group_memberships, badges/points tables
specifically, and notifications/invitations were not individually
re-verified this session (some were checked in earlier phases of this
engagement, not re-confirmed here under time pressure) -- listed
honestly as a gap rather than assumed safe by extension.

## 13. MY GOLF/STAT DELETION AUDIT

**Not completed this session.** get_my_golf_summary()'s own CTEs
(from earlier phases of this engagement) are known to be derived live
from scorecards/side_comps at read time, not persisted counters --
which suggests deleting a trip would naturally and correctly reduce a
player's stats without any special handling. But this was not
re-verified end-to-end against Permanent Delete specifically this
session, and is exactly the kind of assumption the brief's own
methodology warns against treating as confirmed without checking.

## 14. PERMANENT DELETE IMPLEMENTATION OR REASON DEFERRED

**Deferred, per the brief's own explicit stop condition.** Items 11-13
found the storage and DB pictures are more favourable than Phase 1
could confirm, but the remaining work -- designing safe execution order
between the Postgres delete and the Storage cleanup (the brief's own
Part 6 concern about non-atomic behaviour), the explicit
partial-failure UI, confirming item 13's stats question live, the
confirmation dialog, and Part 10's rejection tests -- is genuine,
separate scope. Building it under remaining time pressure risked
exactly the kind of shallow, unverified work this whole engagement has
tried to avoid on a genuinely destructive operation. Run Again and
bulk Archive/Restore are shipped and tested; Permanent Delete remains
blocked pending that work, exactly as the brief said to prefer.

## 15. PARTIAL-FAILURE HANDLING

Implemented for bulk Archive/Restore (item 9's mechanism). The UI
(TripList.tsx) shows the real succeeded count and, when any ids
failed, keeps those ids selected and displays how many could not be
updated -- never claims the full requested count succeeded when it
didn't. Not yet built for Permanent Delete, since Permanent Delete
itself was not built.

## 16. PERMISSION/SECURITY CHECKS

- Run Again: 403 if the caller is not the trip's organiser_id, 409
  if the trip is not 'completed' -- both server-side.
- Bulk Archive/Restore: the UPDATE's own WHERE organiser_id =
  user.id clause means a trip owned by someone else can never be
  mutated through this endpoint, regardless of what id list is
  supplied -- not a separate check that could be bypassed, but the
  actual condition the write itself is scoped by.

## 17. ACTIVE/FUTURE EVENT PROTECTION TESTS

**Not added this session as automated tests specifically for Part 10's
list** (DELETE Active/Live/Upcoming/Completed rejected, unauthorised
Archived delete rejected, bulk request containing an ineligible Active
event doesn't mutate it). The server-side logic for the bulk
operations' own eligibility (item 7-9) provides this protection by
construction (a Live/Upcoming/Completed trip is never matched by the
bulk-status route's own WHERE clause), but dedicated regression
tests proving it -- ideally against a Darren-shaped fixture as Part 11
describes -- were not written this session. Named directly as a gap,
not silently skipped.

## 18. FILES CHANGED

- `src/app/api/trips/[tripId]/run-again/route.ts` (pre-existing this session, verified correct, not modified)
- `src/lib/trips/runAgain.ts` (pre-existing this session, verified correct, not modified)
- `src/lib/trips/runAgain.test.ts` (new -- 9 tests)
- `src/app/(app)/trips/[tripId]/tabs/TripOverviewTab.tsx` (Run Again button added)
- `src/app/api/trips/bulk-status/route.ts` (new)
- `src/components/trips/TripList.tsx` (Manage mode UI added)

## 19. MIGRATIONS ADDED

None. Bulk Archive/Restore are plain status transitions on the
existing trips.status column and its existing CHECK constraint
(confirmed already permits 'completed'/'archived' in Phase 1's own
audit) -- no schema change was needed.

## 20. TESTS ADDED

9, in runAgain.test.ts -- covering dates always reset, the name
becoming a starting point not a verbatim copy, safe fields copying
correctly, side_comps carrying only configuration (never
claim/verification state) and mapping independently per round, a
disabled side_comp being excluded, null/missing source fields falling
back to sensible defaults without crashing, a zero-round completed
event still producing a valid prefill, and a structural key-list check
proving the output shape has no field capable of carrying a score,
result, Moment, badge, or historical timestamp. One genuine bug in the
first draft of the last test (a key I'd simply forgotten to list) was
caught by actually running it and fixed before treating the suite as
passing.

## 21. FULL TEST-SUITE RESULT

**452/452 pass** -- 289 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 21 SQL-scanning migration tests + 63 trips (54
existing + 9 new). Confirmed via a fresh, complete run this session,
including catching and correctly diagnosing a path-setup artifact
(not a real failure) before concluding the suite was clean.

## 22. ANYTHING REQUIRING LIVE SUPABASE/DEVICE VALIDATION

Everything -- nothing here has touched a live database. Most
important specifically for this phase:
1. Run Again end to end: tap the button, confirm the wizard opens
   pre-filled with the right configuration and empty dates, submit it,
   and confirm the source Completed event is completely unchanged
   (same id, same status, same rounds) while a genuinely new event
   with a new id now exists.
2. Bulk Archive from Completed, bulk Restore from Archived, with
   multiple events selected including a deliberate mix that should
   partially fail (e.g. one id belonging to another organiser) to
   confirm the partial-failure reporting is accurate on a real
   response, not just the mocked shape assumed here.
3. Tab counts updating correctly after a bulk operation without
   requiring an app restart.
4. The Darren-shaped fixture regression from Part 11 -- genuinely not
   run this session, and the most important single check before this
   ships near a real trip.
5. Everything under items 13-14, 17 -- explicitly incomplete, listed
   above.
