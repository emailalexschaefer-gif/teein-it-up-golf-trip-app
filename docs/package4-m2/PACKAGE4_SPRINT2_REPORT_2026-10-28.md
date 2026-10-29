# Package 4 — Sprint 2: Real-world integration (status at the external-access gate)
**28 Oct 2026 · isolated tree · no production change, no migration applied anywhere, no ZIP**

## Bottom line

Everything that can be done without npm, a Supabase project or real devices is done. **The sprint's acceptance gates are not met** (build, real Dexie, Supabase security, phone access), because this sandbox has no npm registry, no Supabase credentials and no real browser storage/devices. I checked the registry and environment once, did not retry, and have not substituted scratch results for any real gate. Section 5 is the one list of what Alex must supply.

## 1. Approved decisions — implemented

| Decision | Done |
|---|---|
| 1. Freeze at Confirm & Release; audited reopen before scoring; audited scorer reassignment in play | Already in Sprint 1 (SQL 96/96, demo 69/69). Unchanged. |
| 2. Team completion + one Close Round for Ambrose | **Done.** For an Ambrose round (flag on, round has an Ambrose configuration) My HQ now uses **team** numbers: stage text reads "x of y **teams** finished · n% complete"; "needs the organiser" counts unresolved No Returns, open queries and drive shortfalls; ready-to-close = every team complete (database cross-checked) and the round active. The Manage stage shows the Ambrose section (team progress, organiser tools, leaderboard, **one** Close round control with the existing close route's Ambrose rule). Not rendered for Ambrose rounds: the individual-scorecard Tournament Control and its Close button, the individual score-override panel, Event Health (individual-based), and the organiser's individual "My Round" card. |
| 3. Gross-only needs no handicaps | **Done, format-scoped, fail-closed.** New `handicapsOptionalForRound`: true only if the flag is on **and** the round's configuration is explicitly `gross_only` **and** the read succeeded; any error/other method/non-Ambrose round → handicaps still required. Applied in Release (`liveArrangements`, both POST and the pending-changes GET), Begin Round (`start` route), the setup-context API, the Begin Round screen's readiness/warnings and My HQ's start preview. A missing handicap is stored as 0 (the column is `NOT NULL DEFAULT 0` and Begin Round already did `?? 0`); it is unused. Original rules and wording are untouched and guarded by tests. |
| 4. Pairs from displayed order, organiser reorders | Already how it works. |
| Player screen | For an Ambrose round the player's round view is **replaced** by their team scorer + team leaderboard (no individual scoring links). Others unchanged. |
| Leaderboard tone | The net-results note is now a small grey footer, not a yellow banner. |

## 2. Verification — kept separate

**Sandbox-verified:** full suite **1744 / 1744** (was 1735; new tests cover the handicap policy, team summary, guards); scratch SQL 96/96 + base suite 0 failures; 4×4×18-hole demo **69/69**; earlier end-to-end suite **66/66**; two-person **6/6** (Sprint 1, UI unchanged since except the shared HQ section, which the 4×4 demo re-ran). The 4×4 demo still includes the offline conflict, organiser correction, No Return, query, scorer reassignment, close and leaderboard ties.

**NOT verified (needs what is in section 5):**

| Gate | Status |
|---|---|
| TypeScript, lint, `next build` | **Not run.** esbuild syntax passes on every changed file; that is not equivalent. |
| Real My HQ Confirm & Release, Begin Round with no handicaps, real close route | **Not run.** The real routes need Next.js and Supabase. The changes are covered by static guards and unit tests of the pure logic only. |
| Real Dexie / IndexedDB (refresh, offline, reconnect, duplicates, stale revisions) | **Not run.** Sandbox used a localStorage stand-in. |
| Real Next.js routes/middleware (401/404/405) | **Not run.** In the stand-in server, signed-out calls got JSON 401, wrong methods 405, flag-off 404. |
| Supabase JWT, RLS, RPC, grants, cross-event | **Not run.** Script and setup guide are prepared (`supabase-integration/`), syntax-checked only. |
| Real phones | **Not possible yet.** |

## 3. Things I found that you should know

- **Released handicap display.** A player with no handicap is released with playing handicap **0** (schema forces a value). Players may see "0" in the released arrangement for a gross-only Ambrose round. Harmless to scoring; I recommend hiding handicap for Ambrose rounds in the arrangement view in a later pass.
- **Individual routes still reachable by URL.** The legacy individual scorecard page for an Ambrose round is hidden from My Golf/My HQ but not blocked if someone opens its URL directly. Low risk; a server block can be added once the real build is running.
- **Makers & Breakers** (after close) is still driven by individual scorecards; for an Ambrose round it will have nothing meaningful to select. Left alone this sprint (unrelated polish).
- Nine-hole Ambrose works structurally (tested); net/Team Stableford stay off.

## 4. Phone-testing checklist (use once a test build exists)

1. Test project + test build only; flag on; sign in as the organiser.
2. Create a round, four groups of four, **no handicaps entered**. Choose Ambrose → Two-person (then repeat with Four-person on a second round).
3. Reorder pairs if you want, name the teams, save, confirm a scorer for each team.
4. **Confirm & Release** — try to change a team (should refuse; reopen needs a reason). Then **Begin Round** — it must start without handicaps.
5. On each scorer's own phone open My Golf → their team scorecard. Enter all holes. Test: airplane mode for several holes then reconnect; refresh mid-round; two phones on one team; close and reopen the browser.
6. Another player queries a score; organiser resolves it. Record a No Return and resolve it both ways.
7. Organiser changes a hole while a scorer is offline; scorer sees the lock after reconnecting.
8. Watch My HQ: it should say "x of y **teams** finished", with **one** Close round. No individual scoring controls should appear.
9. Close the round; check the leaderboard (team names, players underneath, ties as T3). Confirm a normal Stableford round on the same test event still behaves exactly as before.
10. Send one consolidated list of anything that felt wrong.

## 5. What Alex must supply (one list)

1. **Do you already have a separate Supabase test project?** Everything depends on this answer. If not, create a new empty project (details in `supabase-integration/README.md`); never use the live one.
2. Its URL, anon key and service-role key as environment variables for a **test** deployment (Vercel preview or similar), plus `NEXT_PUBLIC_AMBROSE_ENABLED=true`.
3. Permission to apply `PROPOSED_104_competition_teams.sql` to that test project only.
4. A machine with npm access (or a CI run) for install, `tsc --noEmit`, lint, `next build`, and real-browser Dexie tests — I can run these myself if you give this environment registry access.
5. Two test phones for the checklist above.

When 1–4 exist I will run the full real-integration pass in one go and, if every gate passes, prepare the standard **one ZIP + one deployment report**. Nothing will be deployed or migrated in production without your explicit approval.
