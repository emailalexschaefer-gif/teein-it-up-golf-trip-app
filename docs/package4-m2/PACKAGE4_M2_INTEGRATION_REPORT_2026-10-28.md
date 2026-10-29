# Package 4 / M2 — Ambrose integration stage report (28 Oct 2026)
Isolated development tree and a scratch Postgres only. **No production SQL, no migration applied anywhere real, no deployment, no ZIP.** Ambrose is still not selectable in Create Event and the new screens are mounted nowhere in the app (guard test enforced).

## 1. Integrated components and routes
- **Containers (new):** `AmbroseOrganiserContainer` (format + optional minimum drives, team suggestions with editable order, save teams, confirm scorers, organiser tools), `AmbroseScorerContainer` (server state + this device's offline team queue + upload loop), `AmbroseLeaderboardContainer`, shared `useTeamRound`. Presentation components contain no network or database code.
- **Organiser tools:** set a score with a reason, record No Score, release an override lock, resolve/dismiss a team query, waive a drive requirement.
- **Routes:** the 11 existing team action routes (user-scoped client) plus a new read-only `GET /api/team-state` (user client, no writes, no admin client; guard-tested).
- **Client API layer** (`teamApi.ts`): one place for route mapping and for turning signed-out / redirect / 405 / HTML / network failures into plain messages, reusing the V7 rules.
- **Rounding** (`rounding.ts`): two separate named integer-exact functions — team handicap to one decimal, exact halves toward +∞ (−0.25 → −0.2); whole-number strokes, exact halves away from zero (−7.5 → −8, never −0). A snapshot records method, inputs, decimal allowance and (Team Stableford only) whole strokes. Net and Team Stableford remain disabled.
- **Hole count** comes from the round's actual holes (9 or 18); nothing is hard-coded.
- **My HQ:** the containers take the playing groups and a "start scoring" hand-off as props so they can sit inside the existing My HQ round set-up. I have **not** edited MyHQClient or mounted anything there; that placement needs your go-ahead (it is the first change to a shipped screen).

## 2. Database functions actually exercised (scratch Postgres, real SQL, as the signed-in user with RLS)
configure_round_competition, create_competition_team, save_round_team_entry, assign_team_scorer, submit_team_score, release_team_override_lock, raise_team_score_flag, resolve_team_no_return, resolve_team_score_flag, waive_team_drive_requirement.
**Not exercised:** lock_team_handicap (handicaps are blocked) and team_entry_completion (the TypeScript mirror is tested; the SQL function was not called by the app path).

## 3. API and queue test outcomes
- **Full app suite: 1719 / 1719 pass** (was 1693; +26). Includes Stableford golden tests. esbuild syntax checks on every new file.
- **End-to-end scenario: 63 / 63 checks pass** (Chromium at 390 px → containers → offline queue → real route handlers → real SQL). Covers: four-person setup through the UI (16 players, 4 teams, scorers confirmed, start disabled until ready); score saving with revision 1 on first write; No Return stored with no gross score; offline entry kept on the device; stale write becomes a visible conflict, server value untouched, "keep their score" resolves it; organiser override with a reason (without a reason refused); offline scorer sees the organiser lock and can accept it; lock release audited; scorer reassignment (old scorer refused by the database, new accepted, old screen read-only); signed-out scorer keeps the score and it sends after sign-in; team-member query; organiser resolves No Return as No Score (team stays Unranked) then applies a reasoned score; query resolution; closed round refuses writes; gross leaderboard order, totals and shared positions (T1, T3) match database totals; nine-hole round (9 cells, completes on 36); optional drive tracking with shortfall keeping a team unranked until the organiser waives it.
- Reusable files: `docs/package4-m2/e2e/` (db_setup.sh, seed.sql, server.ts, client.tsx, build.sh, run_e2e.js).

## 4. Findings the integration work exposed (all fixed in TypeScript; SQL untouched)
1. **Setup outcomes were unknown to the classifier** (created, saved, configured and ten refusal codes) → every setup call would have answered 502. Fixed; a new test reads every outcome from the SQL proposal so this cannot drift.
2. **`lock_team_handicap` returns `locked` on success**, the same word `submit_team_score` uses for "organiser has set this hole". Handled by action context in TypeScript. **Approval question:** rename the success value (e.g. `handicap_locked`) in the next revision of 104? I have not changed the SQL.
3. **Round status vocabulary:** the app uses `active`; the database (correctly) refuses scorer writes before then and reports it as `round_closed`. The UI now says "Scoring has not started yet" instead of "closed".
4. **Duplicate team name across rounds** returned 409 (classed as a conflict) so team reuse failed. Fixed; event teams are reused across rounds.

## 5. Security verification status
- Verified in scratch only: identity and authority come from the database (`auth.uid()`), not the request; direct writes revoked; scorer reassignment and lock behaviour; no actor/organiser data sent by the client (guard tests).
- **Outstanding (not done):** real Supabase JWT/PostgREST, RLS on the real schema, default grants, direct RPC from the browser, middleware. The harness session is a cookie holding a user id, which is NOT a JWT test. The production RLS on `holes`, `profiles` and `rounds` has not been seen; the read route uses the user's client, so if existing policies hide those rows from members it will return empty data. This must be checked in a real Supabase integration environment.
- **405 review (static):** `middleware.ts` returns a JSON 401 for signed-out `/api/*` calls (not a redirect); none of the team routes is public; `next.config.ts` sets no trailing-slash redirect; the team routes export only POST (the read route only GET) and the client uses the matching verbs. A redirect to a non-login page or a 405 is reported verbatim and the score stays on the device. Not runnable here: real Next.js routing.

## 6. Limits of this evidence
- The sandbox could not install Dexie (no npm route). The E2E bundle aliases `dexie` to a small localStorage-backed shim; **real Dexie/IndexedDB behaviour is not exercised** (the queue rules themselves are unit-tested separately).
- No tsc, lint or `next build`. No device testing. Scratch Postgres is not Supabase.

## 7. Remaining blockers
Daily Handicap rule; Golf Australia Section 10(A) allowances and rounding; nine-hole contract; real Supabase auth/RLS/RPC integration; read-only production preflight; explicit migration approval.

## 8. Needing your approval before the first complete Ambrose test event
1. Rename the `lock_team_handicap` success outcome in the next 104 revision (finding 2).
2. Permission to place the containers inside My HQ (edits a shipped screen).
3. A real Supabase integration environment (or explicit approval to use one) for JWT/RLS/RPC verification.
4. Whether the organiser-entered handicap method should be the default stored method for gross-only events (the database requires a method; I used `organiser_entered`, which makes no source claims).
