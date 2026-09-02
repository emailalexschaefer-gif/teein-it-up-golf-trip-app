# TEEIN' IT UP — LIVE SCORING STABILISATION & UX BRIEF
## Final Report — 1 Sep 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All files
touched syntax-check with **zero errors**. Full test suite: **380/380
pass** (259 scoring + 59 highlights + 8 analytics + 54 trips).

**Context on this report:** substantial work against this exact brief
had already been completed earlier in this session (Starting Grid,
playing-partner auto-refresh + manual refresh button, paper-player
copy, and a new tested `resolveMarkedPlayerId` shared function). I
verified each of those directly against the actual current code rather
than assuming they were correct — this report distinguishes what was
already done from what I did this round.

---

## FIXED BUGS

**P1 — Starting Grid hardcoded Hole 1.** Already fixed (verified, not
assumed): `StartingGrid.tsx` now reads `startingHoleNumber` — already
correctly fetched from the same `/starting-holes` endpoint live scoring
itself uses — instead of a hardcoded literal. No second inference path.

**P1 — Digital playing partner availability/refresh.** Already fixed
and verified correct: the candidate list is now a proper `useQuery`
with `refetchInterval: 7000` (within the 5–10s target), scoped via
`enabled` to only run while genuinely on that screen — not
application-wide polling. A manual "↻ Refresh Playing Partners" button
exists alongside it, disabled while a refresh is in flight or a
selection is being made (prevents duplicate taps), refetching in place
with no navigation or scoring-state reset.

**P1 — Protect the paper-player polling fix, architecturally, not just
by leaving it alone.** This is the one genuinely new fix this round.
Auditing "do not create separate inference logic" against the actual
current code found that while `/my-scores/route.ts` had already been
correctly fixed to use the new shared `resolveMarkedPlayerId()`
function, **`page.tsx` still had its own separate, independent inline
implementation of the identical decision** — exactly the architecture
that caused the original P0 in the first place (two implementations
free to silently drift apart). Refactored `page.tsx` to call the same
shared, tested function instead. This is a **behavior-preserving
extraction, not a redesign**: same queries, same conditions for when
`round_markers` is fetched at all (still skipped entirely for a
shared-device pair or `'individual'` mode, exactly as before), just
delegated to one already-tested decision point instead of two.

**P2 — Long player names could push or wrap the hole-info side of a
scoring card**, rather than truncating cleanly. Real gap: the name
container had no `min-width: 0`, which silently defeats
`text-overflow: ellipsis` in a flex layout even when the ellipsis rule
itself is present. Fixed with a `title` attribute (full name on
hover/long-press) and, critically, kept the "✏️ Paper Player" badge
**outside** the truncating span — an earlier draft of this fix would
have let a long name hide the badge entirely, directly undermining the
explicit "keep the distinction obvious" requirement for exactly the
names long enough to need truncating. Caught and corrected before
finalizing.

## UX IMPROVEMENTS

- Tap targets: confirmed the +/- score buttons are already 50×50px,
  exceeding the 44px minimum guideline — no change needed, verified
  not assumed.
- Paper player explanatory copy: confirmed already correctly
  differentiated — a shared-device-eligible group (exactly 1 digital +
  1 paper) shows "Paper player doesn't need a phone — their playing
  partner enters their scores during the round"; a paper player with
  no qualifying digital partner (where physical-card checking
  genuinely is the only option) correctly still shows that language.
  `isSharedDeviceEligible` computation verified to match the exact
  `paperCount === 1 && digitalCount === 1` rule.
- Scorecard identity: verified `ExpandableRoundScorecard`'s two
  instances (mine / partner's) use fully separate state
  (`mySelf`/`myHcp`/`scorecardExpanded` vs.
  `partnerSelf`/`partnerHcp`/`partnerScorecardExpanded`), dynamically
  labeled from `partnerName` — no shared identity risk found.

## REGRESSION TESTS ADDED

Already present from earlier this session, verified directly against
your explicit list rather than assumed:

- `resolveMarkedPlayerId — shared-device Paper Player is returned on initial resolution`
- `resolveMarkedPlayerId — repeated calls with identical input retain the same Paper Player (the exact P0 regression)`
- `resolveMarkedPlayerId — normal Digital ↔ Digital marker resolution still works`
- `resolveMarkedPlayerId — a shared-device relationship is never replaced by an unrelated round_markers row`
- `resolveMarkedPlayerId — unrelated players cannot become shared-device partners`
- Plus coverage for `individual` mode with and without a shared-device
  pairing, and confirming the paper half of a pair has no marker
  relationship of their own.

All confirmed passing this round as part of the 259 scoring tests
(**8 net-new** since the prior round's 251).

## FILES CHANGED THIS ROUND

- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` — refactored
  to use the shared `resolveMarkedPlayerId()` instead of a second
  inline implementation
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`
  — long-name truncation fix on the scoring card header

**Confirmed already correct from earlier this session, not modified
further:** `StartingGrid.tsx`, the playing-partner polling/refresh
code, `BeginRoundModal.tsx`'s paper-player copy,
`sharedDeviceScoring.ts`/`.test.ts`, `/my-scores/route.ts`.

## FULL TEST RESULT

**380/380 pass** — 259 scoring (251 + 8 new) + 59 highlights + 8
analytics + 54 trips. Confirmed via direct re-run this round, not
carried forward from memory of a prior session.

---

## WHAT WAS EXPLICITLY NOT TOUCHED, PER "DO NOT DESTABILISE"

- Shared-device detection (`detectSharedDeviceGroup`) — unchanged.
- Digital → Paper authorisation — unchanged; the `page.tsx` refactor
  delegates to the same decision, it doesn't alter who is authorised
  for what.
- The `/my-scores` polling fix itself — unchanged, only given
  regression coverage (already present) and a sibling file brought in
  line with it.
- Normal Digital ↔ Digital marker flow — unchanged, confirmed by the
  passing `resolveMarkedPlayerId` marker-mode tests.
- Stableford/scoring calculations, leaderboard calculations,
  reconciliation, My HQ paper score-entry fallback — none of these
  files were touched.

## WHAT STILL REQUIRES REAL-DEVICE VERIFICATION

This sandbox cannot run the event-day acceptance matrix. Specifically
needed before Darren's event:

- **A. Digital + Paper — Hole 1** and **B. — Hole 10**: confirm both
  cards appear, survive a 15-second wait, survive Next/Previous Hole,
  and survive a browser refresh — the direct test of this session's
  and the prior session's combined fix.
- **C. Digital ↔ Digital normal partners**: confirm unaffected by the
  `page.tsx` refactor — behavior should be byte-for-byte identical,
  but only a real test confirms that.
- **D./E. Second digital player joining late**: confirm the ~7s poll
  and the manual refresh button both surface them without a full
  page reload.
- **F. Shotgun / non-standard starting hole**: confirm the same
  shared-device behavior holds on the shared engine.
- Visual confirmation of the long-name fix on an actual long name, and
  of the P0 fix's "Change who I'm marking" correctly never appearing
  for a shared-device pair, on a real screen.

I have not claimed any of the acceptance matrix scenarios as verified
— only that the code is syntactically sound, internally consistent
with itself, and passes every test this sandbox can run.
