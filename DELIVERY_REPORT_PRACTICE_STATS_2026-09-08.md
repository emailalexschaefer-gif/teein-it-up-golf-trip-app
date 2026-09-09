# PRACTICE STATS + MY STATS + MY GOLF PROGRESSION
## Delivery Report

**This package covers items 1-7 and item 11 of the 12-item brief,
built as a genuinely complete stack (migration -> API -> UI) for each,
not UI-only. Items 8, 9, 10, and 12 were not reached.** Stated
plainly up front, per your own explicit "do not report partial UI-only
work as complete" instruction.

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run, and the new migration has never
executed against a live database. All 13 touched/new files
syntax-check with zero errors. Full test suite: **417/417 pass** (280
pure-function scoring + 61 highlights + 8 analytics + 7 profile + 7
SQL-scanning migration tests + 54 trips) -- the +6 over the prior
total is the new, dedicated practiceStats.test.ts suite, described
below.

---

## 1. FILES CHANGED

**New:**
- `supabase/migrations/079_practice_hole_stats.sql`
- `src/lib/scoring/practiceStats.ts` (pure calculation function)
- `src/lib/scoring/practiceStats.test.ts` (6 tests)
- `src/app/api/trips/[tripId]/rounds/[roundId]/practice-stats/route.ts` (per-hole upsert/fetch)
- `src/app/api/trips/[tripId]/rounds/[roundId]/my-stats/route.ts` (live aggregation)
- `src/components/scoring/PracticeHoleStatsPanel.tsx` (per-hole capture UI)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/my-stats/page.tsx` (live dashboard)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/practice-summary/page.tsx`

