begin;
alter table public.screening_records add column capture_name text,add column capture_type text check(capture_type in ('application/pdf','image/jpeg','image/png')),add column capture_base64 text;
alter table public.screening_records add constraint valid_capture check(supervisor_private.valid_attachment(capture_base64,capture_type));
grant insert(capture_name,capture_type,capture_base64) on public.screening_records to authenticated;
alter table public.retests add constraint valid_retest_due check(due_at>=requested_at);
create or replace function public.verify_case_audit(p_case_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select count(*)>0 and bool_and(
 event_hash=encode(extensions.digest(convert_to(previous_hash||payload::text,'UTF8'),'sha256'),'hex')
 and previous_hash=coalesce(prior,'GENESIS') and sequence=row_number
 and payload->>'event'=event and (payload->>'sequence')::integer=sequence
 and (payload->>'case_id')::uuid=entity_id and (payload->>'team_id')::uuid=team_id
 and (payload->>'occurred_at')::timestamptz=occurred_at
 and ((payload->>'actor_id')::uuid is not distinct from actor_id))
 from (select *,lag(event_hash) over(order by sequence) prior,row_number() over(order by sequence) from public.audit_log where entity_id=p_case_id) a
$$;
create function supervisor_private.source_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 for cid in select id from public.cases where source_id=new.id order by id loop
 perform supervisor_private.append_audit(cid,new.team_id,'source.metadata_updated',jsonb_build_object('source_id',new.id,'version',new.version,'name',new.name,'locality',new.locality));
 end loop;return new;
end $$;
revoke all on function supervisor_private.source_history() from public,anon,authenticated;
create trigger source_history after update on public.water_sources for each row execute function supervisor_private.source_history();
notify pgrst,'reload schema';
commit;
