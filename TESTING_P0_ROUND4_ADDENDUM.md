# P0 Round 4 — Root Cause Found: scorecards.group_id Is Never Written
## 2026-08-27 (late)

Per your explicit instruction, here is exactly which check was still
firing and why, found by tracing — not by adding another bypass.

## The actual root cause (confirms both remaining items at once)

Every shared-device detection I wrote in Rounds 1–3 (`close/route.ts`,
`tournament/route.ts`, `scorecards/route.ts`, `pending-verifications/
route.ts`, `verify/route.ts`) resolved a player's group by reading
`scorecards.group_id` — a per-round **snapshot** column added in
migration 035 specifically so a later group reshuffle can't rewrite an
already-started round's history.

I read `begin_round()`'s actual, current, live definition directly
(migration 057 — confirmed as the true current version by migration
064's own explicit comment, "identical to 057") and found its
`INSERT INTO public.scorecards` statement only lists
`(round_id, player_id, playing_handicap, status)`. **`group_id` is
absent from both the column list and the `ON CONFLICT DO UPDATE SET`.**
It exists in migration 035's version of the function, but was silently
dropped somewhere between 035 and 057. The caller
(`start/route.ts`) still faithfully builds and sends `group_id` in
every scorecard record it passes to the RPC — the RPC just never uses
it. No error, no exception: `scorecards.group_id` is simply `NULL` on
every scorecard the current production function creates.

This is why `page.tsx`'s own shared-device detection (Round 1's fix,
proven working — Round Summary correctly shows "Shared-device scoring
complete ✓") never had this problem: it was written from the start
against a different, reliable source — the **live**
`trip_members.group_id` (never snapshotted, always current),
cross-referenced against the round's scorecards by profile membership.
Every one of *my* fixes in Rounds 2–3 used the broken snapshot column
instead, which is why they kept failing on real-device testing despite
reading correctly on the page — the detection logic itself was fine,
the data source underneath it was silently empty.

This single root cause fully explains **both** items reported:

1. **Confirm Final Scores still requiring marker entries** — the
   shared-device check in `scorecards/route.ts` (added in Round 2)
   read `scorecardRes.data.group_id`, always `NULL`, so it always fell
   through to the ordinary marker requirement, exactly as observed.
2. **Marnie's Longest Drive verification control never appearing** —
   the widened query I added to `pending-verifications/route.ts` in
   Round 3 depended on the same broken column to detect the pairing,
   so it silently never activated; Alex's claim correctly reached
   "Awaiting Playing Partner verification" (that part never depended
   on my fix), but nothing downstream of it ever recognized Marnie as
   a shared-device partner able to act on Alex's phone.

## What I changed

Created one shared resolver,
`src/lib/scoring/resolveSharedDeviceGroup.ts`, using the exact same
live-`trip_members.group_id` pattern already proven correct in
`page.tsx`, and pointed every other shared-device check at it instead
of the broken column:

- `close/route.ts`
- `tournament/route.ts` (reused its own already-fetched
  `groupIdByProfile` map instead of an extra query — it was already
  querying `trip_members` for an unrelated reason)
- `scorecards/route.ts` (the actual Confirm Final Scores endpoint)
- `side-comps/pending-verifications/route.ts`
- `side-comps/[sideCompId]/entries/[entryId]/verify/route.ts`

One detection rule, one data source, five consumers — not five
independent copies that could drift again. `page.tsx` itself was **not
touched** (already correct, per your instruction not to regress
working items).

I also made the "Confirm Final Scores" error message include the
server's debug trace directly in the visible text (not just the
browser console), since a phone-based field test often has no easy way
to open devtools — the next attempt should be diagnosable just by
reading the screen if it ever blocks again for a different reason.

## What I deliberately did NOT do

**I did not write a migration to fix `begin_round()` itself.** That
would require applying a new migration against your live Supabase
database, which this sandbox has no credentials or network access to
reach or test against. Routing every consumer around the broken column
via the already-proven-correct live source is the safer fix available
to me right now — but the underlying regression in `begin_round()`
is real and still there. It doesn't affect anything my fixes now
touch (all five consumers ignore `scorecards.group_id` entirely), but
**any other feature that reads `scorecards.group_id` expecting it to
be populated will silently get `NULL`** until that function is
corrected at the database level. Worth a dedicated pass to add a
migration restoring `group_id` to `begin_round()`'s INSERT (mirroring
exactly how migration 035 did it), verified against your actual
database, which I can't do from here.

## Items explicitly NOT touched, per your instruction

