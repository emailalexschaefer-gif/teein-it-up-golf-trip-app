# Package 2 — Cancel an unplayed round & complete the event (25 Oct 2026)

Built on the deployed Release 3S pilot (incl. the node:crypto build repair and the
Share-Event-Presentation discoverability fix). No audio layer. **Not deployed. Migration 097 not applied.**

## What it does
* **My HQ → select the unplayed round → Cancel Round.** Impact preview (what is kept, whether the event completes),
  optional reason (200 chars), confirm. Round stays on record as *Cancelled*; no scores, DNFs or side-game winners are created.
* Cancelling the last unplayed round **completes the event** when at least one round was completed
  (same rule now used by Close Round). Champion = completed rounds only.
* **Reinstate Round** (organiser) puts it back to Upcoming; a completed event returns to live. If a presentation is
  already published you are told to republish it.
* Audit trail: `round_status_events` (who, when, why) + `cancelled_at/by/reason` on the round.

## Files
* `supabase/migrations/097_round_cancellation.sql` (new)
* `src/lib/scoring/roundLifecycle.ts`, `roundCancellation.ts` (new, pure/injected)
* `api/trips/[tripId]/rounds/[roundId]/cancel` and `/reinstate` (new, organiser-only)
* `components/scoring/CancelRoundControl.tsx` (new); wired in `MyHQClient.tsx`
* Cancelled-aware: `close/route.ts` (completion rule), `start/route.ts` + `release/route.ts` (refuse cancelled),
  `roundWorkflow.deriveEventProgress`, `multiRound.selectLeaderboardRound`, `eventMemoryData` (cancelled round excluded
  from presentation manifest), `RoundSchedule` + `TripRoundsTab` pills, `PlayerRoundView` (My Golf "cancelled" card),
  round detail page redirect, trip overview/list round counts, `RoundStatus` type.
* NOT touched: scoring, verification, Stableford, side games, leaderboard maths, offline, RLS/permissions, 3B, DNF.

## Behaviour already correct (verified by reading, unchanged)
Leaderboard, Final Results, cumulative standings, side games and My Golf event stories read only `completed`
(and `active`) rounds, so a cancelled round drops out without code changes. `begin_round()` only accepts `upcoming`.

## Tests
Full suite **1259 / 1259** (was 1236): +21 `roundCancellation.test.ts` (rules, Lappen completion, preview, guards,
race, failure paths, audit, reinstate, wiring, migration shape) +2 `lappenCancelledRoundPresentation.test.ts`
(full deck from one completed round: opening, glance = 1 round, round section, side-game winner, Makers & Breakers,
leaderboard, champion, closing; no "Round 2" anywhere).
NOT run here: `next build`, real `tsc`, `next lint`, real Postgres (the migration's DO block has not been executed),
phone testing.

## Deploy (when approved)
1. Supabase SQL Editor: run `097_round_cancellation.sql` (additive; safe before or after the code).
2. Upload the ZIP to GitHub, let Vercel build (send the log if it fails).
3. Lappen: My HQ → tap **Round 2 (Flinders)** → Cancel Round → reason "Rain" → confirm. Then tap Round 1 →
   Stage 5 **Create & Share Event Presentation** → Share Event Presentation / ▶ Create Slideshow.

## Rollback
Code: redeploy the previous Vercel deployment. Data: reinstate any cancelled round in the app, then run the ROLLBACK
block at the top of the migration file (drops the audit table and columns and restores the 3-value CHECK).

## Known limits / decisions
* Only an **unplayed** round can be cancelled. Started-then-abandoned rounds are not supported (Close Round still
  needs complete scorecards) — needs its own rules. DNF untouched.
* Cancel reason is stored but not yet shown on screen. Invite page round count and "Run Again" still include a cancelled round's template.
* Edit Event can still delete an upcoming round (pre-existing) but does not complete the event — use Cancel Round.
