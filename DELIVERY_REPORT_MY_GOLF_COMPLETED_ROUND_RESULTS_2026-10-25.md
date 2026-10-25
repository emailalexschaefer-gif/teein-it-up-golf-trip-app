# My Golf — completed round results & scorecard access (2026-10-25)

Not deployed. No migration applied. Built on the Share-fix tree (v3 + share fix); separate from Package 3.

## Audit (what already existed)
- **Event Schedule** (`RoundSchedule`): in My Golf (`MyRoundClient`) tapping a card only selected the round and showed `PlayerRoundView`; no round leaderboard or other players' scorecards were reachable for a past round. (My HQ's read-only variant links completed rounds to `/leaderboard?roundId=`.)
- **Round leaderboard route** `GET /api/trips/{trip}/rounds/{round}/leaderboard`: already returns this round's `board` (position, points, `handicap` = that round's `scorecards.playing_handicap`, holes played, per-hole gross/par/SI/points). Any trip member can call it (existing visibility rule, unchanged). Paper-player and shared-device scores are stored as `capture_role='self'`, so they appear in this board automatically.
- **Hole-by-hole scorecard**: `InlineScorecard` inside `LiveLeaderboard` (stacked list on phones, table at sm+; 9 and 18 holes).
- **Gap**: `/leaderboard?roundId=` for Round 2+ shows cumulative standings, so it is not a round-only view.
- **Handicap snapshot**: `scorecards.playing_handicap` is written when the round starts (and insert-if-absent for late joiners, `ignoreDuplicates`); no code path updates it afterwards. Each round therefore keeps its own handicap already. No schema change needed. (Verified in code; not against live data.)

## Change (smallest safe)
- New `CompletedRoundResults` panel, shown in My Golf under the Event Schedule for the selected round **only when status = completed**: "{Round} Results — Leaderboard and player scorecards" with **View {Round} Leaderboard** and **View My Scorecard**.
- Leaderboard = this round's `board` only; tap a player to expand their read-only hole-by-hole scorecard with "Playing handicap this round", points and Front/Back/Total.
- Reuses `InlineScorecard` (now exported) and the existing route; no scoring is recalculated. No inputs or write calls.
- Players with fewer holes than the round show "Incomplete · n/N holes" with their actual points (never zeroed).
- Cancelled (and upcoming/active) rounds render nothing and make no request.
- Small helpers in `roundResultsView.ts`. Event Story, Final Results, Event Presentation, achievements and the rest of My Golf are untouched.

## Tests
- Full suite: see result below. New: 8 tests (visibility by status, own-row lookup, incomplete labels for 9/18 holes, read-only/GET-only, round-scoped not cumulative, reuse of InlineScorecard, cancelled renders nothing and does not fetch, per-round handicap not updated).
- Lint-style and hook checks clean; type check on changed files 0 diagnostics.
- Mobile preview (390px, stubbed API): closed, leaderboard + expanded scorecard, incomplete player, 9-hole My Scorecard, cancelled (no buttons).

## Not verified / known gaps
Real Supabase data, Samsung and iPhone devices, Tailwind breakpoints in preview (preview lacks Tailwind, so both mobile list and table showed; the app hides one).
Finished-early: Package 3 is not in this tree, so only the generic "Incomplete" label is shown; ranking/"Not ranked" semantics will need the Package 3 data merged.
Pre-existing, unchanged: the leaderboard route does not special-case a cancelled round opened by URL; a cancelled round that had scores would still return them there. The new panel never requests it.
My HQ's completed-round cards still link to `/leaderboard?roundId=`, which is cumulative for Round 2+; left as is.
