# P0 -- COMPLETED EVENT -> ADD ROUND -> CONTINUE SOCIAL SERIES
## Audit + Fix Report

**Per the explicit instruction, this started as an audit -- tracing
the existing implementation end to end before changing anything.**
Two genuine gaps were found and fixed; everything else in the
12-point requirement list was already correctly implemented, and is
reported as such rather than rebuilt.

**Build/test caveat, unchanged from every prior round:** no network
access, no live database connection. Full test suite: **473/473
pass** -- 291 pure-function scoring (289 + 2 new) + 64 highlights + 8
analytics + 7 profile + 40 SQL-scanning migration tests (32 existing +
8 new) + 63 trips.

---

## WHAT ALREADY WORKED (confirmed by reading the real code, not assumed)

**Requirement 1 -- existing data untouched.** PATCH /api/trips/[tripId]
already reconciles rounds by matching incoming rows against existing
ones by id: a match is UPDATEd in place (same id, scorecards/scores
survive), and a round with no matching id is a genuinely new INSERT.
An existing round is only ever deleted if it's both absent from the
incoming array and still 'upcoming' -- an 'active' or 'completed'
round is never touched by this path, confirmed directly in the
route's own filter logic. This already existed; the comment in the
file documents it as a prior fix for a real destructive bug this same
route used to have.

**Requirement 2 -- genuinely new round, never reused.** Confirmed:
toInsert only contains rows with no matching existing id, and the
insert always produces a fresh row via .insert().select('id') --
there is no code path that reuses or resets an existing round's id.

**Requirement 6/7 -- cumulative leaderboard, generic across round
count.** Traced computeCumulativeStandings and
derivePreviousCurrentTotal directly: the first takes an array of
per-round results and reduces over whatever length is passed in (no
round-count constant anywhere), and the second is pure arithmetic
(previous = total - current) that holds for any N. Added two new
tests specifically walking a 3-round-completed series extended to a
4th round, and separately 1->2 and 2->3, confirming Previous/Current/
Total are correct at every stage. All pass.

**Requirement 8 -- closing the new final round returns to Completed.**
close/route.ts's own trip-completion check re-fetches all rounds for
the trip and checks .every(status === 'completed') fresh on every
close -- not a count fixed at any earlier point. Closing a newly
added 4th round re-evaluates correctly and returns the trip to
'completed' when nothing remains upcoming/live.

**Requirement 9 -- no duplication.** This route never writes to
trip_members or trip_groups at all -- confirmed by their total
absence from the file, now locked in by a test. Adding a round cannot
duplicate players or groups because nothing in this code path touches
those tables.

**Requirement 11 -- Run Again stays separate.** Structurally
guaranteed: Add Round is this PATCH route (edits the existing trip
id); Run Again is a completely separate GET .../run-again + the
wizard's own POST /api/trips (always a new trip id). Confirmed no
shared code path between them beyond both ultimately reading/writing
the same rounds table shape.

---

## GAPS FOUND (not assumed correct, verified broken)

### Gap A -- wrong revert status ('live' instead of 'ready')

