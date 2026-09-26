-- Worker submission readback and database-side attachment validation.
begin;
create policy worker_own_screening on public.screening_records for select to authenticated using(team_id=supervisor_private.team('worker') and created_by=auth.uid());
create function supervisor_private.valid_attachment(data text,mime text) returns boolean
language plpgsql immutable set search_path='' as $$
declare bytes bytea;
begin
 if data is null then return true;end if;
 bytes=decode(data,'base64');
 if octet_length(bytes)>2097152 then return false;end if;
 return case mime when 'application/pdf' then substring(bytes from 1 for 5)=convert_to('%PDF-','UTF8')
 when 'image/png' then substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex')
 when 'image/jpeg' then substring(bytes from 1 for 3)=decode('ffd8ff','hex') else false end;
exception when others then return false;
end $$;
revoke all on function supervisor_private.valid_attachment(text,text) from public,anon;
grant execute on function supervisor_private.valid_attachment(text,text) to authenticated;
alter table public.lab_reports add constraint valid_lab_file check(supervisor_private.valid_attachment(file_base64,file_type));
alter table public.case_actions add constraint valid_action_file check(supervisor_private.valid_attachment(evidence_base64,evidence_type));
notify pgrst,'reload schema';
commit;
