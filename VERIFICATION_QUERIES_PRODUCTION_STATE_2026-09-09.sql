-- =============================================================================
-- VERIFICATION QUERIES -- run these FIRST, before any recovery migration.
-- Read-only. Safe to run any number of times, in any order.
-- =============================================================================

-- 1. Does side_comps currently contain official_winner_entry_id?
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'side_comps'
  AND column_name = 'official_winner_entry_id';
-- Expect either 1 row (column exists -- some part of 080 persisted)
-- or 0 rows (column does not exist -- 080 fully rolled back).

-- 2. Does side_comps currently contain finalised_at?
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'side_comps'
  AND column_name = 'finalised_at';

-- 3. Does finalize_side_comp_winners() currently exist?
SELECT proname, pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'finalize_side_comp_winners';
-- Expect either 1 row (function exists) or 0 rows (does not exist).

-- 4. Did any historical side_comp rows receive official winners?
-- (Only run this if query 1 above confirmed the column exists --
-- otherwise this itself will error with "column does not exist.")
SELECT id, trip_id, round_id, comp_type, official_winner_entry_id, finalised_at
FROM public.side_comps
WHERE official_winner_entry_id IS NOT NULL
ORDER BY finalised_at DESC;
-- Expect 0 rows in the most likely scenario (full rollback). Any rows
-- returned here confirm partial application -- not a problem, since
-- migration 083's idempotency guard means re-running the backfill
-- will simply skip these (already non-NULL) and only fill in whatever
-- is still missing.

-- 5. (Supporting context) What is the CURRENT definition of the lock
--    trigger and its function, right now, before the fix is applied?
SELECT tgname, pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgrelid = 'public.side_comps'::regclass AND NOT tgisinternal;

SELECT pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'enforce_round_config_lock';

-- 6. (Supporting context) Which rounds are actually 'completed' right
--    now -- these are exactly the rounds migration 083's backfill will
--    attempt to (re-)finalise Side Games for.
SELECT id, trip_id, name, status
FROM public.rounds
WHERE status = 'completed'
ORDER BY id;
