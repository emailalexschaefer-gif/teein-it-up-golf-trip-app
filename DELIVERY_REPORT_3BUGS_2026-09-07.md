# THREE TARGETED BUG FIXES -- 7 SEP FIELD-TEST
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run. All 5 touched/new files
syntax-check with zero errors. Full test suite: **409/409 pass** --
identical to the prior total, confirming these UX/navigation-only
fixes changed no calculation anywhere.

**Scope discipline, as instructed:** all three fixes are targeted.
None of them touch hole-data validation/storage, scoring calculation,
the shared-device architecture, or leaderboard/standings logic --
confirmed by the files list below, and by the unchanged test count.

---

## 1. HOLE SETUP SCREEN TOO HEAVY BY DEFAULT

**Root cause:** the full editable Par/SI table (`stage === 'holes'` in
`BeginRoundModal.tsx`) rendered unconditionally the moment this stage
was reached -- for any round without a valid Course Library snapshot,
this stage is the only path there is (the earlier "skip straight to
Confirm" logic only applies when real library data exists), so every
manually-configured round hit the full table immediately, exactly as
reported.

**Fix:** the table is now wrapped in the same shared `CollapsibleSection`
component used throughout My Golf/My HQ ("Need to edit holes or
indexes?"), collapsed by default. A one-line summary ("Par 72 -- 9
holes -- using the template shown above") sits above it so the
organiser sees confirmation without opening anything. Confirm &
Continue remains the primary action either way. Custom nine
(`playingNine === 'custom'`) is the one case defaulted **open**
instead -- editing is already the expected next action there, not an
exception to go looking for.

**Not touched:** `holes` state, `updateHole`, hole validation, or
anything persisted to the round -- purely where/how the same table
renders.

## 2. COMPLETED SHARED-DEVICE ROUND SUMMARY ONLY SHOWED ONE PLAYER

**Root cause, confirmed by reading the actual render conditions, not
assumed:** two separate things combined to produce exactly the
reported symptom.

1. The one summary block that *did* show both totals side by side
   was explicitly gated `!isLocked` -- it vanished the instant the
   round was actually submitted, which is precisely when a completed
   summary is being viewed.
2. The detailed hole-by-hole table (Hole/Par/Gross/Pts with OUT/TOTAL
   rows, matching your screenshot exactly) had no equivalent for the
   shared-device partner anywhere in the file -- only ever built from
   the caller's own data.

**Fix:**
- Removed the `!isLocked` restriction on the shared-device
  side-by-side totals card. (Left the *separate*, genuine
  Digital+Digital marker-comparison card's own `!isLocked` gate
  untouched -- that's a different scenario, not what was reported.)
- Added a second detailed hole-by-hole table for the partner,
  reusing the exact same `SummaryRow`/`SubtotalRow` components the
  caller's own table already uses, and reusing the already-computed
  per-hole status (for a shared-device pair, that status is inherently
  shared between both players, not caller-specific) rather than
  computing a second status. Scoped specifically to
  `isSharedDeviceScoring`, matching the exact reported scenario.

**Not touched:** score calculation, Stableford points, reconciliation
logic, or the separate Digital-to-Digital marker-comparison
presentation.

## 3. "VIEW RESULTS" ROUTED TO SCORING INSTEAD OF RESULTS

**Root cause:** `TripRoundsTab.tsx`'s "View Results" link pointed to
`/trips/{tripId}/rounds/{round.id}` -- the identical route "Continue
Scoring" uses.

**Fix, discovered to be smaller than expected:** the actual results
page already existed and was already built to support this exact
case -- `leaderboard/page.tsx` already accepts an explicit `?roundId=`
override, with its own comment confirming it was built specifically so
"View Final Results for a specific completed round" could work. "View
Results" now points there instead, passing `round.id` directly --
which is also what keeps it correctly scoped to the tapped round even
when a later round exists, since the override is explicit rather than
inferred.

Makers & Breakers was already present on that page -- `LiveLeaderboard`
already renders `RoundHighlightsSection` internally, built for this
exact purpose in the 3 Sep package. The one genuinely missing piece
was Side Game results, added as a new small component
(`RoundSideGamesSection`) reusing the identical, already-existing
`/api/trips/{tripId}/rounds/{roundId}/side-games` endpoint My HQ's own
organiser-facing Side Games Snapshot already calls -- same data, same
label/icon mapping, not a second calculation.

---

## FILES CHANGED

- `src/components/scoring/BeginRoundModal.tsx` (item 1)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (item 2)
- `src/app/(app)/trips/[tripId]/tabs/TripRoundsTab.tsx` (item 3, link fix)
- `src/app/(app)/trips/[tripId]/leaderboard/page.tsx` (item 3, Side Games wiring)
- `src/components/scoring/RoundSideGamesSection.tsx` (item 3, new)

## MIGRATIONS: none required.

## TESTS: 409/409 pass, identical to the prior total -- confirmed via a
fresh, complete run this session, covering all four migration-scanning/
trips suites plus every pure-function suite.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

Nothing here has been run on a device. Specifically, per your own
acceptance check:

1. Create a 9-hole round, confirm the Hole Setup screen shows the
   collapsed "Need to edit holes or indexes?" control by default, with
   Confirm & Continue immediately available.
2. One digital + one paper player, complete scoring for both, confirm
   the Round Summary shows both scorecards -- both totals side by
   side, and both full hole-by-hole tables.
3. Close the round, tap Round 1 -> View Results, confirm it lands on
   the Round 1 leaderboard specifically (not scoring), with Makers &
   Breakers and Side Game results both visible.
4. With Round 2/3 also present, confirm Round 1 -> View Results still
   opens Round 1 specifically, not whichever round is otherwise
   "current."