- Score persistence (Round 2's fix)
- Round Summary's "Shared-device scoring complete ✓" and green holes
  (`page.tsx`, `SelfMarkerScoreShell.tsx`'s reconciliation screen)
- Marnie's scorecard placement
- Expandable scorecards
- The scrolling fix from Round 3
- Side Game claim creation (`entries/route.ts` — untouched)
- Normal two-device marker reconciliation (`tournament/route.ts`'s
  `isMarkerMode && !isSharedDevicePlayer` branch and
  `checkScorecardCompletion`'s own logic are unchanged; only the data
  feeding `isSharedDevice`/`isSharedDevicePlayer` was corrected)

## Build/test status — same caveat as every round

**`npm run build` was not run** — still no network access in this
sandbox (`npm install` returns 403). All seven files touched this
round (`resolveSharedDeviceGroup.ts` new, plus the five routes and
`SelfMarkerScoreShell.tsx`) were syntax-checked with the TypeScript
parser directly — zero errors. **Run `npm run build` before this
ships** — this is the one step I cannot do myself here.

The 224/224 pure-function test result is unchanged — no file under
`src/lib/scoring/**/*.test.ts`'s test scope was modified;
`resolveSharedDeviceGroup.ts` is new but has no test file of its own
yet (it's a thin composition of an already-tested pure function
`detectSharedDeviceGroup` plus two straightforward Supabase reads — a
unit test would mostly be re-testing Supabase's own client, so I didn't
add one; flagging this as a gap rather than silently skipping it).

## Acceptance checklist for this round

1. **Confirm Final Scores**: on the existing test round, click it.
   Should now succeed — Round Summary already shows "Shared-device
   scoring complete ✓", so both self-scorecards should already satisfy
   the completion check. Confirm both Alex's and Marnie's scorecards
   lock together.
2. **Side Game verification**: Alex submits a Longest Drive claim →
   confirm "Marnie to verify" now actually appears on Alex's own phone
   (the `PendingVerificationCard` in the scoring shell) → tap "Marnie
   confirms this result" → confirm it becomes verified and Side
   Games/leaderboard reflect it immediately.
3. **Regression, both directions**: a claim entered on Marnie's behalf
   that resolves to Alex as verifier should still work normally
   (unchanged code path). A genuine 2-digital-players/2-devices round
   should still require real cross-device verification and real marker
   reconciliation for Close Round — nothing about this fix should ever
   trigger for a non-shared-device pair, since `resolveSharedDeviceGroup
   ForPlayer` still requires the exact same "1 digital + 1 paper, group
   of 2" shape as before.
4. **If Confirm Final Scores still fails**: the error text will now
   show the debug trace directly on screen. Please send me exactly
   what it says — that would mean there's a third cause beyond the
   `group_id` regression, and I'd want to see the actual trace rather
   than guess again.

---

# P0 Round 4b — Verification control still not visible; deeper trace added
## 2026-08-27 (later that night)

Real-device testing after Round 4 confirmed: Alex's Longest Drive
claim correctly reaches "Awaiting Playing Partner verification," but
there is still **no control anywhere on Alex's phone** for Marnie to
act on it. Round 4's fix routed the correct pairing data to
`PendingVerificationCard` — a separate, collapsed section elsewhere on
the scoring page — but that's not where this turn's report says to put
it: *"This should appear either directly in the Side Game card or as a
small expandable/drop-down verification panel immediately associated
with the claim."* `PendingVerificationCard` alone wasn't satisfying
that requirement, so I built the actual inline control this round.

## What I added (on top of Round 4's fix, not replacing it)

- `entries/route.ts` (GET) now also returns `entryId` and
  `requiredVerifierId` on `myEntry` — the claimant's own panel needs
  these to know whether its own pending claim is the one requiring the
  shared-device partner's confirmation.
- `SelfMarkerScoreShell.tsx` passes the shared-device partner's real id
  and name down to `SideCompEntryPanel` (only when genuinely in
  shared-device mode, using `currentMarked.player_id` — the same value
  Round 1's placement fix already relies on being Marnie's real id).
- `SideCompEntryPanel.tsx` — the actual card where Alex submitted the
  claim — now renders, directly under its own status line, "Verification
  required — Marnie, please confirm this result" with ✓ Confirm / ✕
  Reject buttons, exactly where the claim itself lives. Only shown when
  the claim's own `requiredVerifierId` (from the server) matches the
  partner id passed down — not just because shared-device mode is
  active in general. Calls the existing verify endpoint directly (the
  same one `PendingVerificationCard` already calls) — no new
  verification backend.

`PendingVerificationCard` and its Round 3 widening logic are
**unchanged** — both surfaces now exist and both work off the same
underlying verify endpoint and the same server-side pairing
validation; the inline one in the claim card is simply the more
discoverable, better-matching-the-brief surface for this specific
same-phone workflow.

## Also deepened the group-resolution trace (in case Confirm Final Scores is still blocked)

`resolveSharedDeviceGroupForPlayer` now returns every intermediate
value (`myGroupId`, `groupProfileIds`, `relevantCards`) alongside the
final yes/no, not just the answer, and `scorecards/route.ts`'s own
trace/debug payload includes all of it. This flows through the
existing debug-suffix mechanism already wired into the visible error
text (Round 4's own addition, confirmed still in place), so if it's
still somehow blocked, the exact failing step (group not found? wrong
`scoring_method` stored? a third profile sharing the group?) should be
visible on-screen without needing devtools.

## Syntax/test status

All five files touched this pass — `SideCompEntryPanel.tsx`,
`entries/route.ts`, `SelfMarkerScoreShell.tsx`,
`resolveSharedDeviceGroup.ts`, `scorecards/route.ts` — syntax-checked
with zero errors. 224/224 pure-function tests in `src/lib/scoring/**`
still pass unchanged. `npm run build` still not run — no network
access in this sandbox.

## Acceptance for this pass specifically

1. Alex submits a Longest Drive claim → confirm the "Verification
   required — Marnie, please confirm this result" panel now appears
   **directly in the Side Game card itself**, not just in a separate
   section elsewhere → tap Confirm → confirm it verifies immediately
   and Side Games reflects Alex as leader.
2. Confirm the separate `PendingVerificationCard` section still also
   shows/works for this same claim (both surfaces should agree — they
   share the same backend).
3. Regression: Marnie's claim (entered on her behalf) → Alex verifies
   — should be entirely unaffected, still using the normal
   `PendingVerificationCard` path.

