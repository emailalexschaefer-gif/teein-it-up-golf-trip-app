# P0 PERMANENT DELETE SAFETY GATE
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access, no live database connection. Full test suite: **463/463
pass** -- 289 pure-function scoring + 64 highlights + 8 analytics + 7
profile + 32 SQL-scanning migration tests (21 existing + 11 new) + 63
trips.

**Nothing outside this feature's own files was touched.** Event
Management's deployed structure (Active/Completed/Archived, Manage
mode, bulk Archive/Restore, Run Again) was not redesigned.

---

## 1. CURRENT DELETE BEHAVIOUR DISCOVERED

Read the actual route directly rather than assuming. It checked
exactly two things: the caller is the trip's organiser_id, and
trip.status === 'archived'. Nothing checked whether the trip
actually contained any player participation or history. An archived
event with real joined players, real scores, Side Game results,
Moments, chat, or published highlights was fully, permanently
deletable -- exactly the gap the brief describes.

## 2. EXACT DEFINITION CHOSEN FOR "PROTECTED PLAYER/HISTORY DATA"

A trip is protected (blocks deletion) if any of the following is
true, checked directly against the schema, not assumed:

1. A trip_members row exists with role <> 'organiser' (someone
   genuinely joined).
2. A scorecards row exists for one of the trip's rounds (scoring has
   commenced).
3. A side_comp_entries row exists for one of the trip's side_comps.
4. A side_comp_lead_changes row exists for one of the trip's
   side_comps.
5. A moments row exists for the trip.
6. An event_messages row exists for the trip.
7. A published_round_highlights row exists for the trip.

Implemented as one SQL function, trip_has_protected_history(p_trip_id)
(migration 084), so both the DELETE route and the UI's eligibility
check read from the exact same source of truth.

## 3. WHY THOSE RECORDS ARE AUTHORITATIVE

Traced each table's real foreign keys before choosing this list, per
the explicit "investigate the actual relationships first" instruction:

- score_entries and marker entries are not checked separately.
  score_entries.scorecard_id is NOT NULL REFERENCES scorecards(id)
  ON DELETE CASCADE -- it is structurally impossible for a
  score_entries row to exist without a scorecards row already
  existing. Checking the parent is sufficient; checking the child too
  would be redundant, not safer.
- side_comp_entries and side_comp_lead_changes are checked
  independently of scorecards. Confirmed side_comp_entries.
  side_comp_id references side_comps, not scorecards -- a Side
  Game claim is not schema-guaranteed to imply a scorecard exists, so
  it needed its own explicit check rather than being assumed covered.
- moments is independent of everything else. Confirmed
  moments.round_id is nullable (ON DELETE SET NULL) -- a Moment
  can exist with no round at all (a general Event photo posted before
  any round starts), so it is a genuinely separate signal.
- event_messages is independent, referencing trips directly.
  Included per the brief's own conservative instruction -- a
  deliberate organiser announcement or chat message is treated as
  history worth protecting.
- published_round_highlights is checked as defence in depth even
  though publishing logically implies real scores already exist
  (signal 2) -- cheap, and strengthens the guarantee rather than
  relying purely on inference between two different tables.
- Badges and points have no separate table at all -- confirmed by
  searching the entire migration history -- they are derived live by
  get_my_golf_summary() from scorecards/side_comps/
  published_round_highlights, so signals 2-4 and 7 already cover them
  transitively. No separate check needed or added.

## 4. HOW ORGANISER-ONLY/CONFIGURATION-ONLY EVENTS REMAIN DELETABLE

The function never checks rounds, side_comps, trip_groups, or the
organiser's own trip_members row for existence at all -- a trip with
a fully configured name, dates, courses, rounds, tees, and Side Game
setup, but zero rows across all seven signals above, returns false
(not protected) and remains deletable. This was verified directly in
the function body: the query never references rounds or side_comps
as a blocking signal on their own, only as join scaffolding to reach
scorecards/side_comp_entries correctly scoped to this trip.

## 5. EXACT SERVER-SIDE ELIGIBILITY GATE

DELETE /api/trips/[tripId], in order:
1. Authenticated? (401 if not)
2. Caller is organiser_id? (403 if not)
3. trip.status === 'archived'? (409 if not)
4. trip_has_protected_history() returns false? (409 with
   { error: 'EVENT_HAS_PLAYER_HISTORY', message: '...' } if true)
5. Only then: the actual .delete().

Confirmed by reading the file's own statement order (and locked in by
a new test) that the history check happens strictly before the
destructive .delete() call -- a rejected request never reaches it.

## 6. UI BEHAVIOUR FOR DELETABLE VS. PROTECTED ARCHIVED EVENTS

New read-only route, GET /api/trips/[tripId]/deletion-eligibility,
calling the identical RPC. TripOverviewTab.tsx fetches this only
once a trip is actually archived, and:
- Eligible: shows "Delete Permanently" (unchanged styling/position).
- Not eligible: hides the button entirely and shows "🔒 This event
  contains player history and can't be permanently deleted. Archive
  keeps player scores, results and memories safe." -- the brief's own
  suggested copy.
- Still loading: shows neither, to avoid a flash of the locked
  message before the check resolves.

The confirmation dialog's copy was also corrected -- it previously said
deletion would remove "players, groups, rounds and scores," which is
now actively misleading (that dialog is only reachable once eligibility
is confirmed false-history). Updated to the brief's suggested "has no
player history and can be safely removed."

The server-side gate is authoritative regardless of this UI -- a
direct API call bypassing the eligibility fetch entirely is still
correctly rejected by the DELETE route's own independent check.

## 7. DATABASE CASCADE AUDIT

