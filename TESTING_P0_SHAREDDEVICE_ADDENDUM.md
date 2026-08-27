# P0 — Shared-Device Mode, Round Summary Reconciliation Fix
## 2026-08-27

**Build/test status: `npm run build` and `tsc --noEmit` were NOT run.**
This sandbox has no network access, so `npm install` fails (403 from the
registry) and there's no `node_modules` to build or type-check against.
Every edited file was syntax-checked with the TypeScript parser directly
(zero errors) and manually re-read for correctness, but that is not a
substitute for a real build. **Run `npm run build` before this ships —
per the standing rule, it must pass, not just the pure-function tests.**

The pure-function suite (`npm run test`'s actual scope,
`src/lib/scoring/**/*.test.ts`) passes 224/224, unchanged — this fix
touches no business-logic files in that folder (`roundCompletion.ts` and
`sharedDeviceScoring.ts` are untouched), only the client component and
one API route's tracing.

## Root cause found (confirmed by reading the code, not guessing)

The screenshots showed My HQ correctly reporting **100% Complete / 0
Reconciling** for the shared-device pair, yet the player's own **Round
Summary** screen showed **0 matched · 0 need review · 9 waiting**, and
attempting to close showed a red "Some holes are still awaiting marker
entries" message.

Tracing the pipeline (`scoring_method` → `detectSharedDeviceGroup` →
`checkScorecardCompletion`/My HQ's tournament route → **Round Summary
screen**) found the shared-device fix had correctly reached the two
server-side pathways (`close/route.ts`, `tournament/route.ts`) but had
**never reached the client-side Round Summary reconciliation screen** in
`SelfMarkerScoreShell.tsx`. That screen computed every hole's status via
`compareCaptures(mySelf, myMarker)` — and in shared-device mode,
`myMarker` is *always* empty by design (Marnie's official score is
written as **her own** `capture_role='self'` entry via the
`/shared-device-score` endpoint, never as a marker entry on Alex's
scorecard). So every hole read as "waiting for marker," which is exactly
the reported 9-waiting / false-mismatch-card bug. This is item 3 from
the brief's own hypothesis list: the fix had been applied to one
completion pathway but not another.

This also explains the "0 holes to review" comparison card: it was
comparing Alex's real point total against `markerGrandTotal`, which is
also always 0 in this mode (built from the same always-empty
`myMarker`), not against Marnie's actual score.

The blocked Close Round message is most likely a **stale `closeError`**
— local React state in `TournamentControl.tsx`, set by an earlier click
attempted before both players had finished, never cleared once the round
became genuinely ready (nothing was re-clearing it). I could not confirm
this against live production data — no network/DB access from this
sandbox — so instrumentation was added instead of assuming.

## What changed

**`src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`**
- Round Summary reconciliation: for `isSharedDeviceScoring`, per-hole
  status is now based on whether Alex's own entry (`mySelf`) and
  Marnie's own entry (`partnerSelf`) both exist for that hole — not on
  comparing against a marker entry that never exists in this mode. This
  single change is what everything else (mismatches, pending, the
  matched/awaiting/not_started buckets, `allMatched`, `isReadyToConfirm`)
  derives from, so no other completion logic needed touching.
- Header text: shows "Shared-device scoring complete ✓" once done, or
  "N of 9 holes recorded" while in progress, instead of the
  matched/need-review/waiting counts (which don't apply to this mode).
- Replaced the false "0 holes to review" comparison card with a
  non-judgmental card showing both players' real totals — a
  shared-device pair has nothing to reconcile, so there's no
  match/mismatch framing to apply.
- The "Scores still need review" red box now only appears for genuine
  marker-mode mismatches; shared-device pairs get a distinct amber "still
  recording holes" message when incomplete (mismatches are structurally
  impossible for this mode now).
- Same root-cause fix applied to the live per-hole "MY SCORE" status
  badge (`myComparison`), which had the same always-empty-marker problem
  while actively scoring, not just on the summary screen.
- **Scorecard placement**: moved Marnie's `ExpandableRoundScorecard` from
  beside Alex's at the top to immediately above her own scoring panel
  (Card 2), matching the required order: Alex's scorecard → side-game
  panel → MY SCORE → Marnie's scorecard → her scoring panel. Same
  component reused, not duplicated — just relocated.

**`src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts`**
- Added a console trace per scorecard checked (player, scoring method,
  group id, shared-device detection result, hole counts) — mirrors the
  tournament route's existing trace field-for-field, so a real block can
  be diagnosed by comparing the two directly.
- The 409 response now includes a `debug` object with the same fields,
  so if Close Round is ever genuinely blocked again, the exact reason is
  visible without guessing (this is the existing `debug` field pattern
  used elsewhere in the project).

**`src/components/scoring/TournamentControl.tsx`**
- Logs the server's `debug` payload to console on a blocked close
  attempt.
- Added a `useEffect` that clears a stale `closeError` once My HQ's own
  summary data shows the round is genuinely 100% complete / 0
  reconciling — so an earlier failed attempt can't keep displaying a
  misleading red message after the round becomes ready.

## What's proven vs. not

**Proven (code-level, by inspection + syntax check + full pure-function
test pass):**
- The root cause of the false "9 waiting" / false mismatch card is
  fixed at its source (the reconciliation screen), not papered over.
- No shared-device business logic (`roundCompletion.ts`,
  `sharedDeviceScoring.ts`) was touched — the fix works entirely by
  correcting what data feeds the existing, already-tested completion
  rule.
- Scorecard placement matches the required order.
- All 224 scoring pure-function tests still pass unchanged.

**NOT yet verified — needs your on-device pass, in this order:**
1. `npm run build` — must pass before packaging for real. Not run in
   this sandbox (no network access to install dependencies).
2. Repeat the exact acceptance scenario from the brief: 2 players / 1
   group / 1 digital + 1 paper / 9 holes / one device. Confirm Round
   Summary shows 0 waiting, no false mismatch card, and "Shared-device
   scoring complete ✓" once both are done.
3. Attempt Close Round on that same round and confirm it succeeds. If it
   still blocks, check the browser console for the new
   `[close-round blocked]` debug log — it will show exactly which
   scorecard failed shared-device detection and why (mismatched
   `group_id`, wrong `scoring_method`, etc.), rather than requiring
   another guess.
4. Regression: a genuine 2 digital players / 2 devices round must still
   require real marker reconciliation — untouched by this fix, but
   worth re-confirming since `checkScorecardCompletion`/
   `detectSharedDeviceGroup` weren't touched, only their client-side
   consumer.
5. Visual check that Marnie's scorecard now sits directly above her
   scoring panel on a real phone, not just in the JSX diff.
