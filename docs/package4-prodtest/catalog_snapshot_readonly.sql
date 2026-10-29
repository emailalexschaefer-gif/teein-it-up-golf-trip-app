select 'T '||table_name||'.'||column_name||' '||data_type||' '||coalesce(column_default,'')||' '||is_nullable from information_schema.columns where table_schema='public'
union all select 'F '||p.oid::regprocedure::text||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(p.proacl::text,'') from pg_proc p where pronamespace='public'::regnamespace
union all select 'TR '||tgrelid::regclass||' '||tgname||' '||md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal
union all select 'PO '||schemaname||'.'||tablename||' '||policyname||' '||md5(coalesce(qual,'')||coalesce(with_check,'')||cmd) from pg_policies
union all select 'RL '||relname||' '||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'CO '||conrelid::regclass||' '||conname||' '||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace='public'::regnamespace
union all select 'IX '||indexname||' '||md5(indexdef) from pg_indexes where schemaname='public'
union all select 'GR '||table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public'
order by 1;
