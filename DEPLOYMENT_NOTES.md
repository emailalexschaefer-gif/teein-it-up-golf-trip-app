# Sprint 5B — Deployment Notes

## Latest delivery: Fix — `individual` Mode Was Not Genuinely Distinct

Review correctly caught that `individual` and `self_and_marker` modes
behaved identically — `individual` mode could still accept a marker-role
write if a stray `round_markers` row existed. Fixed across every layer:
new pure/tested `captureMode.ts`, `/api/scores` rewired to use it, new
migration `023_individual_mode_permission_fix.sql` for the DB side,
`autoGenerateMarkers` no longer seeds markers for `individual` mode,
`page.tsx` never queries `round_markers` for it, and
`SelfMarkerScoreShell.tsx` gates every marker-related UI behaviour on an
explicit `requiresMarker` flag. Full detail in TESTING.md. **82/82 domain
tests passing** (15 new, covering all three modes explicitly).

## Latest delivery: Self + Marker Scoring Model

Changed the default scoring model from "one scorer for the whole group" to
"each player records their own score and one nominated marker partner's
score" (MiScore-style). Full detail in TESTING.md's "Self + Marker Scoring
Model" section. Summary:

- New migration `022_marker_scoring_model.sql` — `round_markers` table,
  `capture_role` on `score_entries`, nullable `gross_score` for pick-ups,
  `score_capture_mode` on `rounds`.
- New domain modules: `markerAssignment.ts` (pairing logic), `comparison.ts`
  (matched/mismatch state machine) — both pure, both fully unit tested.
- New UI: `SelfMarkerScoreShell.tsx` (two-card hole scoring + end-of-round
  reconciliation), `markers/` review page (organiser-only).
- `/api/scores` and the Dexie offline queue both updated to be
  `capture_role`-aware — self and marker entries are fully independent.
- The old group-scorer model is NOT deleted — `rounds.score_capture_mode =
  'group_scorer'` still renders the original `ScoreSessionShell` unchanged.

## Exact Supabase deployment order (cumulative)

```
016_begin_round_function.sql                    (already deployed)
017_sprint5b_group_scoring.sql                  (already deployed)
018_sprint5b_hole_round_check.sql               (already deployed)
019_scoring_architecture_stableford_fix.sql     (already deployed)
020_begin_round_transaction_integrity.sql       (already deployed)
021_round_scorecard_diagnostics_and_repair.sql  (already deployed)
022_marker_scoring_model.sql                    (already deployed)
023_individual_mode_permission_fix.sql          (new this delivery)
```

After running 023, verify:
```sql
select proname from pg_proc where proname = 'score_entry_capture_allowed';
-- Manual check: with a round in 'individual' mode, confirm a marker-role
-- INSERT is rejected regardless of any round_markers data.
```

## Build verification (this delivery)

Ran the full scoring-domain test suite (including the 16 new marker/
comparison tests) via the same sandbox method as prior deliveries — compiled
with a globally available `tsc` (no `node_modules` needed, this module has
zero npm dependencies) and executed with `node --test`. **67/67 passing.**

Also ran a lenient `tsc` syntax pass over every new/changed file. No real
errors — only the same expected "cannot find module" noise from missing
`node_modules` seen in every prior delivery, confirmed by checking that the
handful of downstream type errors it produced (e.g. `err` typed `unknown`
inside a catch block) disappeared when isolated with proper path resolution.

**I still could not run `npm install`, `npm run build`, or `npm run lint`**
against the actual Next.js project — same network limitation as every prior
turn. Please run those before treating this as production-ready.

## Existing live rounds — do they need recreation?

**No recreation needed.** Migration 022 is purely additive: existing
`score_entries` rows default to `capture_role = 'self'`, keeping their
original meaning. Rounds already in progress simply have no
`round_markers` rows until an organiser visits the marker review screen and
clicks "Auto-assign" for each group — or the organiser can set that specific
round's `score_capture_mode` to `'group_scorer'` if a marker retrofit isn't
wanted for a round already underway. New rounds begun after this deploy get
markers seeded automatically.

## What actually changed (files) — this delivery

**New migration**
- `supabase/migrations/022_marker_scoring_model.sql`

**New domain logic (pure, tested — 16 new tests, 67 total passing)**
- `src/lib/scoring/markerAssignment.ts` + `.test.ts`
- `src/lib/scoring/comparison.ts` + `.test.ts`

**New UI**
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/markers/page.tsx`
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/markers/MarkerReviewClient.tsx`

**New API**
- `src/app/api/trips/[tripId]/rounds/[roundId]/markers/route.ts` (GET/POST)

