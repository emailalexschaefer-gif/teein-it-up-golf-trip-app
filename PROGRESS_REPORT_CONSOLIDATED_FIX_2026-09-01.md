# TEEIN' IT UP — CONSOLIDATED TEST + FIX BRIEF
## Progress Report — 1 Sep 2026

**Honest framing up front:** this brief covers 7 major investigation
areas plus a full end-to-end acceptance matrix. Given the depth each
one genuinely requires — several explicitly demand "investigate first,
do not fix speculatively" — I focused this round on fully root-causing
and fixing two confirmed, high-confidence bugs (items 4 and 6) rather
than spreading shallow effort across all seven. Items 1, 2, 3, 5, and 7
were **not reached this round** and remain outstanding — flagged
clearly below, not silently skipped.

**Build/test caveat, unchanged from every prior round:** no network
access — `npm run build` was not run, and there is no live Postgres
connection to execute the new migration. Both TypeScript files
touched syntax-check with **zero errors**. The migration was verified
by direct diff against the real, current `begin_round()` body (not
reconstructed from memory) — it has never executed. Full test suite:
**326/326 pass** (259 scoring + 59 highlights + 8 analytics).

---

## P0 PROTECTION — confirmed, not touched

Re-read the shared-device chain (`detectSharedDeviceGroup`,
`resolveMarkedPlayerId`, `/my-scores/route.ts`, `page.tsx`) before
touching anything else this round, specifically to confirm neither fix
below goes anywhere near it. Neither does. `resolveMarkedPlayerId` and
its 8 regression tests are unchanged.

---

## FIXED — ITEM 4: GROUP MAKERS & BREAKERS MISSING

**Investigated first, per the explicit instruction — the logic already
existed.** All 12 group-scope archetypes (Hot Group, Back Nine
Bandits, The Closers, The Fortress, The Birdcage, Dream Team, Wheels
Off, Damage Report, Deep Freeze, Still in the Car Park, Back Nine
Breakdown, Black Hole Group) are fully implemented in
`makersBreakers.ts`, already included in the main
`generateMakersAndBreakers()` array alongside individual-scope finders,
and already have dedicated passing tests. **No new archetype logic was
built.**

**Actual root cause:** `scorecards.group_id` has never actually been
written by `begin_round()` — confirmed by reading the exact, current
INSERT column list in migration 069 (`round_id, player_id,
playing_handicap, status, scoring_method` — no `group_id`), and tracing
back that this has been true since the column's introduction (064).
Every scorecard's `group_id` has been silently `NULL` on every round,
despite `start/route.ts` already correctly building its
`scorecardData` with a `group_id` field for every player the entire
time — the RPC simply never persisted it.

