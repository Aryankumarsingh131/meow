-- Supervisor workflow, isolated from the existing jalsakshi ingestion schema.
-- Runs atomically. No users, team memberships, or existing records are changed.
begin;
create schema if not exists supervisor_private;
revoke all on schema supervisor_private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.teams (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name))>0),
 data_mode text not null default 'synthetic' check(data_mode in ('synthetic','live'))
);
create table public.profiles (
 id uuid primary key references auth.users(id), role text not null check(role in ('supervisor','worker')),
 team_id uuid not null references public.teams(id)
);
create function supervisor_private.team(required_role text default 'supervisor') returns uuid
language sql stable security definer set search_path='' as $$
 select team_id from public.profiles where id=auth.uid() and role=required_role
$$;
grant usage on schema supervisor_private to authenticated;
grant execute on function supervisor_private.team(text) to authenticated;
revoke execute on function supervisor_private.team(text) from public, anon;

create table public.water_sources (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams,
 name text not null check(length(trim(name))>0), locality text not null default '', metadata jsonb not null default '{}',
 version integer not null default 1, unique(id,team_id)
);
create table public.screening_records (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams,
 source_id uuid not null, sample_code text not null check(length(trim(sample_code))>0),
 machine_suggestion text not null, human_observation text not null,
 screening_flag text not null check(screening_flag in ('flagged','uncertain','clear')),
 captured_at timestamptz not null check(captured_at<=now()), received_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references public.profiles,
 unique(id,team_id), unique(team_id,sample_code), foreign key(source_id,team_id) references public.water_sources(id,team_id)
);
create table public.cases (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams,
 source_id uuid not null, screening_id uuid, origin text not null default 'screening' check(origin in ('screening','ivr')),
 status text not null default 'under_review' check(status in ('under_review','closed')),
 priority text not null default 'normal' check(priority in ('normal','urgent','critical')),
 created_at timestamptz not null default now(), created_by uuid default auth.uid(), version integer not null default 1,
 closed_at timestamptz, closed_by uuid, closure_reason text,
 unique(id,team_id), unique(screening_id), foreign key(source_id,team_id) references public.water_sources(id,team_id),
 foreign key(screening_id,team_id) references public.screening_records(id,team_id)
);
create table public.lab_reports (
 id uuid primary key default gen_random_uuid(), team_id uuid not null, case_id uuid not null,
 source_id uuid not null, screening_id uuid not null, report_number text not null check(length(trim(report_number))>0),
 lab_name text not null check(length(trim(lab_name))>0), result text not null check(length(trim(result))>0),
 file_name text not null, file_type text not null check(file_type in ('application/pdf','image/jpeg','image/png')),
 file_base64 text not null check(length(file_base64) between 4 and 2800000),
 file_sha256 text generated always as (encode(extensions.digest(decode(file_base64,'base64'),'sha256'),'hex')) stored,
 uploaded_at timestamptz not null default now(), uploaded_by uuid not null default auth.uid(),
 verification_status text not null default 'uploaded' check(verification_status in ('uploaded','verified')),
 verified_at timestamptz, verified_by uuid, verification_note text,
 expected_case_version integer not null,
 foreign key(case_id,team_id) references public.cases(id,team_id),
 foreign key(source_id,team_id) references public.water_sources(id,team_id),
 foreign key(screening_id,team_id) references public.screening_records(id,team_id), unique(case_id,report_number)
);
create table public.case_actions (
 id uuid primary key default gen_random_uuid(), team_id uuid not null, case_id uuid not null,
 kind text not null check(kind in ('referral','corrective')), description text not null check(length(trim(description))>0),
 performed_by text not null check(length(trim(performed_by))>0), performed_at timestamptz not null check(performed_at<=now()),
 evidence_name text, evidence_type text check(evidence_type in ('application/pdf','image/jpeg','image/png')),
 evidence_base64 text check(length(evidence_base64)<=2800000),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid(), expected_case_version integer not null,
 foreign key(case_id,team_id) references public.cases(id,team_id)
);
create table public.retests (
 id uuid primary key default gen_random_uuid(), team_id uuid not null, case_id uuid not null,
 requested_at timestamptz not null default now(), requested_by uuid not null default auth.uid(),
 due_at timestamptz not null, instructions text not null check(length(trim(instructions))>0),
 linked_screening_id uuid, status text not null default 'requested' check(status in ('requested','completed')),
 completed_at timestamptz, expected_case_version integer not null,
 foreign key(case_id,team_id) references public.cases(id,team_id),
 foreign key(linked_screening_id,team_id) references public.screening_records(id,team_id)
);
create table public.resident_communications (
 id uuid primary key default gen_random_uuid(), team_id uuid not null, case_id uuid not null,
 channel text not null check(channel in ('sms','phone','in_person','public_notice','email')),
 message_summary text not null check(length(trim(message_summary))>0),
 sent_at timestamptz not null check(sent_at<=now()),
 delivery_status text not null check(delivery_status in ('sent','delivered','failed')),
 delivery_reference text not null check(length(trim(delivery_reference))>0),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid(), expected_case_version integer not null,
 foreign key(case_id,team_id) references public.cases(id,team_id)
);
create table public.ivr_complaints (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams,
 source_id uuid, summary text not null, status text not null default 'new' check(status in ('new','linked')),
 received_at timestamptz not null default now(), case_id uuid, linked_at timestamptz, linked_by uuid,
 version integer not null default 1,
 foreign key(case_id,team_id) references public.cases(id,team_id), foreign key(source_id,team_id) references public.water_sources(id,team_id)
);
create table public.audit_log (
 id uuid primary key default gen_random_uuid(), team_id uuid not null, entity_id uuid not null,
 sequence integer not null, occurred_at timestamptz not null default clock_timestamp(), actor_id uuid,
 event text not null, payload jsonb not null, previous_hash text not null, event_hash text not null,
 unique(entity_id,sequence), foreign key(entity_id,team_id) references public.cases(id,team_id)
);

