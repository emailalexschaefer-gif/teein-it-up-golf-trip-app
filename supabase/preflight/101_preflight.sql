-- =============================================================================
-- 101_preflight.sql  --  READ-ONLY production preflight for migration 101
-- =============================================================================
-- Paste into the Supabase SQL editor and run BEFORE applying 101_round_arrangements_release.sql,
-- and run it again AFTER applying 101 to verify. It only reads catalog views and data (SELECT only):
-- no INSERT/UPDATE/DELETE/DDL, no temp tables, nothing is created. Safe to run repeatedly.
--
-- It inspects the ACTUAL database. Repository migration files do not prove what exists in Supabase.
--
-- Result: one row per check.  status = OK | WARN | FAIL | INFO
--   FAIL  -> do NOT apply 101 (or, after applying, 101 is not healthy). Fix the prerequisite first.
--   WARN  -> read the detail; usually safe, sometimes needs an organiser action (see detail).
--   INFO  -> context only.
-- Independent of migration 100 (Package 3): nothing here requires or checks it.
-- =============================================================================

WITH
col AS (SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public'),
tbl AS (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'),
fn  AS (SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'),
rounds_ok AS (SELECT EXISTS (SELECT 1 FROM tbl WHERE table_name = 'rounds') AS has_rounds),
checks AS (

  -- ── prerequisites ─────────────────────────────────────────────────────────
  SELECT 10 AS ord, 'prereq: core tables (trips, trip_members, trip_groups, profiles, rounds)' AS check_name,
         CASE WHEN (SELECT count(*) FROM tbl WHERE table_name IN ('trips','trip_members','trip_groups','profiles','rounds')) = 5 THEN 'OK' ELSE 'FAIL' END AS status,
         'present: ' || coalesce((SELECT string_agg(table_name, ', ' ORDER BY table_name) FROM tbl WHERE table_name IN ('trips','trip_members','trip_groups','profiles','rounds')), 'none') AS detail

  UNION ALL SELECT 20, 'prereq 062: rounds.setup_released (boolean, NOT NULL)',
         CASE WHEN EXISTS (SELECT 1 FROM col WHERE table_name='rounds' AND column_name='setup_released' AND data_type='boolean' AND is_nullable='NO') THEN 'OK'
              WHEN EXISTS (SELECT 1 FROM col WHERE table_name='rounds' AND column_name='setup_released') THEN 'WARN' ELSE 'FAIL' END,
         coalesce((SELECT data_type || ', nullable=' || is_nullable FROM col WHERE table_name='rounds' AND column_name='setup_released'), 'column missing -> apply 062 first')

  UNION ALL SELECT 30, 'prereq 025: event_messages table and columns',
         CASE WHEN (SELECT count(*) FROM col WHERE table_name='event_messages' AND column_name IN ('id','trip_id','sender_user_id','message_type','recipient_type','recipient_group_id','recipient_user_id','message','is_pinned','created_at')) = 10 THEN 'OK' ELSE 'FAIL' END,
         'columns found: ' || (SELECT count(*) FROM col WHERE table_name='event_messages' AND column_name IN ('id','trip_id','sender_user_id','message_type','recipient_type','recipient_group_id','recipient_user_id','message','is_pinned','created_at')) || ' of 10'

  UNION ALL SELECT 31, 'prereq 025: event_messages allows message_type announcement + player_notification',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                           WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c'
                             AND pg_get_constraintdef(c.oid) ILIKE '%announcement%' AND pg_get_constraintdef(c.oid) ILIKE '%player_notification%') THEN 'OK'
              ELSE 'FAIL' END,
         coalesce((SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%message_type%'), 'no message_type CHECK found')

  UNION ALL SELECT 32, 'prereq 025: event_messages RLS enabled',
         CASE WHEN EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='event_messages' AND t.relrowsecurity) THEN 'OK' ELSE 'WARN' END,
         'row level security on event_messages'

  UNION ALL SELECT 33, 'prereq 102: event_messages recipient_type CHECKs (type + consistency) allow ''all'' (the release announcement uses it)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                           WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c'
                             AND pg_get_constraintdef(c.oid) ILIKE '%recipient_type%' AND pg_get_constraintdef(c.oid) NOT ILIKE '%''all''%') THEN 'FAIL'
              WHEN NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                           WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%recipient_type%') THEN 'WARN'
              ELSE 'OK' END,
         coalesce((SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='event_messages' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%recipient_type%'), 'no recipient_type CHECK found')
         || '   FAIL here = stale chat constraint: apply migration 102 (NOT 029 alone) BEFORE releasing any round'

  UNION ALL SELECT 34, 'prereq 029/031: event_messages read policy treats ''event'' like ''all''',
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_messages' AND cmd IN ('SELECT','ALL') AND qual ILIKE '%''event''%') THEN 'OK' ELSE 'WARN' END,
         coalesce((SELECT string_agg(policyname, ', ') FROM pg_policies WHERE schemaname='public' AND tablename='event_messages'), 'no policies')

  UNION ALL SELECT 40, 'prereq 097: rounds.status CHECK allows upcoming/active/completed/cancelled',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                           WHERE n.nspname='public' AND t.relname='rounds' AND c.contype='c'
                             AND pg_get_constraintdef(c.oid) ILIKE '%cancelled%' AND pg_get_constraintdef(c.oid) ILIKE '%upcoming%') THEN 'OK'
              ELSE 'FAIL' END,
         coalesce((SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='rounds' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%status%'), 'no status CHECK found -> apply 097 first')

  UNION ALL SELECT 41, 'prereq 097: round_status_events table',
         CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='round_status_events') THEN 'OK' ELSE 'FAIL' END, 'created by 097'

  UNION ALL SELECT 50, 'prereq 053/055: per-round tee-time and starting-hole tables',
         CASE WHEN (SELECT count(*) FROM tbl WHERE table_name IN ('round_group_tee_times','round_group_starting_holes')) = 2 THEN 'OK' ELSE 'FAIL' END,
         'present: ' || coalesce((SELECT string_agg(table_name, ', ') FROM tbl WHERE table_name IN ('round_group_tee_times','round_group_starting_holes')), 'none')

  UNION ALL SELECT 51, 'prereq: scorecards.playing_handicap type (round snapshot written by Start Round)',
         CASE WHEN EXISTS (SELECT 1 FROM col WHERE table_name='scorecards' AND column_name='playing_handicap' AND data_type='integer') THEN 'OK' ELSE 'FAIL' END,
         coalesce((SELECT data_type FROM col WHERE table_name='scorecards' AND column_name='playing_handicap'), 'column missing') || '  (101 stores INTEGER to match; no golf-range CHECK anywhere in 101)'

  UNION ALL SELECT 52, 'prereq: trips.organiser_is_playing exists',
         CASE WHEN EXISTS (SELECT 1 FROM col WHERE table_name='trips' AND column_name='organiser_is_playing') THEN 'OK' ELSE 'WARN' END, 'used by the release loader'

  UNION ALL SELECT 53, 'prereq: begin_round() function present (Start Round)',
         CASE WHEN EXISTS (SELECT 1 FROM fn WHERE proname='begin_round') THEN 'OK' ELSE 'WARN' END,
         coalesce((SELECT string_agg(args, ' | ') FROM fn WHERE proname='begin_round'), 'not found')

  -- ── neighbouring migrations (information only) ───────────────────────────
  UNION ALL SELECT 60, 'info 098: shared_leaderboards table (Package 1)',
         CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='shared_leaderboards') THEN 'OK' ELSE 'INFO' END,
         CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='shared_leaderboards') THEN 'applied' ELSE 'NOT applied: public live leaderboard sharing needs 098 (separate from 101)' END

  UNION ALL SELECT 61, 'info 099: trips.ended_early / champion_declared (event outcome)',
         CASE WHEN (SELECT count(*) FROM col WHERE table_name='trips' AND column_name IN ('ended_early','champion_declared')) = 2 THEN 'OK' ELSE 'INFO' END,
         CASE WHEN (SELECT count(*) FROM col WHERE table_name='trips' AND column_name IN ('ended_early','champion_declared')) = 2 THEN 'applied' ELSE 'NOT applied: End Event Early / no-champion needs 099 (separate from 101)' END

  UNION ALL SELECT 62, 'info 100 (Package 3): not required by 101',
         'INFO', 'migration 100 is independent; its presence or absence does not affect 101'

  -- ── has 101 already been applied? ────────────────────────────────────────
  UNION ALL SELECT 70, '101 status: rounds.release_revision / released_at',
         CASE WHEN (SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at')) = 2 THEN 'INFO' WHEN (SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at')) = 0 THEN 'INFO' ELSE 'FAIL' END,
         CASE (SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at'))
              WHEN 2 THEN 'both columns present -> 101 appears applied' WHEN 0 THEN 'neither column present -> 101 NOT applied yet'
              ELSE 'PARTIAL: only one of the two columns exists -> investigate before doing anything' END

  UNION ALL SELECT 71, '101 status: round_arrangements table',
         CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='round_arrangements') THEN 'INFO' ELSE 'INFO' END,
         CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='round_arrangements') THEN 'present' ELSE 'absent' END

  UNION ALL SELECT 72, '101 status: round_release_log table',
         'INFO', CASE WHEN EXISTS (SELECT 1 FROM tbl WHERE table_name='round_release_log') THEN 'present' ELSE 'absent' END

  UNION ALL SELECT 73, '101 status: release_round_arrangements function',
         'INFO', coalesce((SELECT 'present(' || args || ')' FROM fn WHERE proname='release_round_arrangements' LIMIT 1), 'absent')

  UNION ALL SELECT 74, '101 status: all four 101 objects consistent (all present or all absent)',
         CASE WHEN (
           (SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at'))
           + (SELECT count(*) FROM tbl WHERE table_name IN ('round_arrangements','round_release_log'))
           + (SELECT count(*) FROM fn WHERE proname='release_round_arrangements')) IN (0, 5) THEN 'OK' ELSE 'FAIL' END,
         'objects found: ' || ((SELECT count(*) FROM col WHERE table_name='rounds' AND column_name IN ('release_revision','released_at'))
           + (SELECT count(*) FROM tbl WHERE table_name IN ('round_arrangements','round_release_log'))
           + (SELECT count(*) FROM fn WHERE proname='release_round_arrangements')) || ' of 5 (0 = not applied, 5 = applied; anything else is a partial apply)'

  -- ── name collisions that would make 101 behave unexpectedly ──────────────
  UNION ALL SELECT 80, 'collision: another function named release_round_arrangements with different arguments',
         CASE WHEN (SELECT count(*) FROM fn WHERE proname='release_round_arrangements') > 1 THEN 'FAIL' ELSE 'OK' END,
         (SELECT count(*) FROM fn WHERE proname='release_round_arrangements') || ' overload(s) found'

  UNION ALL SELECT 81, 'collision: round_arrangements exists but has unexpected columns',
         CASE WHEN NOT EXISTS (SELECT 1 FROM tbl WHERE table_name='round_arrangements') THEN 'OK'
              WHEN (SELECT count(*) FROM col WHERE table_name='round_arrangements' AND column_name IN ('round_id','player_id','group_id','group_name','tee_time','starting_hole','playing_handicap','revision','updated_at')) = 9 THEN 'OK'
              ELSE 'FAIL' END,
         coalesce((SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) FROM col WHERE table_name='round_arrangements'), 'table absent')

  UNION ALL SELECT 82, 'after 101: round_arrangements.playing_handicap is INTEGER with NO golf-range CHECK',
         CASE WHEN NOT EXISTS (SELECT 1 FROM tbl WHERE table_name='round_arrangements') THEN 'INFO'
              WHEN EXISTS (SELECT 1 FROM col WHERE table_name='round_arrangements' AND column_name='playing_handicap' AND data_type='integer')
                   AND NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                                   WHERE n.nspname='public' AND t.relname='round_arrangements' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%playing_handicap%') THEN 'OK'
              ELSE 'FAIL' END,
         'a CHECK on playing_handicap here would be the earlier, withdrawn -10..60 draft of 101 -> do not use that version'

  UNION ALL SELECT 83, 'after 101: release_round_arrangements not executable by anon/authenticated',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE proname='release_round_arrangements') THEN 'INFO'
              WHEN has_function_privilege('anon', 'public.release_round_arrangements(uuid,uuid,integer,jsonb,jsonb,jsonb)', 'EXECUTE')
                OR has_function_privilege('authenticated', 'public.release_round_arrangements(uuid,uuid,integer,jsonb,jsonb,jsonb)', 'EXECUTE') THEN 'FAIL' ELSE 'OK' END,
         'must be callable by the service role only'

  -- ── data impact ─────────────────────────────────────────────────────────
  UNION ALL SELECT 90, 'data: rounds with setup_released = true (legacy releases once 101 is applied)',
         CASE WHEN (SELECT count(*) FROM rounds WHERE setup_released) > 0 THEN 'INFO' ELSE 'OK' END,
         (SELECT count(*) FROM rounds WHERE setup_released) || ' released round(s) in total'

  UNION ALL SELECT 91, 'data: released UPCOMING rounds (these need one Confirm & Re-release after deploy)',
         CASE WHEN (SELECT count(*) FROM rounds WHERE setup_released AND status='upcoming') > 0 THEN 'WARN' ELSE 'OK' END,
         coalesce((SELECT string_agg(coalesce(name,'?') || ' [' || id::text || ', ' || coalesce(play_date::text,'no date') || ']', '; ' ORDER BY play_date) FROM rounds WHERE setup_released AND status='upcoming'), 'none')

  UNION ALL SELECT 92, 'data: released rounds already live or completed (left exactly as they are; never converted)',
         'INFO', (SELECT count(*) FROM rounds WHERE setup_released AND status IN ('active','completed')) || ' round(s)'

  UNION ALL SELECT 93, 'data: upcoming released rounds with no snapshot (only meaningful after 101 is applied)',
         CASE WHEN to_regclass('public.round_arrangements') IS NULL THEN 'INFO'
              WHEN (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.rounds r WHERE r.setup_released AND r.status = ''upcoming'' AND NOT EXISTS (SELECT 1 FROM public.round_arrangements a WHERE a.round_id = r.id)', false, true, '')))[1]::text::int > 0 THEN 'WARN'
              ELSE 'OK' END,
         CASE WHEN to_regclass('public.round_arrangements') IS NULL THEN '101 not applied yet - see check 91'
              ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.rounds r WHERE r.setup_released AND r.status = ''upcoming'' AND NOT EXISTS (SELECT 1 FROM public.round_arrangements a WHERE a.round_id = r.id)', false, true, '')))[1]::text
                   || ' upcoming released round(s) still need their one-time Confirm & Re-release' END

  UNION ALL SELECT 94, 'data: active rounds (release/re-release is blocked while a round is live; Round must be finished first or Start used)',
         'INFO', (SELECT count(*) FROM rounds WHERE status='active') || ' active round(s)'

  UNION ALL SELECT 95, 'data: existing handicap ranges (informational -- shows plus handicaps and values above 54 do occur or not)',
         'INFO', 'profiles.handicap min/max: ' || coalesce((SELECT min(handicap)::text || ' / ' || max(handicap)::text FROM profiles WHERE handicap IS NOT NULL), 'none')
                 || '; trip_members.playing_handicap min/max: ' || coalesce((SELECT min(playing_handicap)::text || ' / ' || max(playing_handicap)::text FROM trip_members WHERE playing_handicap IS NOT NULL), 'none')
                 || '; scorecards.playing_handicap min/max: ' || coalesce((SELECT min(playing_handicap)::text || ' / ' || max(playing_handicap)::text FROM scorecards WHERE playing_handicap IS NOT NULL), 'none')
)
SELECT ord, check_name, status, detail FROM checks ORDER BY ord;
