# URGENT SECURITY CHECK — SUPABASE RLS WARNING
## Audit Report — 1 Sep 2026

**Nothing has been deployed. This migration has not been applied to
any database.** Per the explicit instruction, this report is delivered
before the fix is considered final, for review before it's added to a
deployment candidate.

**Method:** extracted every `CREATE TABLE public.X` and every `ALTER
TABLE public.X ENABLE ROW LEVEL SECURITY` statement across the
complete migration history (000 through 071 — all 72 migration files),
and diffed the two lists. Also checked for `DISABLE ROW LEVEL
SECURITY` (a table re-disabled after being enabled) and for views
(a separate Supabase linter category). **One caught mistake worth
noting:** my first pass used a table-name regex that didn't allow
digits, which truncated one table's name mid-match and produced a
false "no gap found" result — caught by re-checking the match against
the real migration text before concluding anything, not assumed
correct on the first pass.

---

## A. EXACT TABLE(S) SUPABASE IS LIKELY FLAGGING

**`public.side_comps_pre_sprint9_backup`** — the only table across the
entire 72-file migration history with no matching RLS-enable
statement anywhere. Every other table in this schema (28 total) has
one.

## B. WHY RLS IS CURRENTLY DISABLED

Created ad-hoc, mid-migration, in `037_side_competitions_powerplay.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.side_comps_pre_sprint9_backup
  (LIKE public.side_comps INCLUDING ALL);
```

A one-time safety net — that migration tightened `side_comps`'
constraints (making `round_id` `NOT NULL`, adding a new
`(round_id, comp_type, hole_number)` uniqueness rule) and needed
somewhere to preserve any rows that would otherwise violate the new
rules, rather than silently deleting them, per that migration's own
explicit "preserve data if there is any uncertainty" comment.

**The root mechanical cause:** `LIKE ... INCLUDING ALL` copies
columns, defaults, constraints, and indexes — but Postgres's
`INCLUDING ALL` clause does **not** copy RLS enablement or policies;
those must always be set explicitly and separately, regardless of what
the source table has. `side_comps` itself has always had RLS enabled
(confirmed: immediately after its own `CREATE TABLE` in
`000_combined_fresh_database.sql`). The backup table simply never
received the same explicit treatment, since it was created as an
emergency data-preservation mechanism, not through this project's
normal create-then-secure table pattern.

## C. WHAT DATA IS EXPOSED

The exact `side_comps` column set (via `LIKE ... INCLUDING ALL`):
`id, trip_id, round_id, name, comp_type, hole_number, description`.

**No player names, scores, results, emails, or credentials** — those
live in `side_comp_entries`, `side_comp_results`, and `profiles`,
confirmed separately to already have RLS enabled with member-scoped
policies. The exposure here is limited to side-competition
*configuration* rows (which trips exist, their side-game names/types/
holes) — a real but low-severity information disclosure, not
player-personal data.

**Whether this table currently contains any rows at all cannot be
determined from this sandbox** — no live database connection exists
here. Per the originating migration's own design, it should only be
populated if genuinely orphaned or duplicate rows existed in
`side_comps` at the exact moment that migration ran, and empty
otherwise. Flagged explicitly rather than assumed either way.

**A related observation, not a security finding:** `src/types/database.ts`
(the auto-generated schema-reflection file) doesn't include this table
— but it's also missing tables from migrations 055 and 066, confirming
it's simply stale/not regenerated recently, not evidence the table
doesn't exist in production. Supabase's own warning is a live signal
from the real database, which is stronger evidence than a stale local
types file either way.

## D. WHAT OPERATIONS ANON/AUTHENTICATED CLIENTS CAN CURRENTLY PERFORM

Full read, and — since no per-table `GRANT`/`REVOKE` was ever issued
for this table specifically (confirmed by search) — likely write/
delete too, via Supabase's standard schema-level default grants. This
matches the warning email's own wording exactly: "read, edit, and
delete all data in this table," via the PostgREST API at
`/rest/v1/side_comps_pre_sprint9_backup`, to anyone who knows the
project URL, entirely unauthenticated.

