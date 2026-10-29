# Package 4 — Sprint 1: Playable Ambrose (gross scoring)
**28 Oct 2026 · isolated development tree · nothing deployed, nothing applied to any real database, no ZIP**

## Bottom line

A four-team, sixteen-player, 18-hole Ambrose round now runs from organiser set-up to closed round through the real screens, the real route handlers and the real SQL functions, with an offline conflict, an organiser lock/correction, a No Return, an open query and a scorer reassignment on the way. **That is sandbox-verified only.** It is not Supabase-verified, not real-Dexie-verified, and not device-verified, and `tsc`, lint and `next build` could not be run. So it is **not yet ready for a controlled test deployment**; the exact steps to get there are in section 6.

## 1. What changed this sprint

| Item | Result |
|---|---|
| Reopen / relock (API + UI) | Two new routes (`reopen-setup`, `relock-setup`), outcome vocabulary (`setup_locked`, `setup_not_locked`, `setup_not_reopened`, `reopened`, `relocked`), reason required, organiser only, audited on every team, refused once any score exists. Set-up screen shows the lock, a reopen form and a "lock again" button. |
| **Freeze boundary corrected** | Inspecting My HQ showed "Confirm & Release" only sets `rounds.setup_released` and leaves the round `upcoming`; only Begin Round makes it `active`. My earlier freeze keyed off status and would have missed the real release. The proposed 104 now freezes on `setup_released` **or** status ≠ upcoming, and the lock check runs before other validation. |
| "Start scoring" button | **Removed.** The screen now shows a readiness hand-off ("Ready. Release and start the round from My HQ (Begin Round)"). Nothing in Ambrose can release or start a round. |
| My HQ mount | `AmbroseHQSection` sits directly beneath the Round Control Centre for the selected round; `AmbrosePlayerSection` sits under the player round view. Both are behind `NEXT_PUBLIC_AMBROSE_ENABLED=true` and are forced off when `NEXT_PUBLIC_APP_ENV=production`. All 14 team API routes also check the flag **on the server** and answer 404 when off. Not in Create Event. |
| Close Round | The existing close route counted individual scorecards, which an Ambrose round does not have. Behind the flag, a round with an Ambrose configuration is now closed only if the **database's** `team_entry_completion()` says every non-withdrawn team is complete (fail-safe: no teams, or any missing answer, blocks). Same organiser authority, same status change, same tail; non-Ambrose rounds take the original path untouched. |
| Gross-only | Stored explicitly as `gross_only` (never `organiser_entered`). Net Stroke and Team Stableford remain unavailable. Fixed misleading "Net Stroke event" text on the format step. |
| Team names | Leaderboard shows saved team names with roster names underneath. Group, team and round entry stay separate (a two-person group holds two teams). |

## 2. Verification — kept separate

**Sandbox-verified (scratch Postgres 16 + Chromium at 390px, Dexie replaced by a localStorage shim, session = cookie not a Supabase JWT)**

| Suite | Result |
|---|---|
| Full unit/regression suite | **1735 / 1735** (was 1723; 6 existing My HQ source-grep tests briefly failed when I restructured My HQ — I reverted to a sibling mount so they pass **unmodified**) |
| Scratch SQL — set-up/freeze suite | **96 / 96** (freeze, release-only lock, reopen/relock, audit, role/grant checks, gross_only) |
| Scratch SQL — base suite | 0 failures |
| **4 × 4 × 18-hole demo** (`run_demo_4x4.js`) | **69 / 69** |
| Earlier end-to-end suite, updated (`run_e2e.js`) | **66 / 66** (adds drive shortfall/waiver and cancelled-round agreement checks) |
| Two-person Ambrose (`run_twoperson.js`) | **6 / 6** (one group, two teams, 2+2 players) |

What the 4 × 4 demo exercised: feature gate off → 404 and nothing written; set-up inside the My HQ section; saved team names; release freeze; audited reopen/relock; player cannot reopen; released-but-not-started round refuses scoring; 16 players scoring 18 holes each through the screens; No Return stored without a score; offline score becoming a visible conflict (not an overwrite); organiser correction while a scorer was offline; lock release; scorer reassignment (old phone refused by the database); No Score keeps a team unranked; open query blocks completion; reasoned organiser score; Close disabled until all teams complete, close endpoint names the incomplete team; closed round refuses writes; leaderboard order/ties match the database (71, 72, T3 73, T3 73); no unsent or duplicate queue rows on any device; **no 404/405/5xx on any app API call.**

**Actual SQL completion function through the app route.** The state route calls `team_entry_completion()` per team and the app cross-checks it against its own rule; any disagreement makes the team *not complete*. Agreement was asserted (empty mismatch list, same `complete`) at: before play; No Return unresolved; No Score recorded; open query; all resolved; closed round; drive shortfall; shortfall waived; cancelled round. Missing holes are covered by the partial-card checkpoints. Disagreements: none.

