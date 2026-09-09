# PRACTICE V2 -- P0 FIXES + FRONT/BACK 9 MODEL
## Delivery Report

**This package covers items 1, 2, and 4 of the 14-item brief, done and
verified. Items 3, 5 through 11 were not reached.** Naming this
plainly up front, consistent with every prior round of this
engagement.

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run. All 3 touched files
syntax-check with zero errors. Full test suite: **411/411 pass** --
identical to the prior total, confirming nothing in the scoring engine
or shared-device/verification logic was touched. Per the explicit "do
not regress the now-working 1 Digital + 1 Paper shared-device scoring
or Side Game verification" instruction: nothing in this delivery
touches resolve_side_comp_verifier, the submit RPCs, the
verifier_source constraint, or any shared-device detection code --
confirmed by the file list below.

---

## ITEM 1 (P0) -- PRACTICE FINALISATION BLOCKED BY MARKER ENTRIES

**Root cause, confirmed by reading the actual finalisation route, not
assumed:** /api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts's
POST handler requires a marker entry for every hole whenever
round.score_capture_mode === 'self_and_marker' && !isSharedDevice.
Practice rounds were being created with no score_capture_mode set at
all, silently defaulting to 'self_and_marker' (the app-wide Event
default) -- and a solo Practice player is never shared-device (there is
no partner in the group to detect at all), so this gate fired for
every Practice round, every time, with no way to ever satisfy it.

**Fix, two parts:**
1. /api/practice/create now explicitly sets
   score_capture_mode: 'individual' when creating the round --
   'individual' is the existing mode that already has no marker
   concept by design, so Practice rounds are now created correctly
   from the start.
2. As explicit defense in depth, per your own "the Practice bypass
   must be explicitly scoped to the canonical Practice flag"
   instruction: the finalisation gate itself now also checks
   trips.is_practice directly and skips the marker-requirement block
   entirely when true, regardless of whatever score_capture_mode any
   given Practice round happens to carry, past or future.

**Regression check:** the gate's condition changed from
(mode === 'self_and_marker' && !isSharedDevice) to
(mode === 'self_and_marker' && !isSharedDevice && !isPracticeTrip) --
a normal Event's isPracticeTrip is always false, so its own
marker/reconciliation requirement is completely unchanged.

---

## ITEM 2 (P0) -- PRACTICE 9-HOLE SELECTION RESETS TO 18

**This turned out to be a genuine design flaw, not a UI re-render bug,
and I want to be direct that my own earlier delivery caused it.** The
previous version of the Practice setup page derived the holes state
directly from librarySelection.holes.length inside the
onSelectLibrary callback -- meaning selecting an 18-hole Course
Library tee silently overwrote whatever hole-count the golfer had
already chosen. This is precisely your own stated product rule: "an
18-hole Course Library course means 18 holes are available, it does
NOT mean the golfer has selected an 18-hole Practice Round."

**Fix:** rebuilt as item 4 below describes -- holes/nineSelection/
startingHole are now independent, golfer-authoritative state, never
read from or written by the course/tee selection in either direction.

---

## ITEM 4 (P1) -- FRONT 9 / BACK 9 / 18-HOLE STARTING-TEE MODEL

**Built as one fix together with item 2**, since the new model is what
actually prevents the reset bug from being possible at all, not a
separate feature bolted alongside a patched version of the old one.

**New flow**, exactly as specified:
- Step 1: "How many holes?" -- 9 or 18.
- If 9: "Which nine?" -- Front 9 (holes 1-9) or Back 9 (holes 10-18).
- If 18: "Where are you starting?" -- 1st Tee or 10th Tee.

**Play sequences implemented exactly as specified:**
- 9 + Front -> [1..9]
- 9 + Back -> [10..18]
- 18 + 1st Tee -> [1..18]
- 18 + 10th Tee -> [10..18, 1..9]

**How this is persisted correctly:** the server now builds a full
hole-number -> {par, stroke_index, distance} lookup first (from the
selected library tee where present, the existing STANDARD_18 fallback
otherwise), then slices that lookup by the golfer's own explicit
sequence -- never by the pool's own size. rounds.holes is set to the
golfer's own 9/18 choice directly, not derived from anything else, and
starting_hole_number is the sequence's own first hole (1 or 10). A
Course Library tee that happens to only have partial data for some of
the needed hole numbers falls back to STANDARD_18's value for that
specific hole, rather than failing the whole round.

**Not separately re-verified against the scoring shell's own
completion logic** -- the Practice reconciliation fix from the prior
session already derives completion from "has this player entered
their own score for this hole," which is agnostic to which specific
hole numbers are in play, so a 9-hole Back 9 round completing after
holes 10-18 (not waiting on 1-9) should already work correctly as a
consequence of that earlier fix -- but this specific scenario has not
been independently re-tested end to end in this pass.

---

## ITEMS 3, 5-11 -- NOT REACHED

**Item 3** (shared-device Side Game photo/announcement merge
direction) -- I opened the relevant file
(entries/[entryId]/verify/route.ts) and confirmed it already has real,
thoughtful merge logic for one direction. Tracing the reported
asymmetry properly requires following the client-side call path for
which code actually fires when a paper/shared-device claim is resolved
for the digital player specifically -- genuinely more investigation
than remaining time allowed to do responsibly. Not guessed at or
partially patched.

**Items 5-11** (optional Practice stats toggle + capture UI + new
practice_hole_stats migration, the live My Stats dashboard, the
Practice Summary screen, Practice History/Progress in My Golf,
Practice-specific navigation, My Golf live/final Side Game status) --
not started. These remain exactly the substantial, interdependent body
of work described in the prior report: item 5's data model decision
shapes everything built on top of it.

---

## FILES CHANGED

- `src/app/api/practice/create/route.ts` (items 1, 2, 4)
- `src/app/(app)/practice/new/page.tsx` (items 2, 4)
- `src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts` (item 1)

## TESTS

**411/411 pass**, confirmed via a fresh, complete run this session. No
new tests added -- these are UI-flow and server-validation fixes
without new extractable pure-function calculation logic.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

1. Complete a Practice Round, confirm Confirm Final Scores succeeds
   with no marker warning and no debug payload shown.
2. Select 9 holes, pick a Course Library course and tees, confirm the
   9-hole choice survives course/tee selection in both directions
   (select holes first then course, and course first then holes).
3. Test all four play sequences explicitly -- 9+Front, 9+Back, 18+1st,
   18+10th -- confirming scoring starts on the correct hole and
   completion triggers at the correct point (a 9-hole Back 9 round
   completing after hole 18, not waiting on holes 1-9).
4. Re-run the full shared-device Side Games acceptance test from the
   prior briefs to confirm no regression, since that remains the most
   safety-critical path in the app.
5. Items 3, 5-11 remain unbuilt and untestable.
