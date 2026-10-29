# Real-Supabase test setup (NON-PRODUCTION ONLY) — prepared, not run

Nothing here has been executed: this sandbox has no Supabase project, credentials or network.

## What Alex supplies
1. A **new, empty Supabase project** used only for testing (never the live one). Its URL, anon key and service-role key (the service-role key is only needed to run the app's own server routes against it).
2. A hosting target for the test build on real phones (e.g. a Vercel preview) with these environment variables pointing at the **test** project:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus `NEXT_PUBLIC_AMBROSE_ENABLED=true`. Leave `NEXT_PUBLIC_APP_ENV` unset or `staging` (never `production`).
3. A machine with npm access for `npm ci`, `tsc --noEmit`, lint and `next build`.

## Order of operations (each only after the previous passes)
1. Build the shipped app from the existing migrations on the test project: apply the repo's migrations in order (000_combined_fresh_database.sql or the numbered set — whichever the repo's own deployment notes use), **then** `docs/package4-m1/PROPOSED_104_competition_teams.sql`. Never run any of this against production.
2. In the deployed test app create a test event through the normal UI with five accounts: organiser, scorer, member, outsider (not in the event), and a second event's organiser. Create one round, four playing groups of four players.
3. Write `fixture.json` (`tripId`, `otherTripId`, `roundId`, `entryId`, `holeIds[]`, `users{organiser,scorer,member,outsider,otherOrganiser}={email,id}`) from the test project's tables. Configure Ambrose on the round and save one team through the app so an `entryId` and holes exist.
4. `SUPABASE_TEST_URL=… SUPABASE_TEST_ANON_KEY=… ALLOW_TEST_PROJECT=yes PRODUCTION_SUPABASE_URL=<live url> TEST_PASSWORD=… FIXTURE_JSON=./fixture.json node run_supabase_checks.mjs`
   (the script refuses to run unless `ALLOW_TEST_PROJECT=yes` and the URL differs from the production URL).
5. Fix anything it finds before any phone testing. Column names in its direct-table RLS probes are my assumptions about the 104 schema and may need adjusting on first run.


## Added 29 Oct
`fixture_seed.sql` (this folder) creates the fixture and prints `fixture.json` for a THROWAWAY project; `scripts/make-fresh-test-db-sql.sh` builds the one-file schema for a brand-new throwaway database; migration 104 now lives in `supabase/pending-104/` (identical copy kept in docs/package4-m1). The full ordered procedure is `PRODUCTION_TEST_RUNBOOK_V8.md` at the package root.
