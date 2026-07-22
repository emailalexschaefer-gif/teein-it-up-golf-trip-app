# Sprint 5B — Deployment Notes

## Migration order

Run in order — all are idempotent (safe to re-run):

```
016_begin_round_function.sql        (Sprint 5A — already deployed)
017_sprint5b_group_scoring.sql      (new)
018_sprint5b_hole_round_check.sql   (new)
```

Verify after running:

```sql
select polname, polcmd from pg_policies where tablename = 'score_entries';
-- Expect exactly:
--   "Members: view scores"          r
--   "Group: insert scores"          a   (INSERT)
--   "Players: update group scores"  w   (UPDATE)
--   "Organisers: update scores"     w   (UPDATE)

select proname from pg_proc where proname in
  ('same_playing_group','hole_matches_scorecard_round');
-- Expect both present
```

No table structure changed — this is RLS-policy-only. No data migration, no backfill needed.

## Environment / config

No new environment variables. No new dependencies were added — `dexie` and
`uuid` were already in `package.json` from Sprint 5A; this sprint wires the
existing Dexie queue into the scoring screen rather than adding anything new.

## What actually changed (files)

**New migrations**
- `supabase/migrations/017_sprint5b_group_scoring.sql`
- `supabase/migrations/018_sprint5b_hole_round_check.sql`

**API**
- `src/app/api/scores/route.ts` — group-scoring permission model, fixed
  edit/upsert bug, idempotent-by-client_id short-circuit
- `src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts` —
  now returns `score_entries` per scorecard

**Server component**
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` — resolves the
  caller's playing group; organisers additionally get every group plus a
  default-group calculation (own group if playing, else first group)

**Client component**
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/ScoreSessionShell.tsx` —
  group-scoring player switcher, organiser group switcher, hydration merged
  with the offline queue, resume-position calculation, rapid-tap guard,
  live leaderboard removed → neutral Group Progress panel

**Offline queue (existing infra, now actually used + hardened)**
- `src/lib/db/dexie.ts` — `queueScoreEntry` now dedupes by
  (scorecardId, holeId); `markEntrySynced` now takes a snapshot gross score
  so a mid-flight edit can't be falsely marked synced; new
  `getQueuedEntriesForScorecards` helper for hydration
- `src/lib/db/sync.ts` — passes the gross-score snapshot through

**Docs**
- `TESTING.md` — Sprint 5B section rewritten with the verification report
- `DEPLOYMENT_NOTES.md` — this file

## Build verification — read this before merging

I do not have network access in this working environment, so I could not
run `npm install` or a real `npm run build` against this project — the
registry request was rejected (403, no egress configured here). This is a
genuine limitation of my sandbox, not a claim that the build has been run.

What I did instead, to get as close to real verification as I reasonably
could without network access:

- Full manual read-through of every changed file
- Brace/paren balance checks on every changed file
- Cross-referenced every changed function signature against every call site
  (dexie.ts ↔ sync.ts ↔ ScoreSessionShell.tsx) by hand
- Isolated the new hydration-merge logic (the trickiest part — nested
  generic Records keyed by scorecard id and hole number) into a standalone
  `.ts` file with identical type declarations and ran it through a locally
  available `tsc` in strict mode with no project noise — **zero errors**
- Ran `tsc` directly against the changed files with relaxed settings to
  catch outright syntax errors (unmatched braces, malformed JSX, etc.).
  It reported only "cannot find module 'react'/'next'" and cascading
  downstream errors, which is expected without `node_modules` present —
  not a signal of a real bug in this codebase

**This is not a substitute for the real thing.** Please run, and report
back if anything fails:

```bash
npm install
npm run build
npm run lint
npx tsc --noEmit
```

Per your own build-discipline principle: run to zero errors before
shipping, not just until the first one clears.

## Manual / runtime testing — also not something I could do here

I have no way to run this app against a live Supabase instance or a real
browser from this sandbox, so I have not personally executed the "Manual
Testing" checklist you asked for (player scoring, organiser switching,
offline/reconnect, rapid double-tap, concurrent groups, invalid access).
The `TESTING.md` Sprint 5B section has an exact step-by-step sequence for
every one of those cases — that still needs to be run by you or Daz against
the real app before this is considered verified. I'd rather say that
plainly than report results I don't actually have.
