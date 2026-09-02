# TEEIN' IT UP — LIVE SCORING STABILISATION & UX BRIEF
## Delivery Report — 1 Sep 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 4 files
touched syntax-check with **zero errors**. Full test suite: **380/380
pass** (259 scoring + 59 highlights + 8 analytics + 54 trips).

**Per your explicit instruction, I did not redesign or broadly
refactor shared-device detection, Digital→Paper authorisation, normal
Digital↔Digital marker flow, Stableford/leaderboard calculations,
reconciliation, or the My HQ fallback. Every change below is additive
or a narrow extraction of already-working logic.**

---

## Investigation first — several items were already fixed

Before changing anything, I audited each P1/P2 item against the
current codebase, since parts of this stabilisation package overlap
with work from earlier in this same engagement. Two items were already
correctly implemented and needed no further work:

- **Starting Grid showing the wrong hole** — already fixed. Confirmed
  it reads `startingHoleNumber` from the same authoritative
  `rounds.starting_hole_number` column live scoring uses (via the
  `/starting-holes` endpoint), not a hardcoded literal.
- **Playing Partner refresh (polling + manual button)** — already
  fixed. Confirmed 7-second polling scoped only to the waiting screen
  (within your 5–10s target), plus a manual "↻ Refresh Playing
  Partners" button with a "Refreshing…" label and a duplicate-tap
  guard, refetching in place with no navigation or state reset.

Reporting this explicitly rather than silently re-doing already-
correct work, or worse, claiming credit for it as new.

---

## FIXED BUGS

### P1 — Protect the paper-player polling fix (regression coverage + hardening)

The previous round's fix to `/my-scores/route.ts` was correct but
existed only as inline logic in one route — genuinely working, but not
independently testable, and with no guard against a future change
accidentally reintroducing the same two-independent-implementations
problem that caused the original P0. Extracted the exact resolution
decision (shared-device takes priority, `round_markers` only consulted
otherwise) into a new pure function, `resolveMarkedPlayerId()`, in
`sharedDeviceScoring.ts` — the same file `detectSharedDeviceGroup`
already lives in. `/my-scores/route.ts` now calls this function instead
of containing the decision inline. **Deliberately left `page.tsx`'s own
resolution untouched** — it's the confirmed-working reference
implementation; refactoring a proven-correct file for symmetry alone
would have been exactly the kind of unnecessary risk this brief asked
me to avoid.

### P1 — "Change who I'm marking" appearing for shared-device pairs

Found and fixed a second, related bug while re-verifying the previous
round's Digital→Paper / Digital↔Digital separation: the button was
gated only by `requiresMarker` (a round-level flag), which can't
distinguish a genuine marker relationship from a shared-device one
when both exist in the same round. Fixed to
`requiresMarker && !isSharedDeviceScoring` — this button can no longer
appear for a shared-device pair under any circumstance.

---

## UX IMPROVEMENTS

### P2 — Paper Player explanatory copy

Updated the pre-round copy in `BeginRoundModal.tsx` to reflect the
now-working model, but **only for the group shape shared-device
scoring actually applies to** (exactly 2 players, 1 digital + 1
paper) — computed the same way `detectSharedDeviceGroup` requires, not
assumed. For that specific case: *"Paper player doesn't need a phone —
their playing partner enters their scores during the round."* Groups
with 3+ players or multiple paper players still show the original
"check/sign their physical card" copy, since shared-device auto-
scoring genuinely doesn't apply there and the old copy remains
accurate for that case — not blanket-replaced.

Checked `PaperScorecardStatus.tsx` (the paper player's own status
screen) too — already correctly differentiated from earlier work,
showing "[Name] is scoring for you" when shared-device applies. No
change needed there.

---

## REGRESSION TESTS ADDED

8 new tests in `sharedDeviceScoring.test.ts`, covering exactly the 5
scenarios your brief specified plus 3 additional edge cases found
while writing them:

1. Shared-device Paper Player is returned on initial resolution.
2. Repeated calls with identical input retain the same result —
   directly modeling the exact P0 regression (three consecutive
   simulated polls, all must agree).
3. Normal Digital↔Digital marker resolution still works, unaffected
   by shared-device logic existing in the same function.
4. A shared-device relationship is never replaced by an unrelated
   `round_markers` row naming the same player.
5. Unrelated players cannot become shared-device partners — a marker
   row for a completely different pair has zero effect.
6. `individual` capture mode still resolves a shared-device pairing
   (closing the same gap the previous round's Card 2 fix addressed,
   now covered at the resolution-logic level too).
7. `individual` mode with no shared-device pairing resolves nothing —
   confirms no accidental `round_markers` fallback in that mode.
8. The paper half of a shared-device pair has no marker relationship
   of their own (matches `page.tsx`'s own documented behaviour: "Alex
   has no one marking HIM").

Ran in isolation (20/20 pass) and as part of the full suite.

---

## FILES CHANGED

- `src/lib/scoring/sharedDeviceScoring.ts` — new `resolveMarkedPlayerId()`
- `src/lib/scoring/sharedDeviceScoring.test.ts` — 8 new tests
- `src/app/api/trips/[tripId]/rounds/[roundId]/my-scores/route.ts` —
  refactored to call the extracted function instead of inline logic
- `src/components/scoring/BeginRoundModal.tsx` — shared-device-aware
  paper player copy

## MIGRATIONS REQUIRED: None.

## FULL TEST RESULT

**380/380 pass** — 259 scoring (251 + 8 new) + 59 highlights + 8
analytics + 54 trips. Confirmed via direct, isolated syntax checks on
every touched file and a full suite run across every test directory.

---

## ITEMS ALREADY VERIFIED CORRECT BY CODE TRACE, NOT MODIFIED

Per "make the smallest changes necessary," these were checked and
confirmed already correct rather than touched:

- **Hole navigation / back-nine validation** — round completion is
  based on `selfHoleCount < totalHoles` (a count comparison), never a
  specific hole number. Next-hole boundary logic uses
  `holeIdx === holes.length - 1` (array position within the already-
  play-ordered `holes` array), not `hole_number === 18`. Both already
  correctly hole-agnostic.
- **Scorecard identity** — `partnerSelf`/`partnerMarker`/`mySelf`/
  `myMarker` are all keyed by `hole_number` throughout the hydration
  path (re-confirmed from the prior session's exhaustive trace), so
  identity can't leak between players or rounds through this path.

---

## WHAT STILL REQUIRES REAL-DEVICE VERIFICATION

Everything in your **Event-Day Acceptance Matrix (A–F)** — this
sandbox cannot run a live app against a live database, cannot wait out
a real polling interval, and cannot simulate a second device joining
mid-flow. Specifically:

- **D and E** (auto-refresh and manual refresh surfacing a newly-
  joined digital partner) — the mechanism is confirmed correctly
  implemented by code trace, but has not been exercised against a
  real second device joining mid-wait.
- **The full Digital+Paper acceptance sequence** (start → wait 15s →
  both remain → score both → Next Hole → wait → Previous Hole → verify
  → browser refresh → both restore → continue) — this is the direct
  test of both this round's regression tests and the previous round's
  root-cause fix, and needs to be run for real before this is called
  closed.
- **F, shotgun/non-standard starting hole** — architecturally confirmed
  to share the same hole-sequence and hydration code as standard
  rounds (same `holes/route.ts`, same `SelfMarkerScoreShell.tsx`), but
  not separately exercised this round.
