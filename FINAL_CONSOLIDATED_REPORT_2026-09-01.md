# TEEIN' IT UP — CONSOLIDATED TEST + FIX BRIEF
## ONE Consolidated Final Report — 1 Sep 2026

All five remaining items from the checkpoint are now complete. This
report covers the full brief (all 7 original areas — items 4 and 6
from the checkpoint, plus items 1, 2, 3, and 5 completed this round).

**Build/test caveat, unchanged from every prior round:** no network
access — `npm run build` was not run, and there is no live Postgres
connection to execute either new migration. All files touched
syntax-check with **zero errors**. Full test suite: **380/380 pass**
(259 scoring + 59 highlights + 8 analytics + 54 trips).

**Per the explicit instruction, no intermediate package was built this
round** — this is the one, final, consolidated candidate.

---

## 1. ROOT CAUSE FOR EACH ITEM

**Item 4 (checkpoint) — Group Makers & Breakers missing.**
`scorecards.group_id` was never actually written by `begin_round()` —
confirmed by reading its exact INSERT column list, present since the
column's introduction. Every group-scope archetype finder always
received zero eligible groups; individual-scope finders (needing no
group data) always worked. Not a threshold, not a Paper-player
exclusion.

**Item 6 (checkpoint) — Tee time not carrying into Finalize Round.**
Group Setup writes tee times to `trip_groups.tee_time`; Finalize Round
only ever read the separate `round_group_tee_times` override table,
by a documented prior deliberate choice that turned out to be the bug
— no fallback existed to the group's own baseline value.

**Item 1 — Side Game multi-group verification stranding.**
`resolve_side_comp_verifier()`'s final fallback tier selected "any
other scorecard in the *entire round*" (not the claimant's own group)
whenever no `round_markers` row existed and the organiser was the
claimant or absent. A Paper player never has a `round_markers` row at
all (shared-device pairing deliberately never writes one), so every
Paper claim under those conditions hit this exact path — in a
multi-group round, resolving to an unrelated player in a different
group who had no reason to ever see or resolve it. This function was
never redeclared since its original definition (047) — confirmed via
search across every later migration.

**Item 2 — "Darren Lappen · pending verification" for a Razzle Dazzle
claim.** Confirmed a **display bug, not a data/identity bug** (one of
the three options your brief asked me to distinguish). The celebratory
"would lead if verified" prompt used the authenticated device
operator's own name (`myName`) instead of the actual competitor's
name. Every other consumer of this same submission (the entries GET,
the leaderboard, pending-verifications) already correctly used
`player_id`/competitor identity throughout — confirmed by direct
inspection of each. The persisted claim was always correctly attributed
to the real competitor, which is exactly why the eventual official
result was correct.

**Item 3 — Longest Drive producing a generic photo + separate
Announcement instead of one combined Moment.** Not comp-type-specific
in the code itself. `MomentCapture`'s `entryId` prop only ever read
`lastResult?.entryId`, a value set exclusively by a fresh submission
happening in the current render session. The component's own
"restore an existing claim from a prior visit" path sets a *different*
state variable (`myEntryId`) and never touches `lastResult` — so a
photo captured on a second visit to an already-claimed comp uploaded
with no `side_comp_entries` link at all, producing the generic,
unlinked Moment. This explains the NTP/Longest Drive divergence by
which comp happened to involve a page revisit during the actual test,
not by which comp type it was.

**Item 5 — Presentation polish.** One concrete, low-risk terminology
inconsistency found: "Side Competition Winners" on the Final Results
screen, while every other player-facing surface (bottom nav, Home
card, My Golf, Event Stories) consistently says "Side Game(s)."

---

## 2. EXISTING LOGIC DISCOVERED AND PRESERVED

- All 12 group-scope Makers & Breakers archetypes and their dedicated
  passing tests already existed — no new archetype logic was built.
- The Digital↔Paper shared-device verification *model* itself
  (claim → pending → verify → official) was not redesigned anywhere —
  every fix operates on resolution/linking around that model, never
  replacing it.
- `resolve_side_comp_verifier`'s `round_markers` and organiser-fallback
  tiers are completely unchanged — only the shared-device check
  (new, inserted between them) and the final cross-group fallback
  (now group-scoped) changed.
- `computeCumulativeStandings`/`determineChampions` — the exact
  authoritative functions `final-results/route.ts` already used —
  were reused directly for Event Winner, not reimplemented.
- The already-fixed P0 shared-device scoring, `/my-scores` polling fix,
  and `resolveMarkedPlayerId` were re-confirmed untouched at the start
  of this round and remain untouched now.

---

## 3. ACTUAL FIXES MADE

