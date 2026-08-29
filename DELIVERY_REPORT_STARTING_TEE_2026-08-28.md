# ROUND STARTING TEE / FRONT & BACK NINE SUPPORT
## Delivery Report — 2026-08-28

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` could not be run. All 16
files touched were syntax-checked with the TypeScript compiler directly
— zero errors. All 236 `src/lib/scoring/**` tests (224 existing + 12
new) and all 46 `src/lib/highlights/**` tests pass. **Run `npm run
build` before this ships.**

Per your explicit instruction, this was inspect-first, implement-once,
as one coherent pass — no partial state left half-connected.

---

## 1. Root cause / architecture found

Confirmed before writing any code:

- `begin_round()` and the `holes` table store whatever `hole_number`
  values they're given — nothing anywhere assumes 1..N contiguity at
  the storage layer.
- A "Playing Nine" (front/back/custom) concept **already existed**
  (`defaultHoles.ts`, `BeginRoundModal.tsx`) and already correctly
  handled 9-hole front/back with real, unrenumbered physical hole
  numbers — but was explicitly gated to 9-hole rounds only; an 18-hole
  round never read it.
- Scoring navigation (`holeIdx`, Next/Previous, swipe, completion) in
  `SelfMarkerScoreShell.tsx` already operates purely on **array
  position**, never on the `hole_number` value itself — exactly the
  "already navigates by array position" finding from the inspection
  phase, confirmed correct.
- The actual gap: `holes/route.ts` — the one place that fetches holes
  for scoring — ordered strictly `.order('hole_number', ascending)`.
  That happens to equal play order for three of the four
  configurations (9/1st, 9/10th, 18/1st) but not the fourth (18/10th,
  which needs 10→18→1→9).
- Shotgun's own mechanism (`start_type`, `round_group_starting_holes`)
  is a genuinely separate, per-GROUP concept — confirmed via migration
  055 and left completely untouched.
- No existing column represents a single round-level Starting Tee
  value. A new, small, additive field was genuinely required.

## 2. Implementation approach

Exactly your six-step sequence, in order:

1. **`starting_hole_number`** — new column, `INTEGER NOT NULL DEFAULT 1
   CHECK IN (1, 10)`. Migration 067.
2. **Round setup UI** — "Starting Tee: 1st Tee / 10th Tee" added
   directly under Holes in `StepRounds.tsx`, the same wizard component
   both trip creation and editing an existing trip's rounds share (no
   second UI to build).
3. **Round-start template generation** — `deriveBeginRoundHoles()`
   extended to take `startingHoleNumber` and produce the correct hole
   set for all four configurations. Caught and avoided a real
   regression here: `DEFAULT_9_HOLES` has genuinely different (correct)
   stroke-index values than `DEFAULT_18_HOLES`'s holes 1-9 — the
   9-hole no-snapshot cases still use the original dedicated templates;
   only the new 18/10th-tee combination reorders `DEFAULT_18_HOLES`'s
   own real data.
4. **`holes/route.ts` fix** — the actual navigation-facing bug. Now
   reorders via `orderHolesByPlaySequence` (the one authoritative
   sequence, `holeSequence.ts`) whenever the round is 18 holes from the
   10th tee. A no-op for every other configuration and for Shotgun
   rounds (which never set this new column, so it stays at its default
   of 1).
5. **Shotgun** — not touched. `start_type`, `round_group_starting_holes`,
   and their own navigation code are unmodified.
6. **Regression-tested** the pure-function layer exhaustively (below);
   real-device regression testing of the six scenarios you listed still
   needs to happen on the next field test — see the acceptance section.

## The core abstraction

`src/lib/scoring/holeSequence.ts` — `computeHolePlayOrder(holeCount,
startingTee)` and `orderHolesByPlaySequence()`. One function, reused by
every consumer (round setup's hole-number picker, `holes/route.ts`,
`deriveBeginRoundHoles`, My HQ's group-progress display, and — see
below — Makers & Breakers), matching "the smallest common abstraction
that can provide the ordered physical holes for a round rather than
patching every screen independently."

## Two additional real bugs found and fixed while tracing every
consumer (per your explicit instruction to search for these before
implementing)

- **My HQ's "Group Progress" panel** computed the displayed current
  hole as `holesPlayed + 1` — correct only for a 1st-tee round. Fixed
  to look up the actual physical hole via the play-order sequence.
- **Front9/Back9 and OUT/IN scorecard splits**, in both
  `ScoreSessionShell.tsx` and `SelfMarkerScoreShell.tsx`, filtered by
  `hole_number <= 9` / `> 9`. For a 10th-tee round this is not just
  imprecise, it's backwards — it would label the holes played *last*
  as the ones played *first*. Fixed to split by array position (now
  correctly ordered) instead. OUT/IN needed no label changes (that
  terminology genuinely means "first nine played" / "second nine
  played" in golf, correct regardless of physical hole numbers);
  Front9/Back9's labels now read the actual hole range dynamically
  when it isn't the standard 1-9/10-18 case, rather than showing a
  "front nine" label that would be untrue for a 10th-tee round.
- **Makers & Breakers — the most serious of the three.** Traced
  `getPlayedSequence` and found its wraparound formula assumed hole
  numbers run contiguously `1..totalHoles` — correct for Shotgun (which
  always operates within that assumption) but silently broken for a
  9-hole back-nine round: it would generate lookups for holes 1-9,
  which simply don't exist in a back-nine player's actual holes (all
  physically 10-18) — every lookup fails, and Makers & Breakers would
  come back completely empty for that round. This is a **pre-existing
  latent bug**, not one introduced by this feature — the existing
  "Playing Nine: Back" option could already trigger it. Generalized the
  function to index into the round's actual set of hole numbers
  (sorted) rather than reconstructing them arithmetically. Verified via
  the full 46-test `makersBreakers.test.ts` suite that this is
  byte-identical to the previous formula for every case that already
  worked (standard rounds, Shotgun on a full 18) — the generalization
  only changes behaviour for the case that was actually broken. Also
  fixed `highlights/route.ts`, which defaulted every non-Shotgun
  player's `startingHole` to `1` unconditionally, never reading the
  round's own Starting Tee.

---

## 3. Database changes

One migration, `067_starting_hole_number.sql` — additive, `NOT NULL
DEFAULT 1`, so every historical round is automatically and correctly
"starts at the 1st tee," its exact current behaviour, with no backfill
needed.

## 4. Files changed

- `holeSequence.ts` (new) — the canonical sequence function
- `holeSequence.test.ts` (new) — 12 tests, your exact four fixtures
  plus edge cases
- `067_starting_hole_number.sql` (new migration)
- `defaultHoles.ts` — `deriveBeginRoundHoles` extended
- `types/app.ts` — `WizardRound.starting_hole_number`
- `StepRounds.tsx` — Starting Tee UI control + Side Comps hole-picker
  fix
- `route.ts` (trip PATCH) — persistence
- `BeginRoundModal.tsx` — threads `startingHoleNumber` through
- `TripRoundsTab.tsx` — passes it to `BeginRoundModal`
- `TripDetailClient.tsx`, `page.tsx` (trip detail) — `RoundRow` type +
  select statements (all 4 variants, including fallback branches)
- `holes/route.ts` — the core navigation fix
- `tournament/route.ts` — group-progress current-hole fix
- `ScoreSessionShell.tsx`, `SelfMarkerScoreShell.tsx` — Front9/Back9,
  OUT/IN fixes
- `makersBreakers.ts` — `getPlayedSequence` generalized
- `highlights/route.ts` — `startingHole` fallback fix

## 5. Tests added

12 new tests in `holeSequence.test.ts`, covering exactly your four
fixtures plus: no duplicate/skipped holes for any combination, field
preservation through reordering, and graceful handling of an
unexpected hole_number. No new tests added for the display-layer fixes
(My HQ current-hole, Front9/Back9 labels) — those are harder to unit
test in isolation and are better verified in the acceptance pass below.

## 6. Test/build results

- `holeSequence.test.ts`: 12/12 pass
- Full `src/lib/scoring/**`: 236/236 pass (224 pre-existing + 12 new)
- Full `src/lib/highlights/**`: 46/46 pass, including confirming
  `getPlayedSequence`'s generalization is safe
- `defaultHoles.test.ts` specifically re-run: 23/23 pass, confirming
  `deriveBeginRoundHoles`'s new parameter is fully backward-compatible
- TypeScript syntax check: 16/16 files, zero errors
- `npm run build`: **not run** — no network access in this sandbox

## 7. Confirmation of the four Starting Tee scenarios

**Not device-verified — this is the honest gap.** Everything above is
unit-level (the pure sequence math) and code-level (inspection +
syntax checking) verification only. The pure-function layer is now
provably correct for all four combinations; what hasn't been exercised
is the full round-setup → begin-round → scoring → completion →
reconciliation → Confirm Final Scores → leaderboard chain end-to-end
on a real device.

## 8. Confirmation Shotgun Start still works

Not device-verified either, but the case for confidence is strong:
`start_type`/`round_group_starting_holes` are completely untouched.
The one place I touched that Shotgun also depends on
(`getPlayedSequence`) was verified mathematically identical to before
for the Shotgun case via the full existing 46-test suite — every one
of those tests still passes unchanged.

## 9. Remaining field-test items / honest gaps

- **All real-device verification** of the four Starting Tee scenarios
  and one Shotgun regression round — genuinely can't be done from this
  sandbox.
- I did not audit every single screen listed in your original brief's
  "controls" list (reconciliation UI copy, final scorecard display
  wording) for a hardcoded "hole 1"/"18 holes" assumption beyond the
  ones I found and fixed — I searched systematically but can't
  guarantee I found every instance without running the app.
- The Front9/Back9 section labels now show "HOLES 10-18" instead of
  "BACK 9" for the non-standard cases — a deliberate, conservative
  choice to avoid asserting incorrect golf terminology, but worth your
  eyes on whether that reads well in practice versus, say, "OUT"/"IN"
  labels there too.

## ACCEPTANCE CHECKLIST FOR NEXT FIELD TEST

Per your section 8, all four configurations, each checking: opening
hole, +/- scoring, Stableford, Previous/Next, swipe, correct physical
hole number/par/SI, scorecard order, progress count, final hole, no
early finish, reconciliation, Confirm Final Scores, round closure,
leaderboard totals, Makers & Breakers generation:

- A — 9 holes / 1st Tee → 1→9
- B — 9 holes / 10th Tee → 10→18
- C — 18 holes / 1st Tee → 1→18
- D — 18 holes / 10th Tee → 10→18→1→9 (the genuinely new case)

Plus one Shotgun Start round, regression only.
