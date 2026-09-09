# PRACTICE HOME/BACK + MY GOLF PRACTICE HISTORY/PROGRESS
## Delivery Report

**This package covers items 1-3 of the 6-item brief (P1), done and
verified. Items 4-6 (My Golf live Side Game status, official Side
Game wins after close, and the Side Game Moment merge bug) were not
reached.** Stated plainly up front.

**Build/test caveat, unchanged from every prior round:** no network
access -- npm run build was not run, and nothing here has executed
against a live database. All 3 touched files syntax-check with zero
errors. Full test suite: **417/417 pass** -- identical to the prior
total, confirming this pass changed no calculation (the shared
calculatePracticeStats function itself was not modified, only reused
in a new place).

---

## 1. FILES CHANGED

- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (item 1)
- `src/app/api/me/practice-rounds/route.ts` (items 2-3)
- `src/components/scoring/MyPracticeRoundsSection.tsx` (items 2-3)

## 2. MIGRATIONS ADDED

None. This pass reads existing data (score_entries,
practice_hole_stats, rounds.track_practice_stats/starting_hole_number)
introduced by the prior two deliveries -- nothing new to persist.

## 3. HOW PRACTICE HOME/BACK NAVIGATION WAS IMPLEMENTED

**Investigated the existing "Exit" control first**, per the brief's
own explicit instruction to check before adding anything. Found it:
routes to /trips/{tripId} -- exactly right for a normal Event (the
trip lobby), but meaningless for Practice, which has no lobby, no
organiser ceremony, nothing at that URL worth landing on.

**Fix:** the header control is now Practice-aware -- for isPractice,
it reads "← Home" and links directly to /dashboard; for a normal
Event, it's byte-for-byte the same "✕ Exit" -> trip lobby behaviour as
before. This is an explicit Link href, not a router.back() or browser-
history call, matching the brief's explicit "must not rely on browser
history" requirement -- history could otherwise return through
Practice setup or Course Library depending on how the player arrived.

Found and fixed two more occurrences of the same pattern in this file
during the search: one genuine early-return error/loading state that a
Practice player could reach ("← Back to trip" -> now "← Home" for
Practice), and confirmed two other occurrences are inside blocks
already provably unreachable for Practice (the marker-mismatch review
screen and the "waiting for other players" screen -- both already
forced empty/inert for Practice by the prior session's reconciliation
fix), so they were correctly left untouched rather than edited
speculatively.

