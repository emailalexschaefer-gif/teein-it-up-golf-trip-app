# CONSOLIDATED FIELD-TEST FIXES + PRACTICE ROUND IMPROVEMENTS
## Delivery Report

**Read this first: this package is not fully complete, and I want to
be direct about exactly where the line falls rather than present
partial work as finished.** Items 1, 2, and part of 3 are done and
verified. Items 4 through 8 (per-hole Practice Stats, the live My
Stats dashboard, Practice-specific navigation, the Practice Summary
screen, and Practice History/Progress in My Golf) are each genuinely
substantial features -- new data models, new components, new API
routes -- and were not reached in this pass. Below is exactly what was
done, what wasn't, and why, so you can decide how to sequence the rest
rather than discover gaps later.

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run, and there is no live database
connection (directly relevant to item 1). All touched files
syntax-check with zero errors. Full test suite: **411/411 pass**.

---

## ITEM 1 (P0) -- CONSOLIDATED PRODUCTION REPAIR SCRIPT

**Done.** Audited every migration touching `side_comp_entries`,
`verifier_source`, `resolve_side_comp_verifier()`, or side-game
submission -- 037, 038, 045, 047, 049, 050, 051, 071, 072, 076 -- by
reading each one's actual CREATE/ALTER statements directly, not
inferring from filenames.

**Chain summary:**
- **037** -- creates `side_comp_entries` (base table). Required
  prerequisite, unrelated to the bug itself.
- **038** -- original submit RPCs, before `verifier_source` existed.
  Superseded by 047.
- **045** -- unrelated trigger fix. Not part of this chain.
- **047** -- adds `verifier_source` + the original 3-value constraint,
  original `resolve_side_comp_verifier`. Required (creates what this
  repair updates), but its function bodies are superseded.
- **049, 050** -- successive redeclarations of
  `submit_side_comp_value_entry` only. Both superseded by 051. Safe to
  rerun, not required if 051 has run.
- **051** -- latest `submit_side_comp_value_entry` and
  `submit_longest_drive_entry`. Required.
- **071** -- latest `resolve_side_comp_verifier`, introduces the
  `shared_device_partner` tier. Required.
- **072** -- unrelated RLS fix on a backup table. Not part of this
  chain.
- **076** -- the constraint fix this whole P0 depends on. Required.

