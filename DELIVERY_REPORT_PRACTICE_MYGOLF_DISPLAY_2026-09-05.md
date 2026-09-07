# PRACTICE ROUND — MY GOLF DISPLAY FOLLOW-UP
## Delivery Report — 5 Sep 2026

**Scope, as instructed:** a small display completion pass only.
Scoring, leaderboard, achievement, Side Game, Event Winner, and
Practice creation logic were not reopened -- confirmed by the file
list below, which touches nothing from those systems.

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run. All 3 touched/new files
syntax-check with zero errors. Full test suite: **409/409 pass** --
identical to the prior round's result, confirming this display-only
pass changed no calculation anywhere.

---

## 1. EXISTING MY GOLF COMPONENT/DATA SOURCE REUSED

- `CollapsibleSection` -- the same shared accordion component used
  throughout My Golf and My HQ, not a new pattern.
- `score_entries.stableford_pts` -- the same already-computed, DB-
  trigger-populated value every other Stableford total in this app
  reads. This pass sums an existing stored number; it does not
  recalculate anything.
- The same `trip_members` -> `trips` join pattern `/api/me/event-stories`
  already established for finding a player's own trips, applied here
  with the opposite `is_practice` filter.

## 2. EXACT FILES CHANGED

- `src/app/api/me/practice-rounds/route.ts` (new)
- `src/components/scoring/MyPracticeRoundsSection.tsx` (new)
- `src/components/scoring/MyRoundClient.tsx` (two-line addition: import + mount)

Nothing else. No scoring, leaderboard, achievement, Side Game, Event
Winner, or Practice-creation file was touched.

## 3. HOW PRACTICE IS IDENTIFIED

The same `trips.is_practice` column introduced in the prior pass --
`/api/me/practice-rounds` filters the player's own trip memberships to
`is_practice === true`, the exact inverse of the filter
`/api/me/event-stories` already applies. No new classification, no
inference from group size or player count.

## 4. WHERE PRACTICE APPEARS IN MY GOLF

**Investigated first, as instructed.** My Event Stories' own existing
query is explicitly Event-only (`is_practice === false`, from the
prior pass) -- forcing Practice through it would mean diluting that
filter or adding a second code path inside an already-shipped, tested
route. Per the brief's own explicit permission to add "a very small
Practice/history subsection if absolutely necessary," added
`MyPracticeRoundsSection`, positioned directly beside My Event Stories
-- the closest existing personal-history location, not a new position
in the overall My Golf hierarchy. Self-hiding: renders nothing at all
for a player with no practice rounds, so it never appears as empty
clutter.

**Display, matching the brief's own example exactly:**
- A muted, deliberately non-trophy "PRACTICE" label -- small grey
  badge, not gold/yellow (which this app already uses specifically for
  achievement/highlight content elsewhere).
- Course name (or "Practice Round" if none was entered), tee name
  where given.
- Date, handicap used (where known).
- Total Stableford points.
- An "in progress -- X/Y holes" note for an incomplete round, since
  Practice has no separate completion ceremony to signal this
  otherwise.

**Deliberately absent, matching the explicit "do not invent"
instruction:** no position, no "winner," no ranking language of any
kind, no badge or Makers & Breakers content, no Event Story content.

## 5. CONFIRMATION COMPETITIVE EVENT HISTORY REMAINS UNCHANGED

- `/api/me/event-stories` was not modified in this pass -- its own
  `is_practice === false` filter (from the prior pass) is untouched,
  confirmed by inspecting the file before writing this report: it has
  no diff.
- The Event Winner -> Side Game Wins -> Badges ordering inside that
  route/component was not touched.
- Its most-recent-first sort was not touched.
- The `get_my_golf_summary` RPC (Events Played/Wins counters) was not
  touched in this pass -- it already correctly excludes Practice, per
  the prior pass's migration 075.
- A one-player normal Event trip is unaffected by any of this: its
  `is_practice` remains `false` (never inferred from group size, as
  established in the prior pass), so it never appears in the new
  Practice section and continues to appear in My Event Stories exactly
  as before.

## 6. TESTS RUN AND RESULTS

**409/409 pass** -- 274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 5 SQL-scanning migration tests + 54 trips.
Identical total to the prior pass's result, confirmed by a fresh full
re-run this session, not assumed unchanged. No new tests were added --
this pass introduced one new data-fetch/sum operation and one new
display component, neither of which has extractable pure-function
logic distinct from what's already covered by the existing Stableford
and trip-membership test coverage.

## 7. REAL-DEVICE ACCEPTANCE STILL REQUIRED

Nothing in this pass has been run against a live database or a real
device. Specifically:

1. Create and complete a Practice Round (using the prior pass's entry
   point), return to My Golf, confirm the new section appears with the
   correct course, date, handicap, and points.
2. Confirm the "PRACTICE" label reads as clearly non-competitive at a
   glance -- the actual visual/copy judgment call the brief cares
   about most, which only a real screen can confirm.
3. Refresh My Golf, confirm the practice record persists exactly as
   before.
4. Confirm a normal, separate Event's history is completely unaffected
   in the same session -- the regression check, on the same device,
   not just in isolation.
5. Confirm the Home card's Events Played/Wins counters still don't
   move when a Practice Round is created or completed -- this was
   fixed in the prior pass's migration but has never been confirmed
   live.
