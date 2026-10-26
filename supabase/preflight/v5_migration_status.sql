-- v5_migration_status.sql -- READ-ONLY. One row per migration this release cares about.
-- Run in the Supabase SQL Editor. It writes nothing. A row says what the ACTUAL database contains, not what the repo has.
--   INSTALLED -> do NOT run that migration.   MISSING -> run that file (in the order shown).   PARTIAL -> stop and send me the output.
WITH
col AS (SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'),
tbl AS (SELECT table_name FROM information_schema.tables WHERE table_schema='public'),
fn  AS (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
em_cons AS (SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%recipient_type%'),
s AS (
  SELECT 1 AS ord, '097_round_cancellation.sql' AS migration,
    CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='round_status_events')
          AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                      WHERE n.nspname='public' AND t.relname='rounds' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%cancelled%' AND pg_get_constraintdef(c.oid) ILIKE '%upcoming%') THEN 'INSTALLED'
         WHEN NOT EXISTS (SELECT 1 FROM tbl WHERE table_name='round_status_events') THEN 'MISSING' ELSE 'PARTIAL' END AS status
  UNION ALL SELECT 2, '098_shared_leaderboards.sql',
    CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='shared_leaderboards') THEN 'INSTALLED' ELSE 'MISSING' END
  UNION ALL SELECT 3, '099_event_outcome.sql',
    CASE (SELECT count(*) FROM col WHERE table_name='trips' AND column_name IN ('ended_early','champion_declared')) WHEN 2 THEN 'INSTALLED' WHEN 0 THEN 'MISSING' ELSE 'PARTIAL' END
  UNION ALL SELECT 4, '101_round_arrangements_release.sql',
    CASE ((SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at'))
        + (SELECT count(*) FROM tbl WHERE table_name IN ('round_arrangements','round_release_log'))
        + (SELECT count(*) FROM fn WHERE proname='release_round_arrangements'))
      WHEN 5 THEN 'INSTALLED' WHEN 0 THEN 'MISSING' ELSE 'PARTIAL' END
  UNION ALL SELECT 5, '102_event_messages_recipient_all_event.sql',
    CASE WHEN NOT EXISTS (SELECT 1 FROM em_cons) THEN 'PARTIAL'
         WHEN EXISTS (SELECT 1 FROM em_cons WHERE def NOT ILIKE '%''all''%') THEN 'MISSING' ELSE 'INSTALLED' END
  UNION ALL SELECT 6, '103_event_messages_read_all_and_event.sql',
    CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_messages' AND cmd IN ('SELECT','ALL') AND qual ILIKE '%''all''%' AND qual ILIKE '%''event''%') THEN 'INSTALLED'
         WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_messages' AND cmd IN ('SELECT','ALL')) THEN 'MISSING'
         ELSE 'PARTIAL' END
)
SELECT ord AS run_order, migration, status,
       CASE status WHEN 'INSTALLED' THEN 'do not run' WHEN 'MISSING' THEN 'run this file (only this one, in order)' ELSE 'STOP - send me this output' END AS action
FROM s ORDER BY ord;
