# Teein' It Up — consolidated release: deployment guide (26 Oct 2026)

**Replacing the app with this ZIP does not change your Supabase database.** The database keeps its data and its current schema; only the SQL you run in the SQL Editor changes it. Nothing here has been applied or deployed by Claude.

## What is in the ZIP
- Package 1 (event presentation, sync fix), Package 2 (between-round release, handicap snapshot, cancel round, notifications, plus-handicap display, profile −10..54 input), Package 3 (score mismatch warning, Side Game arrival prompts, verification panel, Capture the Moment, clap tooltip, presentation fullscreen tests), and the Bug #2 fix (migration 102, clearer release errors, preflight checks 33/34).
- **Not included:** Finish Round Early (`release-p3`) and migration 100. Absent from the tree.
- Every historical migration file is still present. Being in the ZIP does **not** mean a migration should be run.

## Which migrations to run: only what production is missing
The repository cannot tell us what production has — the preflight can. Evidence so far, from your run on 26 Oct:
- Checks 30, 31, 32, 34 = OK; check 33 = FAIL (confirmed: both chat constraints reject `'all'`).
- The error you saw was the generic release failure, not "needs migration 101", so the release function exists and **101 is very likely installed**. This is an inference; preflight rows 70–74 confirm it. I have not seen those rows or rows 40–95.

| Migration | Needed? | How to tell |
|---|---|---|
| 097 round cancellation | only if check 40 or 41 = FAIL | preflight 40/41 |
| 098 shared leaderboards | only if check 60 is not OK | preflight 60 |
| 099 event outcome | only if check 61 is not OK | preflight 61 |
| 101 round arrangements/release | only if checks 70–73 show the objects absent (and 74 = OK). If all present: **do not repeat it.** If 74 = FAIL (partial install): stop and send me the output. | preflight 70–74, 80–83 |
| **102 chat constraints** | **Yes** — confirmed missing (check 33 FAIL) | preflight 33 |
| 029 / `event_messages_deploy.sql` | **No. Do not run.** 029 alone doesn't fix this; the deploy script would fail on existing `'event'` rows | — |
| 100 | No. Separate branch | — |

If more than one is needed, apply in numeric order (097 → 098 → 099 → 101 → 102). 102 only touches `event_messages` and does not depend on 101.

## Steps
1. **Recovery point.** Supabase → Database → Backups: confirm a recent backup or point-in-time recovery is available, and note the time. Do not assume one exists. If the dashboard shows an active incident affecting the database, wait.
2. **Read-only: record the current chat constraints in full** (I only saw them truncated), for your records and rollback:
   ```sql
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.event_messages'::regclass AND contype = 'c' ORDER BY conname;
   ```
3. **Read-only: run `supabase/preflight/101_preflight.sql` in full.** Fix any *other* FAIL (rows 40–95) before continuing; send me the output if unsure.
4. **Deploy the ZIP** (app only). Confirm the Vercel build passes — note I could not run `tsc`, lint or `next build` here (no registry access); Vercel's build is the first real compile.
5. **Apply 102** (only if still needed): paste the contents of `supabase/migrations/102_event_messages_recipient_all_event.sql` into the SQL Editor and run once. It's one transaction (`BEGIN … COMMIT`); if any statement fails nothing changes. The editor may warn about `DROP`; that is expected. Run it when no one is sending chat — the constraint swap briefly locks `event_messages`.
6. **Read-only: rerun the preflight.** Expect check 33 = **OK** (its detail now lists constraints containing `'all'`), 34 = OK, and no FAIL rows.
7. **Test on your existing two-player, two-round event:** Round 1 → Confirm & Release to Players. Expect "Released (version 1)", both players see their group/tee time/handicap, one Event Chat announcement, scoring still locked until Start Round. If it fails, send the `(ref …)` code.
8. Then the Package 2 phone checklist (six steps) and Package 3 on-course checks.

## Rollback
- **App:** redeploy the previous Vercel deployment (Vercel → Deployments → Promote the earlier one). The database changes below are backwards-compatible with the old app, since 102 only widens what is allowed.
- **Migration 102:** a failed run leaves nothing changed. After a successful run, don't revert unless required: reverting is possible only while no `'all'` message exists, and once a release has posted its announcement the old constraints would reject that row. Use the definitions saved in step 2 to re-add them if needed, or restore from the recovery point.

## Known limitations
- Not run here: `tsc`, lint, `next build` (no npm registry), real devices, live Supabase, the mismatch dialog inside the live scoring screen. All SQL was verified on a scratch PostgreSQL 16, not your Supabase.
- Bug #1 (Round 2 Side Game hole pars) is **not fixed** — see `BUG1_ROUND2_SIDEGAME_PARS_2026-10-26.md`.