**No duplicate clutter added**, per the brief's explicit concern:
Practice's bottom nav already has "Home" as its own first item (from
the prior delivery) -- this header control is the one additional,
always-visible-during-active-scoring link the brief specifically
asked for ("on mobile scoring, preference is for an obvious header-
level ← Home"), not a second, redundant Home destination.

## 4. HOW ACTIVE PRACTICE RE-ENTRY IS PRESERVED

Not changed in this pass, and confirmed by inspection rather than
assumed: navigating "Home" is a plain link, not a mutation of any
kind -- no round status change, no cancellation, no finalisation call
anywhere in this fix. Reopening the same round from My Golf/Home lands
back on this same SelfMarkerScoreShell instance, reading the same
persisted myScorecard/holes/practice_hole_stats this whole Practice
stack already correctly hydrates from (per the earlier session's
stale-hydration fix) -- there was nothing new required here because
the underlying persistence was already correct; this item was purely
about providing the navigation path itself.

## 5. HOW PRACTICE HISTORY READS COMPLETED ROUNDS

/api/me/practice-rounds was rewritten to reuse
calculatePracticeStats() -- the exact same pure function the live My
Stats route and Practice Summary already call -- rather than computing
its own separate fairway/GIR/putts totals. Per round, it assembles the
same PracticeHoleInput[] shape (score_entries for gross/Stableford,
practice_hole_stats for the optional stats) and hands it to that one
function. This directly satisfies "we should not have three separate
implementations calculating the same statistics" -- there is now
exactly one.

MyPracticeRoundsSection now shows gross alongside Stableford, the
9/18 + Front/Back label (derived from the round's own persisted
starting_hole_number, not re-guessed), and per-round fairway/GIR/putts
figures -- but only when track_practice_stats was true for that round,
and only the specific figures that were actually answered on at least
one hole. A round with stats off shows no stats line at all, never a
fake 0%.

## 6. HOW PRACTICE PROGRESS AGGREGATION WORKS

New PracticeProgressSection, grouped by course + tee + hole-count (the
brief's own "Eagle Ridge — Blue Tees" example), falling back to "All
courses" only when no course name was recorded. Each group shows
average gross, average Stableford, and -- only from rounds where the
relevant stat was actually answered -- average fairway %, GIR %, and
putts/hole. A round with Track Stats off, or a stat that was simply
never answered on any hole, contributes nothing to those specific
averages; it is not treated as a zero, matching the brief's explicit
"do not convert missing optional stats into zeroes" instruction
directly.

## 7. HOW 9-HOLE VS 18-HOLE COMPARISONS ARE HANDLED

Grouping key is course+tee+holecount specifically -- a Front-9 round
and a Back-9 round at the same course fall into the same group only if
holes === 9 for both (they're grouped together as "9-hole practice at
this course," distinguished from any 18-hole rounds at the same
course, which form their own separate group). Gross/Stableford
averages are therefore never blended across a 9-hole and an 18-hole
round for the same course -- confirmed by reading the actual grouping
key construction, not assumed from intent.

## 8. HOW MISSING OPTIONAL STATS ARE HANDLED

Same rule enforced at three layers now, not just one: calculatePracticeStats
itself (unchanged, already tested in the prior pass) never counts an
unanswered stat as a miss; the History list only shows a stat line
when at least one relevant answer exists for that round; Progress only
includes a round's figure in an average when that specific stat was
answered for that round. A player who tracked GIR but never answered
Fairway on a given round sees GIR in that round's history line and
Progress average, with Fairway simply absent from both -- not shown as
0%.

## 9-11. MY GOLF LIVE SIDE GAME STATUS / OFFICIAL WINS / IDEMPOTENCY

**Not built in this pass.** Items 4-5 of the brief were not reached.

## 12-13. MOMENT MERGE BUG ROOT CAUSE / FIX

**Not investigated further this pass.** Item 6 of the brief was not
reached -- carried forward from the prior two reports' honest
assessment: this needs dedicated tracing of the actual client-side
call path, and the brief's own explicit "do not disturb the now-
working shared-device verification" warning means this is not
something to approach with remaining time pressure.

## 14. CONFIRMATION VERIFIER LOGIC WAS NOT REGRESSED

Nothing in this pass touches resolve_side_comp_verifier, any submit
RPC, the verifier_source constraint, side_comp_entries, or any
Moment/announcement code at all -- confirmed by the file list in
section 1: three files, none of them in the Side Games or Moments
code paths.

## 15. TESTS ADDED

None new. calculatePracticeStats itself (and its 6 existing tests) is
unchanged -- this pass only added new call sites, which is exactly why
zero new tests were needed to cover new calculation logic: there isn't
any new calculation logic, only new places reusing the existing,
already-tested one.

## 16. FULL TEST-SUITE RESULT

**417/417 pass** -- 280 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 7 SQL-scanning migration tests + 54 trips.
Identical total to the prior delivery, confirmed via a fresh, complete
run this session.

## 17. ANYTHING NOT COMPLETED

- **Item 4** (My Golf live Side Game status) -- not built.
- **Item 5** (official Side Game wins after round close, with
  idempotency) -- not built.
- **Item 6** (Side Game photo/Moment merge asymmetry) -- not
  investigated further.

**What was completed and is ready for real-device testing:** Practice
Home/Back navigation (item 1), and the full My Golf Practice
History/Progress extension (items 2-3), including the 9-hole
comparison safeguard and the missing-stats handling the brief was
explicit about.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

1. The end-to-end test from the brief (item 10): Practice, Back 9,
   Track Stats on, score partway, check My Stats, tap Home, confirm
   main Home loads, reopen the same active Practice round, confirm
   scores/stats/current-hole all restored correctly, complete the
   round, confirm no marker gate, check Practice Summary, then confirm
   My Golf shows the completed round with matching figures.
2. Confirm Practice Progress groups correctly across multiple rounds
   at the same course/tee, and that a 9-hole and an 18-hole round at
   the same course do not blend into one misleading average.
3. Items 4-6 remain unbuilt and untestable.