**Not run / not verified**

| Gate | Status |
|---|---|
| Real Supabase (JWT identities, PostgREST, RLS, grants, direct browser calls, cross-event) | **Not run — no project, credentials or network.** I have *not* substituted the scratch results. A runnable script is prepared (`supabase-integration/run_supabase_checks.mjs`, syntax-checked only). |
| Real Dexie / IndexedDB in a browser | **Not run** (npm unreachable; localStorage shim used). Queue behaviour above is the shim's. |
| `tsc`, lint, `next build` | **Not run** (no dependencies; npm registry checked once, unreachable). esbuild syntax checks pass on every changed file; that is **not** equivalent. |
| Real My HQ page, real start/release/close routes | **Not run.** Harness stands in: release/start are scratch SQL; setup-context and close are harness equivalents (close runs the real `ambroseCloseVerdict` over the real SQL function). The real close-route branch is guarded structurally only. |
| Device testing, production RLS on holes/profiles/rounds | Not done / not seen. |

## 3. Decisions I made that you should confirm

1. **Freeze = Confirm & Release** (not just Begin Round); once any score exists the freeze is round-wide. **Scorer reassignment stays allowed after release** (a dead phone mid-round), audited every time.
2. **Close for Ambrose** uses the team-completion rule above, via a button in the Ambrose section. The existing My HQ "completion %" and Close control still count *individual* scorecards, so for an Ambrose round they will read 0% — confusing but harmless. Proposal: hide them for Ambrose rounds in the next pass.
3. **Begin Round is unchanged** and still creates individual scorecards and enforces its own checks (e.g. every player has a handicap). For a gross-only Ambrose test, players still need a handicap on file to start. Decision needed: relax for Ambrose, or leave.
4. **Pairing order.** There is no slot column on group members, so default pairs follow list order; the organiser reorders with ↑/↓ before saving (slots 1+2 / 3+4 once ordered).

## 4. Known limits (deliberate)

Net Stroke and Team Stableford off pending Daily Handicap / Section 10(A) rules. Nine-hole Ambrose structurally works (tested) but stays pending your contract decision. No Alternate Shot, Skins or Ryder Cup. Individual Stableford untouched.

## 5. Hands-on checklist for Alex and Darren (once a test project exists)

1. Test environment only: set `NEXT_PUBLIC_AMBROSE_ENABLED=true`; leave `NEXT_PUBLIC_APP_ENV` unset or `staging`.
2. My HQ → pick an upcoming round → **Set up Ambrose** → choose Two-person or Four-person → Use this format.
3. Reorder players if needed, name each team, **Save team** per group; confirm one scorer per team.
4. Check the readiness line, then **Confirm & Release**, then try changing a team (it should refuse and offer **Reopen**; reopen needs a reason). Lock again.
5. **Begin Round** from the existing My HQ flow.
6. Each scorer (their own phone): enter every hole; turn on airplane mode for a few holes and reconnect; confirm nothing is lost.
7. Have someone else query a score; as organiser resolve it. Try a No Return and resolve it (No Score vs a reasoned score).
8. Organiser: change a hole while the scorer is offline; check the scorer sees the lock.
9. Check the leaderboard: team names, players underneath, ties shown as T3.
10. Close the round from the Ambrose section (it should stay disabled until every team is complete).
11. Write down anything that felt wrong; send one consolidated list.

## 6. What is needed to make this playable

1. A **separate non-production Supabase project** (URL, anon key, ability to run SQL) — never the live database.
2. Your approval to apply `PROPOSED_104_competition_teams.sql` to that **test** project only (unapplied elsewhere; production untouched).
3. Fixture users (organiser, scorer, member, outsider, other-event organiser) + `fixture.json`; run `run_supabase_checks.mjs`; fix whatever it finds.
4. A machine with npm access: install, `tsc`, lint, `next build`, and real-Dexie queue tests in a browser.
5. Then a short device pass on a real phone. Only after that would I propose a V8 candidate and the two-file package.

## 7. Files

New/changed app files are limited to: `lib/ambrose/*`, `components/ambrose/*`, `app/api/team-*`, the close route (flagged branch), `MyHQClient.tsx` and `MyRoundClient.tsx` (flagged mounts), `lib/db/dexie.ts` (additive v3, unchanged this sprint). Scratch harness, SQL tests, screenshots and the Supabase script live under `docs/`. `release-p3`, Finish Round Early and migration 100 remain separate and untouched. One process note: a bad file write briefly emptied `MyHQClient.tsx` in the dev tree; I restored it byte-for-byte from the V7 copy (verified the only other differences from V7 are the intended Package 4 files) before continuing.
