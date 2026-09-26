begin;
-- Optimistic conflicts are HTTP 409, not retryable serialization failures.
do $$
declare r record;
begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='supervisor_private' and p.proname in ('touch_case','source_version'))
 or (n.nspname='public' and p.proname in ('link_ivr','create_case_from_ivr'))
 loop
 execute replace(pg_get_functiondef(r.oid), '''40001''', '''PT409''');
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
