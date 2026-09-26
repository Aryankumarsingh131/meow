begin;
do $$
begin
 execute replace(pg_get_functiondef('public.link_ivr_complaint_to_case(uuid,uuid,integer,integer)'::regprocedure), '''40001''', '''PT409''');
end $$;
notify pgrst,'reload schema';
commit;