- `begin_round()` now writes `group_id` (migration 070).
- `BeginRoundModal.tsx`'s tee-time display, dirty-check, summary, and
  readiness gate all now fall back to `trip_groups.tee_time` when no
  round-specific override exists.
- `resolve_side_comp_verifier()` now checks for a shared-device partner
  before the organiser/cross-group fallbacks, and its final fallback is
  scoped to the claimant's own playing group (migration 071).
- `SideCompSubmitResult` now carries the actual competitor's id/name;
  the celebratory prompt uses it instead of the device operator's name.
- `MomentCapture`'s linked `entryId` now falls back to the restored
  `myEntryId` when a fresh submission hasn't just happened.
- `/api/me/event-stories` now computes authoritative Event Winner
  status per trip; `MyEventStoriesSection.tsx` displays it first, in
  the correct 🏆 → 🎯 → 🥇 order, earned-only.
- "Side Competition Winners" → "Side Game Winners" on Final Results.

---

## 4. FILES CHANGED (this round, items 1–5 + regression-test hardening)

- `supabase/migrations/071_fix_side_comp_verifier_group_scoping.sql` (new)
- `src/components/scoring/SideCompEntryPanel.tsx`
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`
- `src/app/api/me/event-stories/route.ts`
- `src/components/scoring/MyEventStoriesSection.tsx`
- `src/components/results/FinalEventResults.tsx`
- `src/lib/scoring/sharedDeviceScoring.ts` (new `resolveSideCompVerifierCandidate`)
- `src/lib/scoring/sharedDeviceScoring.test.ts` (+7 tests)
- `src/lib/scoring/sideCompIdentity.ts` (new)
- `src/lib/scoring/sideCompIdentity.test.ts` (new, 8 tests)
- `src/lib/scoring/beginRoundMigration.test.ts` (new, 2 tests)
- `src/lib/scoring/verifierScopingMigration.test.ts` (new, 3 tests)

**From the checkpoint (items 4/6), already delivered, listed for
completeness:**
- `supabase/migrations/070_begin_round_writes_group_id.sql`
- `src/app/api/trips/[tripId]/rounds/[roundId]/highlights/route.ts`
- `src/components/scoring/BeginRoundModal.tsx`

---

## 5. MIGRATIONS REQUIRED

**Two, in this order:**
1. `070_begin_round_writes_group_id.sql`
2. `071_fix_side_comp_verifier_group_scoping.sql`

(071 does not depend on 070's data — both were verified independently
by direct diff against their real predecessor functions — but running
070 first matches the order these bugs were found and keeps the
deployment story simple: both are needed before the next real-device
test regardless of order between themselves.)

**Neither has ever executed against a live database.**

---

## 6. FOCUSED TESTS ADDED

**Regression-test hardening pass (post-approval), 20 new tests added
across 4 files — full test count now 400 (was 380):**

- **Item 1 (highest priority) — `resolveSideCompVerifierCandidate`**
  (new pure function, `sharedDeviceScoring.ts`) + 7 tests, including
  the exact reported scenario: a Group A Paper claimant must resolve
  within Group A and never to Group B; the reverse Digital→Paper
  direction; a genuine `round_markers` relationship still takes
  priority when one exists; Round 2 must not resolve using Round 1
  relationships (a caller-scoping contract test — this function has no
  concept of "round" at all, every input is already scoped by the
  caller). This is a pure-TypeScript specification of migration 071's
  SQL decision tree, not a live-database test — genuinely testable,
  and explicitly documented as such in its own header, not disguised
  as more than it is.
- **Item 1, second angle — `verifierScopingMigration.test.ts`** (new,
  2 files' worth, 3 tests) — reads the actual deployed SQL text of the
  latest `resolve_side_comp_verifier()` migration directly (same
  established pattern this project already uses in
  `eventTypeConstraint.test.ts`) and asserts the shared-device check
  exists and runs before the organiser fallback, and that the final
  "any other scorecard" fallback genuinely joins `trip_members` and
  filters by the claimant's own group — not just that group-related
  text appears somewhere in the file. **Caught and fixed a real bug in
  my own first draft of these tests**: an ordering assertion searched
  for the bare variable name `v_shared_device_partner`, which
  false-matched its own `DECLARE` statement (always textually first in
  a plpgsql function, regardless of real execution order) rather than
  its actual use in the `IF v_shared_device_partner IS NOT NULL` logic
  — caught via a genuine test failure on first run, not assumed
  correct, then fixed to search for the actual usage pattern instead.
- **Item 2 — `resolveCompetitorDisplayName`** (new pure function,
  extracted from the exact inline expression that had the bug,
  `sideCompIdentity.ts`) + 4 tests, including the exact reported
  scenario (Digital A submitting for Paper A resolves to "Paper A,"
  never "Digital A").
- **Item 3 — `resolveSideCompMomentEntryId`** (new pure function, same
  file) + 4 tests, including the exact reported scenario (a restored
  existing claim's entryId is used when no fresh submission exists in
  the current session — previously silently dropped).
- **Item 4 — `beginRoundMigration.test.ts`** (new) + 2 tests — same
  SQL-scanning pattern, confirms `group_id` genuinely appears in both
  the scorecards INSERT column list and the ON CONFLICT UPDATE clause
  specifically (not just anywhere in the file — the unrelated
  invariant-check section legitimately references `group_id` via
  `trip_members` for a different purpose, which would have produced a
  false pass if this test weren't scoped to the actual upsert block).

**Both extracted competitor-identity/moment-linkage functions are now
the actual call sites** in `SideCompEntryPanel.tsx` — not disconnected
mirrors sitting unused alongside the real inline logic.

None of these tests can prove the live database behaves correctly, or
that either migration has actually been applied to production — only
that the intended algorithm is unambiguously specified and tested, and
that the deployed SQL text contains the corresponding fix in a form a
future accidental revert would be caught by.

---

## 7. FULL TEST SUITE RESULT

**400/400 pass** — 279 scoring (274 pure-function + 5 SQL-scanning,
including the 20 tests added in this hardening pass) + 59 highlights +
8 analytics + 54 trips. Confirmed via a fresh, complete run this round
covering every test directory and every new file individually.

---

## 8. WHAT STILL REQUIRES REAL-DEVICE VERIFICATION

Nothing in this report has been claimed as device-verified. Specific
items:

1. **Both migrations must actually run** before any of this round's
   fixes have any live effect.
2. **Group Makers & Breakers and shared-device verifier scoping both
   require a FRESH round started after migration** — `group_id` is a
   snapshot taken at `begin_round()` time; an already-started round's
   scorecards will not retroactively gain a populated `group_id`.
   Confirmed no backfill was implemented — deliberately, matching your
   own explicit instruction not to introduce one.
3. The two-group Side Game verification scenario that originally
   stranded a claim needs to be re-run against 071 specifically.
4. The competitor-identity and Moment-linking fixes need visual
   confirmation on a real claim-then-photo flow, including the
   specific "navigate away and come back before taking the photo"
   sequence that item 3's fix targets.
5. Event Winner needs confirmation against a real completed multi-round
   event with a known, unambiguous winner (and ideally one genuine tie,
   to confirm joint-winner handling renders correctly, not just
   computes correctly).

---

## 9. EXACT PRODUCTION DEPLOYMENT ORDER

1. Deploy this application code build.
2. Run migration `070_begin_round_writes_group_id.sql`.
3. Run migration `071_fix_side_comp_verifier_group_scoping.sql`.
4. Start a **fresh round** for any acceptance testing — do not judge
   items 1 or 4's fixes against any round already in progress or
   already completed before step 2.

---

## 10. FINAL ACCEPTANCE CHECKLIST — 6 PLAYERS / 3 GROUPS / MULTI-ROUND

**Pre-round**
- [ ] Players assigned correctly, Paper/Digital status correct
- [ ] Group names unique
- [ ] Tee times set in Group Setup appear correctly in Finalize Round
      without a manual round-specific override (item 6's fix)
- [ ] Starting holes correct, Finalize/Release works

**Start scoring**
- [ ] All 3 groups' Digital players see their own + Paper partner's
      card immediately, no Paper login, survives a 15+ second wait

**Scoring**
- [ ] Own + Paper score entry, hole navigation, refresh, both a Hole 1
      and a Hole 10 start group

**Side Games**
- [ ] Digital claim, Paper claim on shared device, all four
      verification directions
- [ ] **Cross-group leader replacement — the specific scenario that
      originally failed** — confirm no stranded claim in either group
- [ ] Correct competitor identity shown throughout (item 2's fix)
- [ ] Photo + verified leader produces ONE combined Moment, including
      a claim-then-navigate-away-then-photo sequence (item 3's fix)

**Round Complete**
- [ ] Every scorecard completes, Paper scores count, leaderboard
      correct
- [ ] **Individual AND Group Makers/Breakers both appear** (item 4's
      fix — only valid on a round started after migration 070)

**Post-round / My Event Stories**
- [ ] Presentation renders cleanly, no duplicate Side Game stories
- [ ] **Event Winner appears first, correctly, only when earned**
      (item 5/checkpoint item 4's fix), followed by Side Game Wins,
      then Badges, in that order

**Multi-round**
- [ ] Repeat the Side Game verification scenario in Round 2
      specifically — confirm no Round 1 verifier/group/claim state
      leaks into Round 2