**Modified:**
- `src/app/(app)/practice/new/page.tsx` (Track Stats toggle)
- `src/app/api/practice/create/route.ts` (persists the choice)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (mounts the stat panel; completion CTA now routes to Practice Summary)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` (threads trackStats down)
- `src/app/(app)/trips/[tripId]/layout.tsx` (fetches is_practice once for both nav bars)
- `src/components/layout/TripBottomNav.tsx` (Practice-specific item set)
- `src/components/scoring/PlayerRoundView.tsx` (item 11 fix)

## 2. MIGRATIONS ADDED

079_practice_hole_stats.sql -- two things:
1. `rounds.track_practice_stats BOOLEAN NOT NULL DEFAULT false`.
2. `practice_hole_stats` table.

Both additive only. Every existing round defaults to
track_practice_stats = false; the new table starts empty. Nothing
existing is altered or requires backfill.

## 3. PRACTICE STAT DATA MODEL CHOSEN AND WHY

A new, narrow table -- practice_hole_stats(id, scorecard_id,
hole_number, fairway_hit, gir, putts, created_at, updated_at), keyed
by scorecard_id + hole_number with a UNIQUE constraint on that pair.

**Why scorecard_id rather than round_id + player_id separately:**
confirmed by reading the actual scorecards schema before choosing -- a
scorecard already uniquely identifies one player's one round, so
round_id/player_id would be redundant, derivable information, not a
stronger key. The narrower key is also what makes the upsert trivially
idempotent: the database itself enforces "one row per golfer + round +
hole," not merely application-code discipline.

**Why not score_entries:** that table is Event scoring's own,
already-complex model (capture_role, verification status,
shared-device semantics) -- adding three Practice-only nullable columns
there would mean every Event query touching that table now has to
reason about columns that are meaningless outside Practice. A separate
table means Event code paths are provably unaffected (they never
reference practice_hole_stats at all), which is a stronger guarantee
than "these columns happen to always be null for Event rows."

**All three stat columns are nullable, deliberately.** This is the
direct mechanism for "missing is not the same as No" -- a NOT NULL
column with a default would silently collapse "never answered" into
"answered No."

## 4. HOW TRACK STATS YES/NO IS PERSISTED

rounds.track_practice_stats, set once at round creation from the
setup screen's explicit Yes/No choice, read back everywhere downstream
(the stat panel's own visibility, the live dashboard, the summary
screen) -- never inferred from whether any practice_hole_stats rows
happen to exist for the round.

## 5. HOW PER-HOLE STAT UPSERTS WORK

POST /api/trips/[tripId]/rounds/[roundId]/practice-stats --
admin.from('practice_hole_stats').upsert(..., { onConflict:
'scorecard_id,hole_number' }). Explicitly refuses to write anything
for a non-Practice round (checked via trips.is_practice directly in
the route, not inferred from the caller only ever calling it from a
Practice screen). The client (PracticeHoleStatsPanel) autosaves each
tap independently -- there is no "submit" step at all, so a stat answer
can never block Next Hole by construction, not just by omission of a
blocking check.

## 6. EXACT DENOMINATOR LOGIC FOR FAIRWAY/GIR/PUTTS

Built as one pure, tested function (calculatePracticeStats) rather
than inline UI math, precisely because the brief was this explicit
about it:

- **Fairways**: eligible = Par 4/5 holes only (Par 3 is never in the
  denominator at all, not even as zero). Of those eligible holes,
  "answered" = fairwayHit !== null. fairwayPct = fairwaysHit /
  fairwaysAnswered -- never / fairwaysEligible. An eligible but
  unanswered hole is excluded from both numerator and denominator, not
  treated as a miss.
- **GIR**: every hole is eligible; same answered-only rule.
- **Putts**: totalPutts/puttsPerHole only sum holes where a putt
  count was actually entered; an unanswered hole contributes nothing
  to either.
- All three percentages return null (not 0) when nothing has been
  answered yet, so the UI can distinguish "no data" from "0%."

**Verified, not just written:** 6 tests specifically target the cases
the brief called out by name -- unanswered fairway/GIR never counted as
a miss, Par 3 never a fairway opportunity, zero answered stats yields
null not 0%, a picked-up hole counts toward completion but
contributes no gross strokes, and a mixed multi-hole example checked
against hand-computed expected percentages. All 6 pass.

## 7. HOW MY STATS IS CALCULATED

GET /api/trips/[tripId]/rounds/[roundId]/my-stats reads real
persisted data only -- score_entries (capture_role='self', the same
official-score convention used everywhere else in this app) for
gross/Stableford, practice_hole_stats for fairway/GIR/putts -- builds
one PracticeHoleInput[] array in actual play-sequence order (respecting
Front9/Back9/10th-tee starting-hole sequencing from the prior
delivery), and calls the exact same calculatePracticeStats() the
tests above verify. The live dashboard page polls this route every 8
seconds. Labelled "My Stats" when tracking is enabled, "My Round" when
it isn't -- both read the identical route, differing only in which
sections render.

## 8. HOW PRACTICE SUMMARY DERIVES ITS VALUES

Reuses the exact same /my-stats route -- extended to also return
course/tee/date/starting-hole metadata alongside the same summary
object. This is deliberate: the live dashboard and the summary screen
can never disagree, because neither computes anything independently of
the other; both are two different renderings of one route's one
response. Nothing Event-related (marker verification, Makers &
Breakers, Event Complete, Side Game winners, Event Story) is fetched
or referenced anywhere in this file at all -- confirmed by there being
no such API call in the summary page's own source, not merely hidden
behind a conditional.

## 9. HOW MY GOLF PRACTICE PROGRESS AGGREGATES HISTORY

**Not built in this pass.** The existing Practice Rounds section in My
Golf (/api/me/practice-rounds, from an earlier delivery) still only
returns course/date/holes/points -- it does not yet read
practice_hole_stats at all, so per-round fairway/GIR/putts and the
trend view (Practice Progress) described in item 8 of the brief are
not present. This is a real, named gap, not an oversight -- see "not
completed" below.

## 10. HOW LIVE VS FINAL SIDE GAME STATUS IS SEPARATED

**Not built in this pass.** Items 9/10 of the brief (My Golf live Side
Game status, official Side Game win history) were not started.

## 11. HOW OFFICIAL SIDE GAME WINS REMAIN IDEMPOTENT

Not applicable -- not built.

## 12. ROOT CAUSE OF THE MOMENT MERGE BUG

**Not investigated further this pass** -- carried over from the prior
report's honest assessment: tracing the reported directional asymmetry
requires following the actual client-side call path for a
paper/shared-device verification confirming a digital player's result
specifically, which is more investigation than remaining time allowed
to do responsibly, especially given the explicit instruction not to
disturb the now-working verifier logic sitting right next to it.

## 13. HOW MERGE LOGIC WAS MADE VERIFIER-DIRECTION INDEPENDENT

Not applicable -- not built.

## 14. TESTS ADDED/RUN

- 6 new tests in practiceStats.test.ts, specifically targeting the
  denominator rules described above.
- Full suite re-run fresh this session: **417/417 pass.**
- No tests added for the API routes or UI components themselves --
  these are integration-level code (Supabase queries, Next.js routing)
  without the kind of pure-function logic this project's existing test
  infrastructure targets; the calculation they depend on
  (calculatePracticeStats) is the piece that actually needed and got
  test coverage.

## 15. ANYTHING NOT COMPLETED

Stated plainly, matching the brief's own explicit warning against
under-reporting this:

- **Item 8 of the brief** (Practice History/Progress in My Golf) --
  not built. The existing Practice Rounds section in My Golf still
  shows only course/date/holes/points; it does not read
  practice_hole_stats, show fairway/GIR/putts per historical round, or
  offer any trend view. This is the most direct next step if this
  work continues, since the data now exists (this pass's migration)
  but nothing yet reads it for history.
- **Item 9 of the brief** (My Golf live Side Game status) -- not
  built.
- **Item 10 of the brief** (My Golf official Side Game win
  history/idempotent finalisation) -- not built.
- **Item 12 of the brief** (Side Game photo/Moment merge direction
  bug) -- not investigated further; genuinely needs dedicated tracing
  time next to code that must not regress.

**What was completed and is ready for real-device testing:** the full
setup-to-summary Practice stats loop (items 1-7 of the brief) and the
duplicate My Moments fix (item 11 of the brief).

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

1. Full acceptance test 14 from the brief -- Eagle Ridge, Blue tees, 9
   holes, Back 9, Track Stats = Yes -- confirming sequence, stat
   visibility rules, autosave, refresh-survival, live My Stats
   accuracy, and Practice Summary agreement with the live view.
2. Acceptance test 15 -- Track Stats = No -- confirming no stat
   controls appear and "My Round" (not "My Stats") is the label used.
3. Confirm the Practice-specific bottom nav (Home/Scorecard/My
   Stats/My Golf) renders correctly and that Chat's unread-message
   query is genuinely skipped for Practice, not just hidden visually.
4. Items 8-10, 12 remain unbuilt and untestable.