## E. WHICH APP FLOWS DEPEND ON THIS TABLE

**None.** A full search of the entire `src/` tree returns zero
references anywhere — no route, no component, no query. This table is
written to exactly once, inside migration 037 itself (and only
conditionally, if the described edge cases existed at that moment),
and never read by the running application at all. Specifically
confirmed **not** to affect: Start Scoring, Digital + Paper/shared-
device scoring, scorecards, scores, round_markers, trip_members,
trip_groups, Side Games/side_comp_entries, verification, Moments,
Makers & Breakers, Event Stories, the join/invitation flow, or the
Course Library — none of those reference this table in any way.

## F. PROPOSED POLICIES

**None.** RLS enabled with zero policies is the correct, deliberate
choice here — every role PostgREST serves (`anon`, `authenticated`) is
default-denied, while `service_role` (what this app's own admin client
and every migration already use) continues to bypass RLS entirely,
exactly as it always does in Supabase regardless of policies. Since
nothing in the running application ever needs to query this table,
this is the smallest possible fix — not a policy granting some narrow
legitimate access, because there genuinely is none to grant. This
matches the explicit "avoid broad policies... unless the data is
genuinely intended to be globally accessible" instruction in the
opposite direction: the safest policy for data nothing needs to touch
is no policy at all.

## G. REGRESSION RISK

**None identified.** This table has no foreign-key dependents, no
triggers, and (per E above) no application code path touches it at
all. Enabling RLS with no policies cannot break anything currently
working.

---

## FIX IMPLEMENTED

**`supabase/migrations/072_enable_rls_side_comps_pre_sprint9_backup.sql`**
(new) — one statement:

```sql
ALTER TABLE public.side_comps_pre_sprint9_backup ENABLE ROW LEVEL SECURITY;
```

Numbered 072, after the two already-pending migrations (070, 071) —
neither renumbered nor overwritten, confirmed by direct inspection
before creating this file.

## FILES CHANGED

- `supabase/migrations/072_enable_rls_side_comps_pre_sprint9_backup.sql` (new)

**No application code changed** — this is a pure database-security fix
with zero surface area in the running app, per finding E.

## TEST RESULT

**400/400 pass** (274 pure-function scoring + 5 SQL-scanning + 59
highlights + 8 analytics + 54 trips) — identical to the prior round's
total, confirmed via a fresh, complete run. No regression possible or
found, since no application code changed.

## RECOMMENDED PRODUCTION MIGRATION ORDER

1. `070_begin_round_writes_group_id.sql`
2. `071_fix_side_comp_verifier_group_scoping.sql`
3. `072_enable_rls_side_comps_pre_sprint9_backup.sql`

All three are independent of each other (070/071 concern application
logic; 072 concerns a completely unrelated, unused table) — this order
simply preserves the sequence they were found and verified in, and
matches the numbering already in place.

---

## WHAT STILL NEEDS YOUR CONFIRMATION

1. **This migration has never run against a live database.** Please
   confirm it applies cleanly, and that the Supabase security advisor
   warning clears afterward.
2. Consider checking whether `side_comps_pre_sprint9_backup` actually
   contains any rows in production (a simple `SELECT count(*)` is
   enough) — if it does, and those rows are genuinely orphaned/
   duplicate leftovers with no ongoing purpose, deleting the table
   entirely (rather than just securing it) may be worth considering in
   a future, separate, deliberate cleanup pass — not bundled into this
   security fix.
3. `src/types/database.ts` is confirmed stale (missing tables from at
   least migrations 055, 066, and presumably 072). Not a security
   issue, but worth regenerating at some point for accuracy — flagged
   here since I noticed it during this audit, not because it's in
   scope for this fix.