Re-confirmed (not re-derived from memory) that every table in the
brief's Part 1 list correctly cascades from trips/rounds via
ON DELETE CASCADE: trip_members, rounds, scorecards,
side_comps, moments, event_messages, published_round_highlights.
side_comp_entries/side_comp_lead_changes cascade from side_comps.
side_comps.official_winner_entry_id is ON DELETE SET NULL against
side_comp_entries -- irrelevant for a full deletion since both rows
are removed together in the same cascade. This audit's real output,
however, is that Permanent Delete is now gated so this cascade only
ever fires for a trip that was already confirmed to have none of these
rows populated in any meaningful way in the first place.

Not individually re-verified this session: trip_groups/group
membership cascades, and invitations/notifications specifically --
named as a gap rather than assumed safe by extension.

## 8. STORAGE CLEANUP AUDIT AND IMPLEMENTATION

Not implemented this session. The photo path convention
(tripId/roundId/userId/filename, confirmed in the prior phase) means
an eligible-for-deletion trip should, by definition, have zero
moments rows -- since a moments row existing is itself one of the
seven blocking signals above. This strongly suggests an eligible trip
has no photos to clean up in the first place, but this was reasoned
about, not verified against a live bucket listing, and no code was
written to actually list/delete under the trip's storage prefix.
Whether an Event logo or other non-Moment media could exist for an
eligible trip was not re-investigated this session.

## 9. MY GOLF/STAT IMPACT

Not re-verified end to end this session. As reasoned in item 3, an
eligible-for-deletion trip has, by construction, no rows in any of the
tables get_my_golf_summary() reads from for this trip (scorecards,
side_comps/entries, published_round_highlights) -- so its deletion
should have zero effect on any player's derived stats, since there was
nothing there to derive from. This is a reasoned consequence of item
2's gate, not something separately tested against a live summary
query.

## 10. PERMISSION/SECURITY CHECKS

Unchanged from Phase 1's own fix, now joined by the new history gate:
403 for a non-organiser caller, 409 for a non-archived trip, 409 for
protected history. The new deletion-eligibility route applies the
identical organiser check before revealing anything, and is read-only
throughout -- confirmed by a dedicated test that it contains no
insert/update/delete call anywhere in the file.

## 11. TESTS ADDED

11, in permanentDeleteSafetyGate.test.ts -- all source-scanning
contract tests against the real migration and route files, since no
live Postgres connection exists here to run genuine behavioural tests
against actual rows. Covering: each of the seven signals is genuinely
present in the function; configuration-only tables (rounds,
side_comps) are confirmed absent as blocking signals; the function
is provably read-only; the DELETE route's history check and
archived-only check both provably precede the destructive delete call;
the delete query is scoped to the single explicit tripId; the
eligibility route and the DELETE route call the identical RPC (so they
cannot silently drift apart); the eligibility route is read-only and
organiser-gated.

Not added as genuine behavioural tests, per the brief's own
preference where practical: the fourteen numbered scenarios in Part 9
(archived-empty-allowed, active-empty-rejected, each protected-history
type rejected, unauthorised-user-rejected, zero-rows-before-rejection,
other-events-untouched) would require a live database to seed rows and
assert real outcomes -- not achievable in this sandbox. The contract
tests above verify the logic that would produce those outcomes, but
this is a real, named gap, not a substitute claimed as equivalent.

## 12. FULL TEST-SUITE RESULT

**463/463 pass** -- 289 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 32 SQL-scanning migration tests (21 existing +
11 new) + 63 trips. Confirmed via a fresh, complete run this session.

## 13. FILES CHANGED

- `supabase/migrations/084_trip_protected_history_check.sql` (new)
- `src/app/api/trips/[tripId]/route.ts` (history gate added to DELETE)
- `src/app/api/trips/[tripId]/deletion-eligibility/route.ts` (new)
- `src/app/(app)/trips/[tripId]/tabs/TripOverviewTab.tsx` (eligibility-aware UI; removed a dead, inconsistent delete button that targeted 'completed'/'draft' trips and would always have been rejected by the server; corrected the confirmation dialog's copy)
- `src/lib/scoring/permanentDeleteSafetyGate.test.ts` (new -- 11 tests)

## 14. MIGRATIONS ADDED

One: 084_trip_protected_history_check.sql -- a single new function,
trip_has_protected_history(p_trip_id UUID) RETURNS BOOLEAN. No table
schema change, no data migration, nothing destructive. Confirmed
read-only by direct inspection and by a dedicated test.

## 15. ANYTHING STILL REQUIRING LIVE SUPABASE/DEVICE VALIDATION

Everything -- nothing here has touched a live database. Most
important specifically for this gate, roughly in the order I'd want
them checked:
1. Create a genuinely empty (organiser-only, no participation) test
   event, archive it, confirm "Delete Permanently" appears and
   succeeds.
2. Create an event, have a second account join it, archive it, confirm
   "Delete Permanently" is absent and the locked message appears, and
   that a direct API call against it returns 409
   EVENT_HAS_PLAYER_HISTORY.
3. Repeat step 2 for each of the other six signals individually
   (scoring only, a Side Game claim only, a Moment only, a chat
   message only, a published highlight only) to confirm each one
   independently blocks deletion -- this is the actual proof the
   signal list from item 2 is complete, which the contract tests
   cannot provide on their own.
4. Confirm a Live/Upcoming/Completed trip still cannot be deleted
   regardless of its history (the pre-existing archived-only check).
5. Confirm an unauthorised user's direct API call against someone
   else's archived, eligible trip is still rejected.
6. Items 8-9 above -- storage and My Golf impact were reasoned about,
   not verified live.
7. The Darren-shaped fixture regression -- confirm none of this
   feature's changes affect an Active/Upcoming trip's own data at all.