**The repair script:**
`supabase/migrations/078_side_comp_verifier_production_repair.sql` --
one consolidated, idempotent script that re-applies the current-repo
version of every required piece (051's two RPCs verbatim, 071's
resolver verbatim, 076's constraint verbatim), in the correct order.
Every statement is CREATE OR REPLACE FUNCTION or
DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT -- none of them touch, move,
or delete a single existing row. Safe regardless of which subset of
the chain above has already reached production, and safe to run more
than once.

**How I verified it's genuinely correct, not just written correctly:**
extracted each function body via a precise line-range slice from its
real source file, then ran an exact string-containment check
confirming the assembled script's function bodies are byte-for-byte
identical to the source files -- not retyped from memory. Caught and
fixed one real slicing error during this process (an off-by-3-lines
cut that silently dropped a function's closing END; $$;, which I
caught by checking that dollar-quote pairs and function-declaration
counts came out even/correct before trusting the file) rather than
assuming a script that "looked right" was actually right. Full content
is in the delivered zip; a verification query is included at the end
of the script itself.

Debug detail remains surfaced on-screen, unchanged, per your
instruction not to close this until confirmed on-device.

---

## ITEM 2 -- PRACTICE ROUND RECONCILIATION CLEANUP

**Done.** Traced the actual root cause rather than assuming: the
marker-comparison model (mineStatus/partnerStatus/mismatch/pending)
always compares against a marker entry that structurally cannot exist
for a genuinely solo Practice round -- so every scored hole was
reading as "pending" forever, never "matched," because "matched" in
that model has always meant "both parties agree," which is a
meaningless question with no second party.

**Fix:** added an explicit `isPractice` prop to `SelfMarkerScoreShell`,
threaded from `page.tsx` (which now also selects `trips.is_practice`).
At the single source of computation, `isPractice` overrides status to
be derived purely from whether the player has entered their own score
for that hole -- scored is 'matched' (green), unscored is
'not_started'. No comparison logic runs at all. This fixes, at their
root, every downstream symptom: the amber dots, "0 holes matched · 18
waiting," "Scores still need review," and "Waiting on marker entries"
all now correctly reflect actual completion with zero marker language.
Also fixed the round-complete banner, which previously always showed
the organiser's "Go to My HQ to review and close the round" for
Practice (a Practice creator is always their own trip's organiser) --
now shows a genuine "Practice Round Complete" state with a "View in My
Golf" link instead.

---

## ITEM 3 -- REMOVE MAKERS & BREAKERS / EVENT CONTENT FROM PRACTICE COMPLETION

**Partially done.** The one thing directly reachable from the scoring
screen itself -- the completion banner -- no longer offers "Go to My
HQ" (which would otherwise be the doorway to Makers & Breakers, Side
Games, and Event Story) for Practice at all; it now leads to My Golf
instead. This closes off the main path into Event-only completion
content for Practice.

**Not done:** a full, positive "Practice Summary" screen (course,
tees, date, gross, Stableford, Practice Stats) as its own dedicated
destination -- this overlaps directly with item 7, and neither was
built in this pass. What exists today is the fixed banner above, not
the richer summary screen your brief describes.

---

## ITEMS 4 THROUGH 8 -- NOT STARTED

Per-hole Practice Stats (item 4), the live My Stats dashboard (item
5), Practice-specific navigation (item 6), the Practice Summary screen
(item 7), and Practice History/Progress in My Golf (item 8) were not
reached in this pass. Naming this plainly rather than leaving it
implicit:

- Item 4 needs a genuine new data model -- fairway/GIR/putts have
  nowhere to persist today. The lowest-risk approach is almost
  certainly a new, narrow table (practice_hole_stats or similar, keyed
  by scorecard + hole) rather than overloading score_entries, but
  that's a real design decision, not a trivial addition.
- Item 5 needs a new API route (aggregating fairway %/GIR %/putts per
  hole from whatever item 4 produces) and a new component to replace
  the Leaderboard nav slot for Practice specifically.
- Item 6 needs the bottom nav component to become Practice-aware and
  render a different item set -- currently a shared, un-parameterised
  component across every trip type.
- Item 7 depends on item 4's data existing at all.
- Item 8 needs a new My Golf section (trend aggregation across
  multiple Practice rounds, filterable by course/tees) building on
  MyPracticeRoundsSection (already exists) plus item 4's per-hole
  data.

None of these were started -- not partially built, not stubbed. I
chose to spend the available time making items 1-3 genuinely correct
(traced, verified, tested) rather than producing shallow, unverified
starts on 4-8, consistent with how this whole engagement has been run.

---

## ITEMS 9-10 -- CONFIRMED STILL IN PLACE

Both were delivered in earlier passes and re-confirmed untouched this
session:
- **Item 9** (Course Library + profile handicap for Practice) --
  CourseLibrarySearch reuse and the handicap pre-population endpoint
  are unchanged.
- **Item 10** (homepage CTA layout) -- the flex: 1 side-by-side Create
  Event / Practice Round buttons are unchanged.

---

## FILES CHANGED

- `supabase/migrations/078_side_comp_verifier_production_repair.sql` (new -- item 1)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (items 2, 3)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` (item 2 -- threading isPractice)

## TESTS

**411/411 pass**, confirmed via a fresh, complete run this session. No
new tests added -- items 2/3 are UI-state-derivation fixes without new
extractable calculation logic, and item 1 is a SQL repair script,
verified by exact source-content matching rather than a unit test.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

1. **Item 1**: run the repair script directly against production, then
   the verification query at its end, then retest the shared-device
   Side Games acceptance flow from the prior brief.
2. **Item 2**: complete a Practice Round end to end, confirm every
   hole shows green/final with no marker language at any point, during
   or after completion.
3. **Item 3**: confirm the completion banner reads correctly and leads
   to My Golf, not My HQ.
4. **Items 4-8**: not ready for device testing -- not built yet.

## RECOMMENDED NEXT STEP

Given items 4-8 are substantial and interdependent (5, 7, and 8 all
depend on item 4's data existing), I'd suggest sequencing a follow-up
specifically around item 4 first -- the data model decision there
shapes everything after it -- rather than folding it into another
combined brief this size.
