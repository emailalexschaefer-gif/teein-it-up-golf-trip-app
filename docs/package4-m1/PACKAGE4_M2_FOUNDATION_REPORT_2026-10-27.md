# Package 4 - M2 Foundation Report
27 Oct 2026 · Isolated development tree only (`p4`, copied from shipped V7). **No release ZIP. Nothing deployed, merged or run against any real database. Migration 104 and the helper hardening remain proposals.** V7 and the golden Stableford tests are preserved.

## 1. Results at a glance
| Check | Result |
|---|---|
| Whole app test suite (sandbox, Node test runner) | **1665 / 1665 pass** (V7 baseline 1609; +56 new). Golden Stableford tests included. Run with `NODE_PATH` pointing at the sandbox zod (3.25.76; the project pins 3.23.8, same v3 API). |
| New Ambrose logic tests | handicap 11 · round state/ranking/drives 10 · queue rules 11 · upload loop 12 · API core 7 · structural guards 4 = 55 (+1 registry guard) |
| Scratch Postgres 16, v2 team functions | 66 / 66 (security + conflict contract); idempotent re-apply; race test 8 sessions x 18 holes, one winner per hole, both phases |
| Scratch Postgres 16, organiser setup functions | 46 / 46 |
| Scratch Postgres 16, helper hardening | 15 user x trip combinations identical before/after; hostile search_path test passes |
| Syntax check of new `.ts` / route files | esbuild parse only. **No `tsc`, lint or `next build` is available here, so type-checking and lint are NOT verified.** Please let the normal build/lint run before anything ships. |
| Device / Supabase / live DB | **Not tested.** |

## 2. Implemented (in the isolated tree, unreachable by users)
- `src/lib/ambrose/handicap.ts` - methods A weighted (35/15, 25/20/15/10), B club divisor (÷4, ÷8), C organiser-entered (note required). Exact integer arithmetic, one rounding step (1 decimal, half up), plus handicaps, complete teams only, duplicate/over-precise input refused, full working record + `sourceStatus`, never labelled "current Golf Australia".
- `teamRound.ts` - completion rule (mirrors the database function), gross total only when all holes valid, running total for "thru", team status (not started / in progress / needs attention / complete / **incomplete-unranked**), gross leaderboard with ties, **unranked section with reasons**, net leaderboard refused unless explicitly enabled.
- `drives.ts` - optional selected-drive progress and gentle risk message; off = no UI, no queue field.
- `outcomes.ts`, `teamRpc.ts`, 11 routes - user-scoped API core: `submit`, `flag`, `resolve_flag`, `assign_scorer`, `unlock`, `resolve_no_return`, `waive_drive`, plus setup: `create_team`, `configure_round`, `save_entry`, `lock_handicap`. No actor/organiser value is ever sent to the database (tested, and a structural test forbids the admin client in these routes). Body fields are snake_case to match `/api/scores`.
- `teamQueueRules.ts`, `teamSyncRunner.ts`, `teamQueue.ts` + additive Dexie version 3 (`teamScoreQueue`): base revision per hole, chained offline edits keep the original base, burned clientIds never reused, conflicts kept (never retried or overwritten), locked holes offer "accept server" only, lost-acknowledgement rebase, success believed only if the answer echoes the write, one failure halts the pass, V7 auth/405/redirect rules reused. The individual `scoreQueue` declarations are untouched (tested). The Dexie wrapper is thin and **not unit-tested** (no IndexedDB in the sandbox); all its decisions are in the tested pure modules.
- SQL proposals (docs only): `PROPOSED_104_competition_teams.sql` now has 4 setup functions (`create_competition_team`, `configure_round_competition`, `save_round_team_entry`, `lock_team_handicap`) alongside the seven score/dispute functions and `team_entry_completion`; `PROPOSED_helper_hardening_search_path.sql` is a separate proposal.
- Daily Handicap impact report and its read-only query (separate from M2).

## 3. Implemented but blocked from use
- All Ambrose formats stay `planned` in the registry; `selectableFormats()` still returns Stableford only (tested). Nothing in the app imports the new modules (tested). Net leaderboard is refused unless `netEnabled`, which nothing sets.
- Nine-hole Ambrose: no code path exists.

## 4. Not built yet (next M2 stages, need your go-ahead)
Organiser team/roster setup **screens**, the team scorecard screen (nominated scorer, drive chips, conflict review UI), flag/override/unlock UI, leaderboard and presentation components wired to `buildLeaderboard`, and the 40-player and 100-player fixtures. Only logic, API cores and queue exist today.

## 5. Findings you should know about
- **Source status:** I could not retrieve the text of GA Section 10(A) (the fetch stops before it), so the weighted 35/15 and 25/20/15/10 allowances and "one decimal" are NOT confirmed by me from a primary source; the code labels them "unverified, archived 2020". The archived guide I did read states Daily Handicap rounding is to the nearest whole number and that the 18-hole stroke index is used for 9-hole rounds. Please attach or confirm the Section 10(A) text and check for newer guidance.
- **Daily Handicap** (see its own report): the published GA formula differs from the app's MVP formula by -4 to +2 strokes depending on handicap and course; it decides the inputs to net Ambrose.
- **Helper hardening:** the unpinned helpers qualify `public.trip_members` already, so I could not show a practical exploit; the change is defence in depth that Supabase's linter also asks for. The scratch test has no policies, so consumers of the helpers (33 migrations' worth of RLS) were **not** exercised and need a Supabase integration test.
- **Method naming:** the app id is `ga_weighted`; the database stores `weighted_scramble` (mapped in the API core and the lock function).
- Setup freeze: once team scoring starts for an entry, roster, configuration and handicap lock are refused (tested), so a team handicap cannot change mid-round.

## 6. Decisions still needed before the first Ambrose release
1. Confirm the effective Daily Handicap rule (impact report section 10).
2. Confirm the Ambrose allowances and rounding from the GA Section 10(A) text; decide the default shown to organisers.
3. Real Supabase integration test plan and who runs it (JWT, RLS, default grants, direct RPC) before any migration.
4. Run the read-only queries: preflight, both nine-hole queries, Daily Handicap impact.
5. Tie-break/countback rule for equal team scores (currently shared rank).
6. Approve building the scorer and organiser screens (next stage).
