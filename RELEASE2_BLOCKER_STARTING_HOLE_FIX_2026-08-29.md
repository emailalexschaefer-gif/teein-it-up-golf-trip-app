# RELEASE 2 BLOCKER — Starting-Hole Launch Bug
## Fix Report — 2026-08-29, 10:19pm test follow-up

**Status: root cause found and fixed. Not yet re-verified on a real
device — please re-test this exact scenario before considering it
closed.**

Playing-partner auto-pairing (PASS) was unaffected — nothing in this
fix touches that area.

---

## Root cause

Traced exactly as requested: round/group setup → persisted
starting-hole field → scoring API/load → initial active hole.

The **persisted field itself was never actually reaching the
database**, on either the create-trip or edit-trip path. Three
separate, independent gaps, found by tracing the payload forward from
the UI control step by step rather than guessing:

1. **`src/app/(app)/trips/new/page.tsx`** (the wizard's own submit
   handler, used by both "Create trip" and "Edit trip" — confirmed
   it's the same file for both) hand-picks specific fields to send in
   both the create-trip and edit-trip request bodies. `starting_hole_number`
   was missing from **both** — so no matter what an organiser selected
   in `StepRounds.tsx`'s Starting Tee control, the value never left the
   browser.

2. **`src/app/api/trips/route.ts`** (trip creation) has a Zod
   validation schema (`RoundSchema`) gating the request body.
   `starting_hole_number` was completely absent from that schema —
   Zod's default behaviour for `z.object()` is to silently **strip**
   any key not declared in the schema, not reject the request. This is
   why creating a trip never errored: the round was created
   successfully, just always with the implicit default of 1, with no
   visible failure anywhere.

3. **`src/app/api/trips/route.ts`**'s own insert-row construction
   (separately from the schema) also never referenced the field, so
   even after fixing the schema, the actual `.insert()` call would
   still have dropped it.

The **edit-trip PATCH route** (`src/app/api/trips/[tripId]/route.ts`)
was already correct from the original Starting Tee work — it has no
Zod schema (uses a raw TypeScript type assertion) and already read/
wrote `starting_hole_number` properly. The bug was entirely upstream of
it: the wizard never sent the field in the first place, on **either**
path.

The scoring-load side (`holes/route.ts`'s play-order reordering,
`SelfMarkerScoreShell.tsx`'s hole-index seeding and resume logic) was
already correct and needed no changes — it was just being fed a round
whose `starting_hole_number` had never actually been persisted as
anything but 1, so reordering "correctly" produced standard ascending
order every time, indistinguishable from the bug without tracing all
the way back to the payload construction.

## Fix

- `trips/new/page.tsx` — added `starting_hole_number: r.starting_hole_number ?? 1`
  to both round-payload constructions (create and edit).
- `api/trips/route.ts` — added `starting_hole_number: z.union([z.literal(1), z.literal(10)]).default(1)`
  to `RoundSchema`, and added the field to the insert-row construction.
- No changes needed to `api/trips/[tripId]/route.ts` (PATCH/edit),
  `holes/route.ts`, or `SelfMarkerScoreShell.tsx` — all three were
  already correct.

Checked for the same class of gap elsewhere: the only other Zod schema
touching round-shaped data (`start/route.ts`'s `StartSchema`) validates
the actual per-hole submission payload for beginning a round, not round
configuration — unrelated, no fix needed there.

## Resume behaviour — traced, found already correct

The resume logic (`SelfMarkerScoreShell.tsx`, the effect that scans for
the first not-yet-scored hole) walks the `holes` array by **position**,
not by `hole_number` — it was never assuming hole 1 is the start. Once
fed a correctly-ordered array (which requires the fix above), this
logic should already satisfy both halves of the requirement without
changes:

- Brand-new scorecard: every hole is unscored, so the scan breaks
  immediately at index 0 — the first element of the correctly-ordered
  array, i.e. the actual assigned starting hole.
- Mid-round reopen: the scan finds the first index with missing data,
  wherever that is in the play sequence — never resets to the
  starting hole if scoring has already progressed past it.

## Build/test status

No network access in this sandbox — `npm run build` not run. Both
edited files syntax-checked with the TypeScript compiler — zero
errors. Full pure-function suite re-run — **310/310 pass**, unchanged
(this fix touches only payload construction and a validation schema,
no business logic).

## What I could not do

Verify this on a real device or against a live Supabase instance —
this sandbox has neither. Everything above is a code-level trace: I
followed the actual value from the UI control through every hop to the
database and found where it was being dropped, rather than guessing at
the scoring-load side (which I'd already built and tested correctly in
the previous round).

## Acceptance checklist — please re-test before closing this blocker

- [ ] Hole 1 assignment → opens Hole 1
- [ ] Hole 10 assignment → opens Hole 10 (the actual reported failure —
      create a **fresh** round for this test; an already-created round
      from before this fix will still have `starting_hole_number = 1`
      persisted from the original bug and needs to be recreated, not
      just reopened)
- [ ] 18-hole/10th-tee sequence: 10 → … → 18 → 1 → … → 9
- [ ] Reopen mid-round → resumes at the correct in-progress hole, not
      reset to the starting hole
- [ ] Playing-partner auto-pairing still passes (regression check —
      nothing in this fix should have touched it, but worth confirming
      alongside)

This remains a Release 2 blocker until the above is confirmed — not
packaging until then, per your instruction.
