-- =============================================================================
-- verify_trip_information_column.sql
-- =============================================================================
-- Fastest way to confirm the Trip Information save-failure hypothesis:
-- checks directly whether the trip_information column actually exists
-- on trips in production, without needing to trigger a live save
-- attempt and read the temporary debug field first.
-- =============================================================================

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trips'
  and column_name = 'trip_information';

-- Expected if migration 034 was applied: one row —
--   trip_information | text | YES
-- If this returns zero rows, migration 034 was never applied, and that
-- is the confirmed root cause. Fix: run
-- supabase/migrations/034_trip_information.sql (or the standalone
-- supabase/trip_information_deploy.sql) against production. Both are
-- idempotent (ADD COLUMN IF NOT EXISTS) — safe to run regardless.