-- Lock the case before every evidence mutation; reject stale forms and changes after closure.
create function supervisor_private.touch_case(cid uuid, tid uuid, expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare c public.cases;
begin
 if tid is distinct from supervisor_private.team() then raise exception 'Outside supervisor jurisdiction' using errcode='42501'; end if;
 select * into c from public.cases where id=cid and team_id=tid for update;
 if not found then raise exception 'Case not found' using errcode='42501'; end if;
 if c.status='closed' then raise exception 'Case is already closed' using errcode='23505'; end if;
 if expected is null or expected<>c.version then raise exception 'Case changed. Refresh and review the latest evidence.' using errcode='40001'; end if;
 update public.cases set version=version+1 where id=cid;
end $$;

create function supervisor_private.evidence_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.cases; sample public.screening_records;
begin
 perform supervisor_private.touch_case(new.case_id,new.team_id,new.expected_case_version);
 select * into c from public.cases where id=new.case_id;
 if tg_table_name='lab_reports' then
   select * into sample from public.screening_records where id=new.screening_id and team_id=new.team_id;
   if sample.id is null or sample.source_id<>c.source_id or new.source_id<>c.source_id
     or (c.screening_id is not null and new.screening_id<>c.screening_id) then
     raise exception 'Lab report sample/source does not match this case' using errcode='23514';
   end if;
   if tg_op='INSERT' then
     new.verification_status='uploaded'; new.verified_at=null; new.verified_by=null; new.verification_note=null;
     new.uploaded_by=auth.uid(); new.uploaded_at=now();
   end if;
 elsif tg_table_name='retests' then
   if tg_op='INSERT' then new.status='requested'; new.linked_screening_id=null; new.completed_at=null; new.requested_by=auth.uid(); new.requested_at=now(); end if;
   if tg_op='UPDATE' then
     if old.status='completed' then raise exception 'A completed retest is immutable' using errcode='23514'; end if;
     select * into sample from public.screening_records where id=new.linked_screening_id and team_id=new.team_id;
     if sample.id is null or sample.source_id<>c.source_id or sample.id=c.screening_id or sample.captured_at<old.requested_at then
       raise exception 'Retest must link a distinct later sample from the same source' using errcode='23514';
     end if;
     new.status='completed'; new.completed_at=sample.received_at;
   end if;
 end if;
 return new;
end $$;

create function supervisor_private.append_audit(cid uuid, tid uuid, kind text, detail jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior text; seq integer; stamp timestamptz:=clock_timestamp(); body jsonb;
begin
 perform 1 from public.cases where id=cid for update;
 select event_hash,sequence into prior,seq from public.audit_log where entity_id=cid order by sequence desc limit 1;
 prior=coalesce(prior,'GENESIS');seq=coalesce(seq,0)+1;
 body=jsonb_build_object('case_id',cid,'team_id',tid,'sequence',seq,'occurred_at',stamp,'actor_id',auth.uid(),'event',kind,'detail',detail);
 insert into public.audit_log(team_id,entity_id,sequence,occurred_at,actor_id,event,payload,previous_hash,event_hash)
 values(tid,cid,seq,stamp,auth.uid(),kind,body,prior,encode(extensions.digest(convert_to(prior||body::text,'UTF8'),'sha256'),'hex'));
end $$;
create function supervisor_private.evidence_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform supervisor_private.append_audit(new.case_id,new.team_id,tg_table_name||'.'||lower(tg_op),to_jsonb(new)-'file_base64'-'evidence_base64'); return new;
end $$;
create function supervisor_private.case_insert_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.screening_id is not null and not exists(select 1 from public.screening_records where id=new.screening_id and source_id=new.source_id and team_id=new.team_id) then
 raise exception 'Case screening/source mismatch' using errcode='23514'; end if;
 new.status='under_review';new.version=1;new.closed_at=null;new.closed_by=null;new.closure_reason=null; return new;
end $$;
create function supervisor_private.case_created() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform supervisor_private.append_audit(new.id,new.team_id,'case.created',jsonb_build_object('source_id',new.source_id,'origin',new.origin));return new;end $$;
create trigger case_insert_guard before insert on public.cases for each row execute function supervisor_private.case_insert_guard();
create trigger case_created after insert on public.cases for each row execute function supervisor_private.case_created();
create function supervisor_private.screening_case() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.screening_flag in ('flagged','uncertain') then
 insert into public.cases(team_id,source_id,screening_id,priority,created_by) values(new.team_id,new.source_id,new.id,case when new.screening_flag='flagged' then 'urgent' else 'normal' end,new.created_by);
 end if; return new;
end $$;
create trigger screening_case after insert on public.screening_records for each row execute function supervisor_private.screening_case();

do $$ declare t text; begin
 foreach t in array array['lab_reports','case_actions','retests','resident_communications'] loop
 execute format('create trigger evidence_guard before insert or update on public.%I for each row execute function supervisor_private.evidence_guard()',t);
 execute format('create trigger evidence_audit after insert or update on public.%I for each row execute function supervisor_private.evidence_audit()',t);
 end loop;
end $$;

create function public.verify_lab_report(p_report_id uuid,p_expected_version integer,p_note text) returns public.lab_reports
language plpgsql security definer set search_path='' as $$
declare r public.lab_reports;
begin
 select * into r from public.lab_reports where id=p_report_id and team_id=supervisor_private.team();
 if not found then raise exception 'Report not found' using errcode='42501';end if;
 if length(trim(coalesce(p_note,'')))=0 then raise exception 'Verification note is required' using errcode='23514';end if;
 if r.verification_status='verified' then raise exception 'Report already verified' using errcode='23505';end if;
 -- The trigger locks the case and rechecks sample identity and expected version.
 update public.lab_reports set verification_status='verified',verified_at=now(),verified_by=auth.uid(),verification_note=p_note,expected_case_version=p_expected_version
 where id=p_report_id returning * into r;
 return r;
end $$;
create function public.close_case(p_case_id uuid,p_expected_version integer,p_reason text) returns public.cases
language plpgsql security definer set search_path='' as $$
declare c public.cases;
begin
 perform supervisor_private.touch_case(p_case_id,supervisor_private.team(),p_expected_version);
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Closure rationale is required' using errcode='23514';end if;
 if not exists(select 1 from public.lab_reports where case_id=p_case_id and verification_status='verified')
 and not exists(select 1 from public.retests where case_id=p_case_id and status='completed' and linked_screening_id is not null) then
 raise exception 'Closure requires a verified lab report or a completed linked retest' using errcode='23514';end if;
 update public.cases set status='closed',closed_at=now(),closed_by=auth.uid(),closure_reason=p_reason where id=p_case_id returning * into c;
 perform supervisor_private.append_audit(c.id,c.team_id,'case.closed',jsonb_build_object('reason',p_reason,'version',c.version));
 return c;
end $$;
create function public.link_ivr_complaint_to_case(p_complaint_id uuid,p_case_id uuid,p_expected_version integer,p_complaint_version integer) returns public.ivr_complaints
language plpgsql security definer set search_path='' as $$
declare c public.cases; complaint public.ivr_complaints;
begin
 perform supervisor_private.touch_case(p_case_id,supervisor_private.team(),p_expected_version);
 select * into c from public.cases where id=p_case_id;
 select * into complaint from public.ivr_complaints where id=p_complaint_id and team_id=c.team_id for update;
 if not found then raise exception 'Complaint not found' using errcode='42501';end if;
 if complaint.status<>'new' or complaint.version<>p_complaint_version then raise exception 'Complaint changed or already linked' using errcode='40001';end if;
 if complaint.source_id is not null and complaint.source_id<>c.source_id then raise exception 'Complaint source does not match case' using errcode='23514';end if;
 update public.ivr_complaints set case_id=c.id,source_id=c.source_id,status='linked',linked_by=auth.uid(),linked_at=now(),version=version+1 where id=p_complaint_id returning * into complaint;
 perform supervisor_private.append_audit(c.id,c.team_id,'ivr.linked',jsonb_build_object('complaint_id',complaint.id));return complaint;
end $$;
create function public.verify_case_audit(p_case_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select count(*)>0 and bool_and(event_hash=encode(extensions.digest(convert_to(previous_hash||payload::text,'UTF8'),'sha256'),'hex') and previous_hash=coalesce(prior,'GENESIS') and sequence=row_number)
 from (select *,lag(event_hash) over(order by sequence) prior,row_number() over(order by sequence) from public.audit_log where entity_id=p_case_id) a
$$;
create function supervisor_private.immutable_audit() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit entries are immutable' using errcode='42501';end $$;
create trigger immutable_audit before update or delete on public.audit_log for each row execute function supervisor_private.immutable_audit();

-- Every read is jurisdiction-scoped. Profiles cannot self-promote or change teams.
do $$ declare t text; begin
 foreach t in array array['teams','profiles','water_sources','screening_records','cases','lab_reports','case_actions','retests','resident_communications','ivr_complaints','audit_log'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 if t not in ('teams','profiles') then execute format('create policy supervisor_read on public.%I for select to authenticated using (team_id=supervisor_private.team())',t);end if;
 end loop;
end $$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy own_team on public.teams for select to authenticated using(id=supervisor_private.team());
create policy worker_sources on public.water_sources for select to authenticated using(team_id=supervisor_private.team('worker'));
create policy worker_screening on public.screening_records for insert to authenticated with check(team_id=supervisor_private.team('worker') and created_by=auth.uid());
grant insert(team_id,source_id,sample_code,machine_suggestion,human_observation,screening_flag,captured_at) on public.screening_records to authenticated;
create function supervisor_private.source_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.version<>old.version+1 then raise exception 'Source changed. Refresh and review metadata.' using errcode='40001';end if;
 return new;
end $$;
create trigger source_version before update on public.water_sources for each row execute function supervisor_private.source_version();
create policy source_update on public.water_sources for update to authenticated using(team_id=supervisor_private.team()) with check(team_id=supervisor_private.team());
grant update(name,locality,metadata,version) on public.water_sources to authenticated;
create policy case_insert on public.cases for insert to authenticated with check(team_id=supervisor_private.team());
grant insert(team_id,source_id,screening_id,origin,priority) on public.cases to authenticated;
do $$ declare t text; begin
 foreach t in array array['lab_reports','case_actions','retests','resident_communications'] loop
 execute format('create policy supervisor_insert on public.%I for insert to authenticated with check(team_id=supervisor_private.team())',t);
 end loop;
end $$;
grant insert(team_id,case_id,source_id,screening_id,report_number,lab_name,result,file_name,file_type,file_base64,expected_case_version) on public.lab_reports to authenticated;
grant insert(team_id,case_id,kind,description,performed_by,performed_at,evidence_name,evidence_type,evidence_base64,expected_case_version) on public.case_actions to authenticated;
grant insert(team_id,case_id,due_at,instructions,expected_case_version) on public.retests to authenticated;
grant update(linked_screening_id,expected_case_version) on public.retests to authenticated;
create policy retest_update on public.retests for update to authenticated using(team_id=supervisor_private.team()) with check(team_id=supervisor_private.team());
grant insert(team_id,case_id,channel,message_summary,sent_at,delivery_status,delivery_reference,expected_case_version) on public.resident_communications to authenticated;
-- Complaints are ingested by a trusted IVR backend. Linking is the sole supervisor mutation.
revoke all on all functions in schema supervisor_private from public,anon,authenticated;
grant execute on function supervisor_private.team(text) to authenticated;
revoke all on function public.close_case(uuid,integer,text),public.verify_lab_report(uuid,integer,text),public.link_ivr_complaint_to_case(uuid,uuid,integer,integer),public.verify_case_audit(uuid) from public,anon;
grant execute on function public.close_case(uuid,integer,text),public.verify_lab_report(uuid,integer,text),public.link_ivr_complaint_to_case(uuid,uuid,integer,integer),public.verify_case_audit(uuid) to authenticated;
create index case_team_status on public.cases(team_id,status,created_at);
create index screening_team_source on public.screening_records(team_id,source_id,captured_at);
create index lab_case on public.lab_reports(case_id);
create index action_case on public.case_actions(case_id);
create index retest_case on public.retests(case_id);
create index communication_case on public.resident_communications(case_id);
notify pgrst,'reload schema';
commit;