`makersBreakers.ts`'s own `PlayerRoundData` interface documents
`groupId` as a deliberate round-specific snapshot of
`scorecards.group_id` ("the SAME snapshot mechanism multiRound.ts
already relies on"). `bucketByGroup()` requires every player to have a
truthy `groupId` to be included in any group calculation — with the
column always `NULL`, every group-scope finder always received zero
eligible groups, while every individual-scope finder (needing no group
data) worked correctly the whole time. This matches the confirmed
real-device symptom exactly: Individual Makers/Breakers present, Group
Makers/Breakers always empty. Not a threshold, not a minimum-group-
count gate, not a Paper-player exclusion — the data was simply never
persisted.

**Important correction I caught mid-fix:** my first draft switched
`highlights/route.ts` to resolve `groupId` from live
`trip_members.group_id` instead — before finalizing, I read the
interface's own comment explaining `groupId` is *deliberately* meant
to be the round-specific snapshot, not the live/mutable value (to
correctly preserve a player's group history if they're reassigned
after a round starts). Reverted that and fixed the actual root cause
instead — `begin_round()` not writing the column at all — rather than
routing around it and quietly contradicting an existing, documented
architectural decision.

**Also fixes a second, related symptom** discovered while tracing
this: the highlights route's per-group shotgun starting-hole lookup
(keyed by `group_id`) was silently falling through to the round-level
default for every group, for the identical reason.

**Fix:**
- `supabase/migrations/070_begin_round_writes_group_id.sql` (new) —
  `begin_round()` now writes `group_id` on both insert and update.
  Verified via direct diff against 069's real body: only the intended
  lines changed.
- No change needed to `start/route.ts` — its `scorecardData` already
  included `group_id`.
- `highlights/route.ts` — comments updated to document the fix and why
  the live-data approach was considered and rejected; the actual data
  read (`sc.group_id`) is unchanged, since it was already correctly
  written, just never correctly *populated*.

**Explicitly not changed:** `scorecards.group_id`'s snapshot semantics
— once written at `begin_round()` time, still never mutated afterward.

---

## FIXED — ITEM 6: TEE TIME NOT CARRYING INTO FINALIZE ROUND

**Root cause, confirmed by reading both screens' actual data sources:**
Group Setup (`TripGroupsTab.tsx`) writes tee times to
`trip_groups.tee_time` — confirmed directly. `BeginRoundModal.tsx`
("Finalize Round") only ever read `round_group_tee_times` (a separate,
round-scoped override table), with an explicit prior comment stating
this was deliberate ("Nothing here reads or writes
trip_groups.tee_time"). This meant a tee time set the normal way, in
Group Setup, could never appear in Finalize Round at all — only an
explicit round-specific override would show. Also found a related
inconsistency: the readiness-check gate (`allGroupsHaveTeeTimes`)
checked the *opposite* source (`trip_groups.tee_time` only), meaning
the checklist could show "done" while the actual editable field showed
blank.

**This is the identical bug class already fixed once before this
session**, in `StartingGrid.tsx`, for the exact same two-tables
situation (there, `starting_hole_number`/starting-tee). Applied the
same established fallback hierarchy here for consistency: a round-
specific override wins when explicitly set; otherwise fall back to the
group's own baseline value from `trip_groups`. Not "inheriting from a
prior round" — `trip_groups.tee_time` is the same trip-level field
regardless of which round is open, not a round-specific snapshot.

**Fix (`BeginRoundModal.tsx`, four locations, all now consistent):**
1. The editable tee-time input's displayed value.
2. The dirty-check comparison (whether to show the Save button).
3. The "First Tee" summary display.
4. The `allGroupsHaveTeeTimes` readiness gate, corrected to check the
   same fallback hierarchy as the display, not a different one.

---

## NOT REACHED THIS ROUND

**Item 1 — Side Game verification, intermittent multi-group
failure.** Requires reproducing or concretely tracing a specific
failure across verifier resolution, round_markers interactions, and
Round 1/Round 2 state — genuinely deep work the brief itself says not
to guess at. Not started.

**Item 2 — Side Game competitor identity trace.** Requires following
persisted IDs through submission → verification → leader calculation →
Moments — not started.

**Item 3 — Side Game Moment consistency (NTP vs Longest Drive).**
Requires comparing two claim pipelines end to end — not started.

**Item 5 — Event Winner in My Event Stories.** A real feature addition
(new authoritative-winner-only display logic) — not started.

**Item 7 — Presentation/UI polish pass.** Not started.

**The full end-to-end acceptance matrix** was not run — this sandbox
cannot run a live app regardless, but even the code-level review
portions covering items 1/2/3/5 haven't happened yet since those items
themselves haven't been investigated.

---

## FILES CHANGED

- `supabase/migrations/070_begin_round_writes_group_id.sql` (new)
- `src/app/api/trips/[tripId]/rounds/[roundId]/highlights/route.ts`
  (comments/documentation; the actual fix lives in the migration)
- `src/components/scoring/BeginRoundModal.tsx` (tee-time fallback, 4
  locations)

## MIGRATIONS REQUIRED: Yes — `070_begin_round_writes_group_id.sql`

**Not yet run against a live database.**

## REGRESSION TESTS ADDED THIS ROUND: none new

The existing `makersBreakers.test.ts` suite already has dedicated
passing tests for every group-scope archetype given a correctly-
populated `groupId` — these already serve as the regression coverage
proving the fix works, once `group_id` is genuinely persisted; the bug
was never in the archetype logic itself, only in the data reaching it.
No new pure-function test was warranted for the tee-time fix (UI
display-condition logic, not new business logic).

## FULL TEST SUITE RESULT

**326/326 pass** (259 scoring + 59 highlights + 8 analytics).

---

## WHAT CANNOT BE PROVEN IN THIS SANDBOX

1. **Migration 070 has never executed.** Run it, then start a fresh
   round with 2+ groups and confirm `scorecards.group_id` is actually
   populated (a simple `SELECT player_id, group_id FROM scorecards
   WHERE round_id = ...` after Start Scoring is enough to confirm this
   specific fix before running a full round).
2. Complete that round with deliberately different scoring profiles
   per group (per the brief's own item 4 test), confirm Group Makers/
   Group Breakers now actually appear.
3. Confirm the tee-time fix across the brief's own 3-group test
   (8:00/8:10/8:20), including a browser refresh.
4. Items 1, 2, 3, 5, 7 and the full acceptance matrix remain entirely
   unverified — both because they weren't reached this round and
   because they'd need a real device regardless.

## SHORT REAL-DEVICE CHECKLIST FOR THIS ROUND'S TWO FIXES

- [ ] Run migration 070.
- [ ] New round, 2 groups, different scoring profiles per group,
      complete it, confirm Group Makers/Breakers appear alongside
      Individual.
- [ ] Set 3 different group tee times in Group Setup, open Finalize
      Round, confirm all 3 show correctly without a manual round-
      specific override ever being set.
- [ ] Refresh the browser on Finalize Round, confirm tee times persist.
- [ ] Confirm a shotgun round's per-group starting holes now display
      correctly in Makers & Breakers too (the second symptom item 4's
      fix also closes).

I'd recommend treating this as a checkpoint, not a completed brief —
happy to continue with items 1/2/3/5/7 in a focused follow-up rather
than attempt all of them thinly in what's left of this one.
