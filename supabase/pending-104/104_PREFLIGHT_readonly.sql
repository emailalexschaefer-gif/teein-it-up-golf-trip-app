-- 104 PREFLIGHT -- READ ONLY (SELECT only). Run in the Supabase SQL editor BEFORE applying 104 and send me the result grid.
-- Does not use supabase_migrations (it may not exist if migrations were applied by hand). Expected: every row result = 'ok'.
select 'dependency table exists: '||t as check_name,
       case when to_regclass('public.'||t) is not null then 'ok' else 'MISSING' end as result
  from unnest(array['profiles','trips','trip_members','trip_groups','rounds','holes']) t
union all select 'dependency function exists: '||f,
       case when to_regprocedure('public.'||f) is not null then 'ok' else 'MISSING' end
  from unnest(array['is_trip_member(uuid)','is_trip_organiser(uuid)']) f
union all select 'dependency column exists: '||c,
       case when exists (select 1 from information_schema.columns where table_schema='public' and table_name||'.'||column_name = c) then 'ok' else 'MISSING' end
  from unnest(array['rounds.setup_released','rounds.status','rounds.trip_id','trip_members.role','trip_members.group_id','holes.round_id','trip_groups.trip_id']) c
union all select 'trip_members.role values (organiser/player expected)',
       coalesce((select string_agg(distinct role, ',') from public.trip_members), 'none')
union all select 'rounds.status allowed values',
       coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='public.rounds'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%status%' limit 1), 'no check constraint')
union all select 'name free (not yet created): table '||t,
       case when to_regclass('public.'||t) is null then 'ok' else 'ALREADY EXISTS' end
  from unnest(array['competition_teams','round_competition_config','round_team_entries','round_team_members','team_score_entries','team_score_revisions','team_score_flags','team_entry_audit']) t
union all select 'name free (not yet created): function '||p,
       case when not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname=p) then 'ok' else 'ALREADY EXISTS' end
  from unnest(array['submit_team_score','assign_team_scorer','release_team_override_lock','resolve_team_no_return','raise_team_score_flag','resolve_team_score_flag','waive_team_drive_requirement','team_entry_completion','create_competition_team','team_setup_block','configure_round_competition','save_round_team_entry','lock_team_handicap','reopen_team_setup','relock_team_setup','team_score_revisions_immutable']) p
union all select 'helper search_path (informational): '||p.proname, coalesce(array_to_string(p.proconfig, ';'), 'not pinned (existing behaviour; 104 does not change it)')
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('is_trip_member','is_trip_organiser')
union all select 'default privileges on public (informational)', coalesce((select string_agg(defaclacl::text, ' | ') from pg_default_acl where defaclnamespace='public'::regnamespace), 'none')
union all select 'database size (informational)', pg_size_pretty(pg_database_size(current_database()))
union all select 'live round count (informational)', (select count(*)::text from public.rounds where status='active');
