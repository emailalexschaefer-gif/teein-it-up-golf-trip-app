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

---

# P0 Round 2 — Persistence + Lock-Endpoint Fixes
## 2026-08-27 (afternoon)

Real-device testing of the Round 1 fixes above confirmed the Round
Summary screen fix worked correctly — "Shared-device scoring complete
✓" now shows with real totals for both players, no false mismatch. Three
new issues surfaced, all found by tracing actual state (not guessed):

## 1. Marnie's live scoring panel reset to 0 on return — FIXED

**Root cause:** the per-hole draft-rehydration effect (`useEffect` keyed
on `holeNum`, around where `draftPartnerGross`/`draftPartnerPickedUp`
get set) read `partnerMarker[holeNum]` to restore the previously-entered
value. `partnerMarker` is only ever populated in genuine two-device
marker mode. In shared-device mode, Marnie's official score is written
as **her own** `capture_role='self'` entry (via `/shared-device-score`)
and lives in `partnerSelf` — the same source her horizontal scorecard
already correctly reads from. So her horizontal scorecard showed her
real 25pts (reading `partnerSelf`) while the live panel reset to 0 on
every hole change (reading the empty `partnerMarker`) — two consumers of
the same official record, reading two different places, exactly as
suspected.

**Fix:** the rehydration effect now reads `partnerSelf[holeNum]` instead
of `partnerMarker[holeNum]` when `isSharedDeviceScoring` is true.
Mirrors the same pattern already used successfully for Alex's own
`mySelf`-based rehydration, which never had this bug.

## 2. "Waiting on marker entries" on Confirm & Lock — FIXED

**Root cause:** a third, previously untraced pathway. The actual
lock/submit endpoint (`POST /api/trips/.../scorecards`, action=
`'submit'`) had its own independent marker-completeness check with zero
shared-device awareness — it required a genuine `capture_role='marker'`
entry for every self-entered hole, unconditionally, in
`self_and_marker` mode. Since a shared-device digital player's own
scorecard never has marker entries (Marnie writes her own self entries
instead), this always blocked, regardless of what Round Summary or My
HQ correctly showed. This is the third pathway the original brief asked
me not to assume was already covered by fixing
`checkScorecardCompletion` alone — it wasn't.

**Fix:** reuses the same `detectSharedDeviceGroup` function (not a new
copy of the rule) to detect whether the submitting player is the
digital half of a shared-device pair, and skips the marker requirement
for them exactly as `close/route.ts` and `tournament/route.ts` already
do. Additionally, since there's no separate confirmation step for the
paper partner (no login of her own), this endpoint now locks Marnie's
scorecard alongside Alex's own when he confirms — this is the "both
cards become final together" behavior the design calls for, which the
endpoint had never done before (it only ever locked the calling
player's own scorecard).

## 3. Vertical white space above Side Game panel — likely fixed

**Root cause found:** `scrollContainerRef`'s own container had
`padding: '... 16px 100px'` (a 100px bottom padding), inherited from
when this div used to be the bottom-most section of the page. It no
longer is — the side-game banners, both score panels, Pro Tip, and the
Live Leaderboard button all render as later siblings. So that 100px sat
as a large fixed gap in the *middle* of the page (right after Alex's
collapsed scorecard toggle), not at the true bottom. Confirmed via
direct AST parsing of the JSX tree, not by inspection alone, to be sure
which div this padding actually belonged to.

**Fix:** reduced to a small 12px. The true bottom-of-page clearance
(for the fixed action tray + safe area) is already separately provided
by the app's own layout wrapper (`(app)/layout.tsx`'s `pb-24` Tailwind
class), which applies to the actual end of all page content — so no
compensating padding needed to be added elsewhere. The horizontal
margins visible on every card (banners, ScoreCards) also come from that
same layout wrapper's `px-4`, not from anything in this file — confirmed
by reading the layout, not assumed.

**Confidence note:** I traced this through the code and I'm confident
in the *mechanism* (a genuinely misplaced fixed padding value, verified
via AST, not a guess). I could not visually confirm the resulting
spacing "feels right" (16–24px vertical rhythm) without a running
browser — please eyeball this specific spot on a real device as part of
the acceptance pass below.

## Build/test status — same caveat as before

**`npm run build` was still not run** — no network access in this
sandbox. Every edited file was syntax-checked with the TypeScript
parser (zero errors across all four files touched today:
`SelfMarkerScoreShell.tsx`, `close/route.ts`, `TournamentControl.tsx`
from the morning round, plus `scorecards/route.ts` this afternoon). All
224 pure-function tests in `src/lib/scoring/**` still pass, unchanged —
no business-logic file was modified, only the client rehydration
source and two API routes' shared-device detection.

## Next acceptance pass — per your instructions, use a FRESH round

Don't reuse the round from these screenshots (it's survived multiple
deploys and schema revisions — useful for diagnosis, not proof of the
fix). Create a new one:

1. New round: 2 players → 1 Digital + 1 Paper → 9 holes.
2. Hole 1: Alex 4 / Marnie 5 → confirm → leave scoring screen → return.
   **Both should still show 4 and 5** in the live panel, not reset to 0.
3. Repeat for Hole 2. Only once this specific persistence check passes,
   proceed to all nine holes.
4. Round Summary: confirm "Shared-device scoring complete ✓" with both
   real totals, no false review state (already proven in the
   screenshots from this afternoon, should still hold on a fresh round).
5. Confirm & Lock: should now succeed with no "Waiting on marker
   entries" message. Confirm both Alex's AND Marnie's scorecards show
   as locked/completed afterward (check via My HQ or a scorecards query
   — the fix locks both together, but this hasn't been seen on a real
   device yet).
6. Visually check the spacing above the Side Game panel on a real phone.
7. Regression: a genuine 2 digital players / 2 devices round must still
   require real marker entries at both the Round Summary and the
   Confirm & Lock step — neither shared-device code path should ever
   trigger for a non-shared-device pair.

