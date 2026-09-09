# P0 PRODUCTION MIGRATION FAILURE -- ROOT CAUSE + RECOVERY
## Delivery Report

**Build/test caveat, unchanged from every prior round, and directly
relevant here:** no network access, no live database connection --
I cannot execute the failed migration, the recovery migration, or the
verification queries myself. Everything below is derived from reading
the actual source of every relevant migration directly, not from
assumption. Migration 083 passes structural sanity checks (balanced
parens, even dollar-quote pairs). Full test suite: **440/440 pass** --
the +7 over the prior total is a new, dedicated contract-test suite
for this exact fix.

---

## 1. ROOT CAUSE

Confirmed by reading the real, current trigger and function definitions
directly (migration 037, later narrowed by migration 045) -- not
assumed from your report:

side_comps_lock_after_start fires BEFORE INSERT OR UPDATE ON
public.side_comps (migration 045 already narrowed this from 037's
original INSERT OR UPDATE OR DELETE, for an unrelated cascade-delete
bug -- confirmed this is the current, correct scope before touching
anything). The function it calls, enforce_round_config_lock(), has no
concept of which columns changed -- it only checks whether the round's
status is 'upcoming', and raises unconditionally if not.

Migration 080's historical backfill calls finalize_side_comp_winners()
for every completed round, which does UPDATE public.side_comps SET
official_winner_entry_id = ..., finalised_at = now() WHERE .... To the
trigger, this is indistinguishable from an organiser trying to edit
competition configuration after play started -- exactly the scenario
it exists to block. This is not a bug 080 introduced; it's 080 being
the first thing that ever legitimately needed to write to side_comps
after a round starts.

**Also confirmed:** enforce_round_config_lock() is used by exactly one
trigger, on exactly one table (side_comps) -- searched every migration
for other callers before touching its behaviour, so this fix cannot
have any effect anywhere else in the schema.

## 2. CURRENT PRODUCTION-STATE VERIFICATION SQL

Provided as a separate, standalone file:
VERIFICATION_QUERIES_PRODUCTION_STATE_2026-09-09.sql -- six read-only
queries covering exactly your four numbered questions plus two pieces
of supporting context (the trigger's current live definition, and
which rounds are actually 'completed' right now). Safe to run any
number of times, in any order, before touching anything else.

**I cannot tell you the actual result of these queries** -- I have no
live database connection. What I can tell you: migration 083 (below)
is designed to reach the correct end state regardless of what they
return, so you don't need the answer before proceeding -- only before
you want to understand what actually happened, which is a reasonable
thing to want on its own.

## 3. SAFE RECOVERY SEQUENCE

1. (Optional but recommended) Run the verification queries, to
   understand what actually happened.
2. Run 083_side_comp_lock_allows_result_fields.sql (new).
3. Run 081_my_golf_summary_official_side_game_wins.sql (unchanged from
   before -- never touches side_comps rows directly, so it was never
   at risk from this bug).
4. Run 082_side_comp_winner_hardening.sql (unchanged from before).

**Why 083 must run before 081/082, and why 082 specifically cannot run
before 083:** 082 itself adds get_my_golf_summary's self-healing step,
which also calls finalize_side_comp_winners() -- if 082 were applied
before the trigger is fixed, the very first My Golf read for any
player with a completed round would hit this exact same error. 083
must be first.

## 4. CORRECTED MIGRATION SQL

083_side_comp_lock_allows_result_fields.sql -- full contents in the
delivered zip. Does four things, all idempotent:
1. Redeclares enforce_round_config_lock() with the fix (below).
2. Redeclares the trigger, matching migration 045's current
   INSERT OR UPDATE-only scope exactly -- DELETE is not reintroduced,
   confirmed directly against 045's own text before writing this.
3. Idempotently ensures 080's schema exists (ADD COLUMN IF NOT
   EXISTS, CREATE OR REPLACE FUNCTION) -- safe whether 080 fully
   rolled back or partially persisted.
4. Retries the backfill -- the exact statement that failed before, now
   safe because the trigger fix is already in place by the time it
   runs.

## 5. EXACT ORDER + WHETHER 080 CAN SIMPLY BE RERUN

