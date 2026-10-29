# V8 Ambrose (gross) — controlled production test runbook

Status: NON-DEPLOYABLE until Gate 1 and Gate 2 pass. Nothing here has been run against your production. Steps marked **[APPROVAL]** need Alex's explicit go-ahead.

## Gate 1 — real build (any computer with Node 20+, ~10 minutes; or a Vercel Preview build)
```
unzip the package into a new empty folder, then inside it:
npm install
npx tsc --noEmit
npm run lint
npm run build
npx tsx --test $(find src -name "*.test.ts*")
```
(There is no lockfile in the package, so use `npm install`, not `npm ci`. `next.config.ts` has `ignoreBuildErrors: true`, so `tsc` is run separately to see type problems.) Send me the output of each command. I fix real failures.

## Gate 2 — Supabase security run (throwaway project, ~45 minutes, never production)
1. Create a NEW empty Supabase project ("teein-it-up-throwaway"). Note its DB connection string and URL / anon key.
2. `bash scripts/make-fresh-test-db-sql.sh > fresh.sql` then `psql "$THROWAWAY_DB_URL" -f fresh.sql` (expect exactly one error, from migration 086; harmless — migration 089 repairs it and the end state is correct).
3. `psql "$THROWAWAY_DB_URL" -v ON_ERROR_STOP=1 -f supabase/pending-104/104_competition_teams.sql` then run `104_POSTFLIGHT_verify_readonly.sql` (no FAIL rows).
4. In the throwaway project's Authentication → Users add five users with one shared password (auto-confirm): organiser, scorer, member, outsider, other-organiser. Put their UUIDs into the psql variables of `docs/package4-m2/supabase-integration/fixture_seed.sql` and run it; save its last line as `fixture.json` (edit the placeholder emails to the real ones).
5. `ALLOW_TEST_PROJECT=yes SUPABASE_TEST_URL=… SUPABASE_TEST_ANON_KEY=… PRODUCTION_SUPABASE_URL=<live url> TEST_PASSWORD=… FIXTURE_JSON=./fixture.json node docs/package4-m2/supabase-integration/run_supabase_checks.mjs` (run after `npm install`). It refuses to run against the live URL. Send me the output.

## Production — staged rollout (only after both gates pass)
Stage A — **deploy the V8 app with Ambrose OFF** [APPROVAL]. Keep your normal clean replacement: keep the previous release as the rollback copy, remove the old source, copy in this package, build, deploy. Do **not** set any `NEXT_PUBLIC_AMBROSE_*` variable. Run the Stableford regression (checklist 4), and open the app on a phone that already used the previous release (this exercises the one change that applies to every device even with Ambrose off: an additive local-database upgrade for the offline queue). Nothing Ambrose is visible and no Ambrose database table is read or written.

Stage B — **database** [APPROVAL]
1. Backup. Dashboard → Project Settings → Database → Backups: note the latest backup / point-in-time recovery if your plan has it. Then take your own copy: `pg_dump "$PROD_DB_URL" --no-owner --no-privileges -Fc -f teeinitup_before_104_YYYY-MM-DD.dump`. Run `docs/package4-prodtest/catalog_snapshot_readonly.sql` and save the output as BEFORE.
2. Preflight: run `supabase/pending-104/104_PREFLIGHT_readonly.sql`; every row must say `ok`. Send me the grid.
3. Apply: SQL editor → new query → paste all of `supabase/pending-104/104_competition_teams.sql` → Run once. It is a single transaction; if anything fails nothing is applied. "does not exist, skipping" notices are normal.
4. Postflight: run `104_POSTFLIGHT_verify_readonly.sql` — no FAIL rows, policy count 8. Run the catalog snapshot again as AFTER and send me BEFORE and AFTER (expected: only additions).

Stage C — **private test event**. In the app create a new event (e.g. "AMBROSE TEST – do not use"); copy its id from the address bar (`/trips/<this-uuid>/…`). Use it for nothing else.

Stage D — **switch Ambrose on for that event only** [APPROVAL]. In Vercel (Production environment) add `NEXT_PUBLIC_AMBROSE_ENABLED=true` and `NEXT_PUBLIC_AMBROSE_PRODUCTION_TRIP_IDS=<that uuid>` (several ids: comma-separated). Leave `NEXT_PUBLIC_APP_ENV` as it is. Redeploy (the values are fixed at build time). Every other event is unchanged.

Stage E — Darren and Alex test (checklist below).

## Turning it off / going back
* **Hide Ambrose immediately:** remove `NEXT_PUBLIC_AMBROSE_ENABLED` in Vercel and redeploy. The screens disappear and the server answers 404 to Ambrose requests. Data stays.
* **Previous application:** restore the kept previous release and redeploy. This does **not** undo the database.
* **Database:** 104 is additive, so leaving it in place is harmless. To remove it entirely (this deletes Ambrose test data only): run `supabase/pending-104/104_ROLLBACK.sql`, then the postflight/catalog snapshot to confirm. Tested on a replay: the catalog returned exactly to its pre-104 state.

## Testing checklist (organisers, on phones)
1. Open the test event only. My HQ → upcoming round → Set up Ambrose → Two-person (repeat with Four-person on a second round). No handicaps needed.
2. Create/name teams, reorder pairs, save, confirm a scorer per team. Confirm & Release. Try changing a team: it must refuse and offer Reopen (reason required). Begin Round (must work with no handicaps).
3. Each scorer on their own phone: My Golf → team scorecard; enter all holes. Try airplane mode for a few holes and reconnect; refresh mid-round; a second phone on the same team.
4. **Stableford regression (in a separate ordinary event or round, not the test event):** create a normal round, begin it, score holes as a player and as organiser, close it, check leaderboard. It must behave as before.
5. Query a score; organiser resolves. Record a No Return; resolve both ways. Organiser changes a hole while a scorer is offline.
6. Leaderboard order and ties (T3). My HQ shows "x of y teams finished", one Close round. Close it.
7. Open the old individual-scorecard link for the Ambrose round: it must not accept scores.
8. Send one consolidated list of anything that felt wrong.
