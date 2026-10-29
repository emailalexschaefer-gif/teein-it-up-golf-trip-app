-- READ-ONLY PREFLIGHT for proposed migration 104. SELECT only. Run in the Supabase SQL editor and send the result grid back.
-- Nothing here modifies anything. It answers: do the dependencies exist, is 104 free, and what do the existing helpers look like.
select 'migration_104_already_applied' as check_name,
       (select count(*)::text from supabase_migrations.schema_migrations where version like '104%') as result
union all select 'highest_applied_migration', (select max(version) from supabase_migrations.schema_migrations)
union all select 'table_exists:'||t, (to_regclass('public.'||t) is not null)::text
  from unnest(array['profiles','trips','trip_members','trip_groups','rounds','holes','competition_teams','round_team_entries','team_score_entries']) t
union all select 'function_exists:'||f, (to_regprocedure('public.'||f) is not null)::text
  from unnest(array['is_trip_member(uuid)','is_trip_organiser(uuid)']) f
union all select 'helper_search_path:'||p.proname, coalesce(array_to_string(p.proconfig, ';'), 'NOT PINNED')
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('is_trip_member','is_trip_organiser')
union all select 'rounds_status_constraint', pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='public.rounds'::regclass and c.conname='rounds_status_check'
union all select 'trip_members_role_values', string_agg(distinct role, ',') from public.trip_members
union all select 'default_privileges_public_functions', coalesce(string_agg(defaclacl::text, ' | '), 'none') from pg_default_acl where defaclnamespace='public'::regnamespace;