**080 should not simply be rerun.** As originally written, it would
fail at the exact same step, for the exact same reason -- the trigger
bug is still present until fixed. 083 supersedes 080's intent
entirely rather than being a patch applied on top of it: run
verification queries (optional) -> 083 -> 081 -> 082, and 080 itself
is never touched or rerun again.

## THE FIX ITSELF -- WHY THIS APPROACH, NOT A COLUMN WHITELIST

Per your explicit "if there's a safer architecture, use it and
explain why": rather than enumerating every configuration column
(name, comp_type, hole_number, description, enabled) and requiring
someone to remember to update that list if a future migration adds
another configuration column, the fix compares the entire row, with
only the two approved system-result fields subtracted out first via
Postgres's jsonb - text operator:

    (to_jsonb(NEW) - 'official_winner_entry_id' - 'finalised_at')
      = (to_jsonb(OLD) - 'official_winner_entry_id' - 'finalised_at')

If everything else is identical, the write is a pure result
finalisation and is allowed even on a started/completed round. Any
change to any other column -- including a hypothetical future one
nobody has written yet -- is still rejected exactly as before. This is
stronger than a whitelist, which would silently develop a gap the
moment someone added a new configuration column without also updating
this trigger.

TG_OP = 'UPDATE' gates the exemption to UPDATE only -- confirmed:
INSERT on a non-upcoming round still fails unconditionally (you cannot
add a new Side Game once a round has started), unchanged from the
original rule.

## BACKFILL

Once the trigger fix is in place, finalize_side_comp_winners() is
called again for every 'completed' round -- the exact statement that
failed before. Competitions with no verified leader are simply never
present in the function's own winning_entry CTE, so they are never
updated and remain NULL, unchanged from 080's original design --
re-verified this pass, not re-derived.

## TESTS ADDED

New file, sideCompLockFix.test.ts -- 7 source-scanning contract tests
against the real recovery migration:
1. The trigger function subtracts exactly the two approved fields, no others.
2. A configuration-only change still reaches the RAISE EXCEPTION --
   the exemption is a genuine early-return, not a replacement of the
   lock.
3. The exemption only ever applies to UPDATE, never INSERT.
4. The redeclared trigger matches 045's current INSERT OR
   UPDATE-only scope -- DELETE is not reintroduced.
5. finalize_side_comp_winners's idempotency guard is unchanged in
   the recovery migration.
6. Every schema statement in 083 is genuinely idempotent (IF NOT
   EXISTS/OR REPLACE/IF EXISTS).
7. 083 never touches 082's separate integrity trigger at all --
   confirmed by absence, meaning a wrong-competition
   official_winner_entry_id is still rejected by 082's own trigger
   even once 083's config-lock relaxation is applied. Both triggers
   are independent BEFORE triggers on the same table; a write must
   pass both to succeed, so relaxing one cannot weaken the other.

All 7 pass. Full suite: **440/440 pass** -- 289 pure-function scoring
+ 61 highlights + 8 analytics + 7 profile + 21 SQL-scanning migration
tests (14 existing + 7 new) + 54 trips.

## FILES CHANGED

- `supabase/migrations/083_side_comp_lock_allows_result_fields.sql` (new)
- `VERIFICATION_QUERIES_PRODUCTION_STATE_2026-09-09.sql` (new -- standalone, not a migration)
- `src/lib/scoring/sideCompLockFix.test.ts` (new -- 7 tests)

080_side_comp_official_winners.sql and 081/082 are unchanged -- 080 is
superseded by 083 rather than edited or deleted, so the actual history
of what was attempted stays intact rather than being rewritten.

## STILL REQUIRING LIVE DB VALIDATION

Everything -- nothing here has touched a live Postgres instance. Most
important specifically for this recovery:
1. The verification queries' actual results.
2. That 083 genuinely applies cleanly against the real current
   production state, whatever it turns out to be.
3. That the backfill genuinely completes this time, and that
   SELECT COUNT(*) FROM side_comps WHERE official_winner_entry_id IS
   NOT NULL afterward matches what you'd expect from your own
   completed rounds' actual Side Game results.
4. Then 081 and 082 run cleanly in sequence.
5. The full multi-round acceptance test from the prior two briefs.
