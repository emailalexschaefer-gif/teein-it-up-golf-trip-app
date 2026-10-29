-- 104 POSTFLIGHT -- READ ONLY. Run after applying 104 and send me the result grid. Expected: every result = 'ok'.
with fn(name, sig) as (values
 ('submit_team_score','text,uuid,uuid,integer,boolean,uuid,integer,text'),('assign_team_scorer','uuid,uuid'),('release_team_override_lock','uuid,uuid,text'),
 ('resolve_team_no_return','uuid,uuid,integer,text'),('raise_team_score_flag','uuid,uuid,text'),('resolve_team_score_flag','uuid,text,text'),
 ('waive_team_drive_requirement','uuid,text'),('team_entry_completion','uuid'),('create_competition_team','uuid,text,text'),
 ('configure_round_competition','uuid,text,text,jsonb,integer'),('save_round_team_entry','uuid,uuid,uuid[],uuid'),('lock_team_handicap','uuid,numeric,jsonb'),
 ('reopen_team_setup','uuid,text'),('relock_team_setup','uuid')),
tb(name) as (values ('competition_teams'),('round_competition_config'),('round_team_entries'),('round_team_members'),('team_score_entries'),('team_score_revisions'),('team_score_flags'),('team_entry_audit'))
select 'table exists with row-level security: '||name as check_name,
       case when (select relrowsecurity from pg_class where oid = to_regclass('public.'||name)) then 'ok' else 'FAIL' end as result from tb
union all select 'authenticated cannot write directly: '||name,
       case when not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=tb.name and g.grantee in ('anon','authenticated','PUBLIC') and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) then 'ok' else 'FAIL' end from tb
union all select 'function secure (definer [team_entry_completion is deliberately invoker, so RLS applies], search_path pinned, anon/PUBLIC blocked, signed-in allowed): '||name,
       case when p.oid is not null and p.prosecdef = (fn.name <> 'team_entry_completion') and p.proconfig is not null
             and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')
            then 'ok' else 'FAIL' end
  from fn left join pg_proc p on p.oid = to_regprocedure('public.'||fn.name||'('||fn.sig||')')
union all select 'internal helper not callable by any client role: team_setup_block',
       case when not has_function_privilege('authenticated', 'public.team_setup_block(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.team_setup_block(uuid)', 'EXECUTE') then 'ok' else 'FAIL' end
union all select 'policy count on the 8 team tables (expect 8)', (select count(*)::text from pg_policies where schemaname='public' and tablename in (select name from tb))
union all select 'ordinary Stableford function fingerprint (informational; compare with the same query run BEFORE 104)', (select md5(string_agg(pg_get_functiondef(p.oid), ' ' order by p.oid::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='calculate_stableford_points');