**Updated**
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` — branches on
  `score_capture_mode`; self_and_marker/individual → `SelfMarkerScoreShell`,
  group_scorer → the original `ScoreSessionShell` (untouched)
- `src/app/api/scores/route.ts` — `capture_role` param, mode-aware marker
  permission check, upsert target widened to include `capture_role`
- `src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts` — auto-seeds
  marker assignments right after a round begins
- `src/lib/db/dexie.ts` — v2 schema (`captureRole` indexed), dedupe key
  widened, upgrade path backfills old rows to `'self'`
- `src/lib/db/sync.ts` — sends `capture_role`, compares gross+pickup state
  before marking synced
- `src/types/app.ts` — `OfflineScoreEntry.captureRole`, `grossScore` now
  nullable
- `src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts` and
  `page.tsx` — `score_entries` embeds now also select `capture_role` and
  `entered_by`

## Environment / config (this delivery)

No new environment variables for this delivery.

## Critical fixes (previous delivery — "No scorecard found" + logo)

1. **"No scorecard found for this group"** — root cause was an invalid
   Supabase/PostgREST embed in `page.tsx` (`trip_members!inner(group_id)` on
   a table with no FK to `trip_members`), whose error was silently swallowed.
   Fixed by fetching `trip_members` separately and merging in application
   code. This was a read-path bug — existing round data is very likely fine;
   see migration 021's diagnostic query before assuming a repair is needed.
2. **Logo not loading on `(auth)` pages** — consolidated to one shared
   `BrandLogo` component at a stable `/public/brand/` path, used everywhere
   (landing/login/join, dashboard header, trip pages, scoring pages).
3. **Begin Round transaction integrity** — `begin_round()` now verifies
   hole/scorecard counts and group mapping post-insert and rolls back with a
   specific error if anything is wrong, instead of silently reporting
   success on incomplete data.

## Exact Supabase deployment order (previous delivery)

Run in order — all are idempotent (safe to re-run):

```
016_begin_round_function.sql            (Sprint 5A — already deployed)
017_sprint5b_group_scoring.sql          (already deployed)
018_sprint5b_hole_round_check.sql       (already deployed)
019_scoring_architecture_stableford_fix.sql   (already deployed)
020_begin_round_transaction_integrity.sql     (new this delivery)
021_round_scorecard_diagnostics_and_repair.sql (new this delivery)
```

After running 020, verify:
```sql
select proname from pg_proc where proname in ('begin_round', 'repair_round_scorecards');
-- Expect both present
```

Then — before touching any code deploy — run the diagnostic query at the
top of migration 021 against your actual Round 1 `round_id`, to confirm
whether existing data needs the repair function or not (see TESTING.md).

## Exact Vercel deployment steps (previous delivery)

1. `git status` — confirm `public/brand/teein-it-up-logo.png` and
   `public/brand/teein-it-up-icon.png` show as new/tracked files, and that
   `public/logo-full.png` / `public/logo-app.png` show as deleted.
2. `git add -A` (or explicitly `git add public/brand/ src/ supabase/`) —
   **do not skip this**, this exact class of bug (asset on disk but not
   committed) has happened on this project before.
3. `git commit -m "fix: scoring page group resolution, begin_round integrity, unified brand logo"`
4. `git push` to the branch Vercel deploys from.
5. Once deployed, open the production URL and immediately check the
   Network tab per the logo test steps in TESTING.md before doing anything
   else — confirm both brand assets return 200.
6. If `SCORING_DEBUG=1` was set in Vercel's environment variables for
   diagnosis, remove it now that the fix is confirmed working — it logs
   user/trip/round ids and should not run permanently in production.

## Environment / config (previous delivery)

No new environment variables required for the fix itself.
`SCORING_DEBUG=1` is optional and diagnostic-only (see above) — leave unset
in normal operation.

## What actually changed (files) — previous delivery (critical fixes)

**New migrations**
- `supabase/migrations/020_begin_round_transaction_integrity.sql`
- `supabase/migrations/021_round_scorecard_diagnostics_and_repair.sql`

**Scoring page group resolution (Issue 1 fix)**
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` — removed the
  invalid embed, merges `trip_members` in application code, added guarded
  diagnostic logging, added `dataProblem` flag
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/ScoreSessionShell.tsx` —
  role-specific recovery messages instead of a flat dead end; logo added to
  header
- `src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts` — updated to
  the new structured RPC result shape; no longer falls back to direct
  inserts on a genuine validation error from the RPC

**Logo (Issue 2 fix)**
- `src/components/brand/BrandLogo.tsx` — new, single shared component
- `src/app/(auth)/BrandLogo.tsx` — deleted (was the old, non-shared version)
- `src/app/(auth)/layout.tsx` — uses the shared component, larger/responsive
- `src/components/layout/AppNav.tsx` — uses the shared component instead of
  duplicating the image markup
- `public/brand/teein-it-up-logo.png`, `public/brand/teein-it-up-icon.png` —
  new stable asset paths
- `public/logo-full.png`, `public/logo-app.png` — removed (nothing
  references them anymore)



## Migration order (prior delivery — Sprint 5B group scoring, already deployed)

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

## Environment / config (prior delivery)

No new environment variables. No new dependencies were added — `dexie` and
`uuid` were already in `package.json` from Sprint 5A; this sprint wires the
existing Dexie queue into the scoring screen rather than adding anything new.

## What actually changed (files) — prior delivery (Sprint 5B group scoring)

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
