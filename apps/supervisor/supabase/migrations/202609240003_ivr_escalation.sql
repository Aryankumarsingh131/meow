begin;
create function public.create_case_from_ivr(p_complaint_id uuid,p_complaint_version integer,p_source_id uuid) returns public.cases
language plpgsql security definer set search_path='' as $$
declare complaint public.ivr_complaints;c public.cases;tid uuid:=supervisor_private.team();
begin
 select * into complaint from public.ivr_complaints where id=p_complaint_id and team_id=tid for update;
 if not found then raise exception 'Complaint not found' using errcode='42501';end if;
 if complaint.status<>'new' or complaint.version<>p_complaint_version then raise exception 'Complaint changed or already linked' using errcode='40001';end if;
 if (complaint.source_id is not null and complaint.source_id<>p_source_id) or not exists(select 1 from public.water_sources where id=p_source_id and team_id=tid) then
 raise exception 'Complaint source does not match jurisdiction' using errcode='23514';end if;
 insert into public.cases(team_id,source_id,origin,priority) values(tid,p_source_id,'ivr','urgent') returning * into c;
 update public.ivr_complaints set case_id=c.id,source_id=c.source_id,status='linked',linked_by=auth.uid(),linked_at=now(),version=version+1 where id=complaint.id;
 perform supervisor_private.append_audit(c.id,tid,'ivr.linked',jsonb_build_object('complaint_id',complaint.id));
 return c;
end $$;
revoke all on function public.create_case_from_ivr(uuid,integer,uuid) from public,anon;
grant execute on function public.create_case_from_ivr(uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
