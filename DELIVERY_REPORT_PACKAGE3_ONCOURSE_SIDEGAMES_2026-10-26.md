# Package 3 — On-Course Scoring, Side Games & Presentation Polish
26 October 2026 · Branch copy `release-sidegames-scoring-ux` (built on the final Package 2 ZIP, SHA-256 347e0900…ab90, verified identical) · **Not deployed · no migration · migration 100 / `release-p3` NOT merged · no database change needed.**

## Baseline
- Built from the final Package 2 build, which already contains Package 1 (diff-verified earlier) and Package 2 snapshots/handicap release/Start protections (untouched; their tests still pass).
- **Migration 101 in your environment: I cannot know.** Run `supabase/preflight/101_preflight.sql` to find out. Package 3 does not depend on 101.

## Phase 1 audit — what already existed (so nothing was rebuilt)
| Area | Already in the app | Real gap |
|---|---|---|
| Mismatch | `compareCaptures` states (matched / mismatch / pending / resolved), inline red reconciliation panel on the hole, Round Summary review list, My HQ "Marker mismatch" alerts showing both scores | **Nothing stopped a player moving past a disputed hole unnoticed** |
| Side Game arrival | Per-hole "NEAREST THE PIN — ACTIVE · Hole · Par" banner with entry panel | No explicit reminder text; easy to miss |
| Nomination permissions | Server rule in `entries` route: self, or someone in your own playing group who is in this round; cross-event and other-group refused; `p_entered_by` audit | None found (see note 3) |
| Verification | Confirm / Correct / Reject via `verify_side_comp_value_entry`; verifier snapshotted per claim; authority checked inside the RPC; shared-device partner case; server-driven pending list (survives refresh) | Collapsed, easy to miss; "Correct" wording; panel missing in group-scorer mode |
| Capture the Moment | `MomentCapture` (photo, gallery, **video**, upload, side-game context) via `NewLeaderPrompt` | Offered only when a nomination "would lead" |
| Hole pars in setup | **Already shipped (18 Oct):** `holeOptionLabel` → "Hole 3 — Par 3" from the round's frozen course data, play order for 9-hole/back-nine, plain "Hole N" when no data | None — covered by new tests |
| Fullscreen | Package 1 final removed all automatic fullscreen | None in code (see note 4) |

## Changes (all small, in priority order)
1. **Score Mismatch Warning.** New pure module `mismatchWarning.ts` + one hook in the shared forward-navigation path (`saveAndAdvance`, used by Next Hole, swipe and the final-hole "Round Summary →", incl. shotgun). After the score is saved, if the existing comparison says `mismatch`, a dialog "⚠ Scores Don't Match — Hole N" lists every disputed golfer (one dialog, not one per mismatch) with both entries. **Review Scores** stays on the hole and scrolls to its reconciliation panel. **Continue Scoring** only records that you saw it and moves on. Shown once per distinct disagreement (no loop; a changed score re-warns). Waiting-for-marker, not-started, offline-unsynced, organiser-resolved, shared-device and paper pairs never warn. Nothing is verified, picked, overwritten, invented or cleared; reconciliation state, Stableford and My HQ are untouched. Backward moves never warn.
2. **Verification panel.** Titled "Side Game Verification Required", open by default (still inline, never a modal), Confirm / **Modify** / Reject; also added to group-scorer rounds.
3. **Arrival reminders.** New `SideGameArrivalPrompt` (inline, non-blocking): exact wording from the brief per game, driven by the real per-hole config, one reminder per competition instance, remembered per session, "Go to nomination" scrolls to the right panel.
4. **Capture the Moment** now offered after any qualifying nomination (neutral "📸 Capture the Moment! Got a photo or video of that shot?"; celebratory wording kept for would-lead). Optional, Skip, nomination is saved before the prompt exists, so an upload failure cannot lose it.
5. **Hole pars:** no change needed; tests added.
6. **Presentation:** audited — the only `requestFullscreen` in the app is the tap-driven button. Clap icon = **applause on winner/champion slides**; now has a tooltip ("Applause on winner slides: ON/OFF") plus its existing aria-label.

## Files changed
New: `lib/scoring/mismatchWarning.ts(+test)`, `lib/sideGames/arrivalPrompt.ts`, `components/scoring/SideGameArrivalPrompt.tsx`, `lib/sideGames/package3SideGames.test.ts`, `components/memories/presentationFullscreen.test.ts`.
Edited: `SelfMarkerScoreShell.tsx`, `ScoreSessionShell.tsx`, `PendingVerificationCard.tsx`, `SideCompEntryPanel.tsx`, `NewLeaderPrompt.tsx`, `EventHighlightsPlayer.tsx`.

## Tests
- **Full suite: 1498 / 1498 pass** (Package 2 final was 1467; +31). New coverage maps to brief scenarios 1–2, 5–9, 12, 15–25, 27–32, 34–38, 40.
- Real Chromium (esbuild bundle, 360 px): arrival prompt renders both reminders for two games on hole 7, dismisses, stays dismissed after reload, and shows the right reminder on the next hole.
- **No SQL tests: no database change in this package.**
- **Not run:** `tsc`, `next lint`, `next build` (sandbox cannot reach npm — syntax-checked only; run them in CI/Vercel preview). **Not verified:** the mismatch dialog rendered inside the live scoring screen (logic and wiring are tested, the 3,300-line shell can't be mounted here), verification panel and capture flow against live Supabase, any phone.

## Notes / decisions for you
1. **Reject reason not built:** it needs a new column and RPC change (a migration). Say if you want it.
2. **Longest Drive has no Modify** (its model is ranked, not a typed distance) — Confirm / Reject only, as before.
3. **"Partner" = anyone in your own playing group who is in the round** (existing, server-enforced). I did not narrow it to marker-only; that would be a rule change. Organisers outside the group correct via existing admin tools.
4. **Fullscreen notice:** the code cannot cause it on open. If your phone still showed it, that build predates Package 1 final or the tap-button was pressed — check the deployed build has the ⛶ button in the tap-to-reveal bar and no grey notice on open. Chrome's notice after tapping the button is expected and cannot be suppressed.
5. Existing "TEMPORARY" debug text still appended to Side Game error messages (`SideCompEntryPanel`) — pre-existing, left alone; worth removing.
6. Group-scorer rounds still don't offer Capture after a nomination (pre-existing; only the marker shell wires it).

## Deployment prerequisites
App-only release. Deploy after Package 2's sequence is settled (101 applied/verified first if not already). No new migration. Do not merge `release-p3` / migration 100.

## Samsung / iPhone field-test checklist
1. Two phones, marker round: enter 4 for Alex, marker enters 5 → Alex taps Next Hole → "Scores Don't Match — Hole 7" shows both. Review Scores stays; Continue Scoring moves on; return and Next again → no repeat; My HQ still shows the mismatch.
2. Correct the score to match → no warning; hole shows matched.
3. Marker hasn't entered yet → no warning. Shared-device/paper pair → no warning. Airplane mode → can still advance.
4. Arrive at an NTP hole → reminder; Go to nomination scrolls to the panel; reload → reminder stays dismissed.
5. Nominate yourself and a group-mate; the verifier sees "Side Game Verification Required" and uses Confirm / Modify / Reject; refresh keeps it; Capture the Moment offers photo/video, Skip works.
6. Open the presentation: no grey fullscreen notice; tap to reveal controls; 👏 shows its tooltip; ⛶ enters full screen only on tap.