The existing "completed -> reactivate" logic (already present before
this session, per its own dated comment) correctly detected a
completed trip gaining a non-completed round and reverted its status
-- but reverted it to 'live'. Traced TripList.tsx's own tab grouping
(groupLabel) and 'live''s only other writer
(rounds/[roundId]/start/route.ts, set exactly when a round actually
begins) before concluding this was wrong: 'live' specifically means
"a round is actively in progress," and groupLabel splits purely on
status === 'live' for "Live Now" vs everything else for "Upcoming."
Reverting to 'live' would have shown the continued series under
Live Now the instant a 4th round was added, even though nothing has
started yet -- directly contradicting requirement 5 ("the new round
must appear as Upcoming").

**Fixed:** the revert target is now 'ready' -- the same status a
trip with fully configured, not-yet-started rounds already carries,
which groupLabel already places under Upcoming within Active.

### Gap B -- editing an Archived trip was not blocked at all

Traced the "Edit trip" link (TripDetailClient.tsx) and found no
status gating whatsoever -- it is shown, and its target route usable,
for any trip status including 'archived'. The existing revert logic
only ever fires when the trip is currently 'completed', never
'archived', so an organiser could have added a round to an archived
trip and had it genuinely inserted while the trip silently stayed
archived -- exactly the "upcoming round hiding inside Archived" outcome
requirement 10 explicitly warns against, just for Archived instead of
Completed.

**Fixed:** the PATCH route now rejects any request against an
archived trip outright (409, before any round data is even read from
the body), requiring Restore first. This matches the brief's own
explicit preference ("I wouldn't have adding a round silently unarchive
something") -- blocking rather than auto-reactivating.

---

## REQUIREMENT-BY-REQUIREMENT STATUS

1. Existing data untouched -- already worked.
2. Genuinely new round -- already worked.
3. Trip no longer classified Completed -- worked, but reverted to the
   wrong status; fixed (Gap A).
4. My Events moves Completed -> Active automatically -- now correct
   as a consequence of Gap A's fix ('ready' falls under Active in
   TripList.tsx's own filter).
5. New round shows Upcoming, historical rounds stay Completed -- now
   correct as a consequence of Gap A's fix.
6. Previous/Current/Total cumulative correctness -- already worked,
   now with dedicated tests proving it at 1->2, 2->3, and 3->4.
7. Works extending 1->2, 2->3, and an established series -- already
   worked, now tested directly.
8. Closing the new final round returns to Completed -- already
   worked.
9. No duplication of players/groups/scores/Side Games/Moments/badges
   -- already worked for players/groups (this route never touches
   those tables); scores/Side Games/Moments/badges were never at risk
   since this route only ever reconciles rounds/side_comps rows for
   rounds explicitly present in the request, and an untouched existing
   round's own child data is never read or rewritten at all.
10. Archived stays archived; Restore first, then Add Round -- was not
    enforced at all; fixed (Gap B).
11. Run Again stays a separate function -- already worked.
12. Regression tests around the lifecycle transition and cumulative
    scoring -- added this session (10 new tests total, described
    below).

---

## FILES CHANGED

- `src/app/api/trips/[tripId]/route.ts` (Gap A: revert target 'live' -> 'ready'; Gap B: archived trips rejected outright, before any round data is read)
- `src/lib/scoring/multiRound.test.ts` (2 new tests -- 3->4 round extension, plus 1->2 and 2->3)
- `src/lib/scoring/completedEventAddRound.test.ts` (new -- 8 source-scanning contract tests against the real route)

## MIGRATIONS

None. Both fixes are application-layer logic changes to an existing
route; no schema change was needed.

## TESTS ADDED

10 total:
- 2 genuine, executable tests in multiRound.test.ts proving the
  cumulative leaderboard math is correct when extending an established
  series (3->4 rounds, and separately 1->2/2->3) -- these exercise the
  real, already-existing pure functions directly, not source-scanning.
- 8 source-scanning contract tests in completedEventAddRound.test.ts
  against the real route file (no live database exists here to
  exercise the actual reconciliation against real rows): the archived
  block precedes any round reconciliation; the revert target is
  'ready' and specifically not 'live'; the revert only fires for a
  currently-completed trip; the revert is derived from a fresh
  re-fetch of all rounds on every save, not a fixed count; an existing
  active/completed round is never in the delete set; a matched round
  is updated in place by id; a new round is inserted, never confused
  with an update; and the route never writes to
  trip_members/trip_groups. One genuine bug in my own first draft of
  one of these (a regex that stopped at the wrong bracket) was caught
  by running it and fixed before treating the suite as passing.

## FULL TEST-SUITE RESULT

**473/473 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 40 SQL-scanning migration tests + 63 trips.
Confirmed via a fresh, complete run this session.

## ANYTHING STILL REQUIRING LIVE SUPABASE/DEVICE VALIDATION

Everything -- nothing here has touched a live database. Most
important specifically for this lifecycle, in the order I'd want them
checked:
1. The brief's own exact scenario: a genuine 3-round-completed event,
   add a 4th round via "Edit trip," confirm the trip moves from
   Completed to Active/Upcoming in the actual My Events list (not just
   the status value in isolation), the 3 historical rounds remain
   completed and untouched, and the 4th shows as Upcoming.
2. Begin the 4th round and confirm the live leaderboard's Previous/
   Current/Total actually renders the three-round Previous figure
   correctly on screen, not just in the isolated function tests here.
3. Close the 4th round and confirm the trip returns to Completed.
4. Attempt to edit an Archived trip directly (via a saved "Edit trip"
   link or direct API call) and confirm the new 409 rejection actually
   fires, then confirm Restore -> edit -> Add Round works as the
   intended path.
5. Repeat this whole scenario for an event already at 2 rounds
   (extending to 3) as a second real-device data point, not only the
   1->2/2->3/3->4 covered by the isolated math tests.
