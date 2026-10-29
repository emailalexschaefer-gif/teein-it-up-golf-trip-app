# Package 4 / M2 — Ambrose Net Stroke screens: progress report (28 Oct 2026)
Isolated tree only. No production migration, SQL execution, deployment or ZIP. The screens are **not mounted anywhere** in the app (a guard test enforces this), and Ambrose is still not selectable in Create Event.

## 1. Organiser screens completed (presentation + tested logic)
- **AmbroseSetupPanel**: five-step checklist (Format, Teams, Scorers, Handicaps, Start scoring); suggested teams per group with text labels (colour never the only signal); move-up/move-down controls to edit the slot order; "Not on a team" warning (no padding of short groups); Save per group; scorer picker per saved team ("confirmed / not confirmed"); Start scoring disabled with plain-language blockers.
- Logic: `setupModel.ts` (9 tests). Handicaps step shows "Not available yet — net results are off until handicap rules are verified; gross scoring is available".
## 2. Player/scorer screens completed
- **AmbroseTeamScorer**: hole strip (18 cells with states: empty, scored, saving, saved-on-device, conflict, organiser-set, No Return, rejected), 1–12 pad + 13–20 entry (1–20 validated), No Return button (records no score), optional "whose drive" selector with shortfall warning, query/flag button, conflict choice (keep theirs / use mine), accept-organiser-score for locked holes, sync banner.
- Logic: `scorerModel.ts` (11 tests).
- **AmbroseLeaderboard**: gross ranking, shared positions (T1), "Not yet ranked" with reasons, net-off note.
## 3. Team assignment behaviour
Slots 1–2 / 3–4 for two-person, all four for four-person; editable; unassigned warnings; nothing saved until the organiser saves; no silent reassignment after scores exist (setup locks when accepted scores exist).
## 4. Tests
- Full app suite **1693 / 1693 pass** (was 1672; +20 new model tests, +1 guard). esbuild syntax check passes on all new files.
- **Not run:** tsc, lint, next build; Supabase/JWT/RLS integration; real Dexie in a browser; device testing.
- Browser check (sandbox Chromium, 390×844, bundled with esbuild, fixture data): screens render; entering 25 shows the validation message; 5, 13 and No Return call onSubmit with the correct seen revision. This is not a device test and the components are not yet connected to the API/queue.
## 5. Changes to the proposed migration 104
None this stage. Pending (unapplied) scoring_mode / Team Stableford edits remain as previously described.
## 6. Remaining blockers
Daily Handicap rule; Golf Australia Section 10(A) allowances and rounding; nine-hole contract; Supabase auth/RLS integration tests; read-only production preflight; explicit migration approval.
## 7. Notes
- Your "halves away from zero" rounding for Team Stableford strokes differs from the half-up-toward-+∞ rule in the Ambrose team handicap record (one decimal). They apply to different numbers; I will implement each as written when Team Stableford is built, and flag it if they interact.
- Next (not started): a container wiring the screens to the team API routes and queue, behind a flag, with no Create Event exposure. This needs the migration applied somewhere to run end to end, so it can only be verified against the scratch database until you approve otherwise.
