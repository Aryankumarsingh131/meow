-- JalSakshi public v2 — the ERD's workflow rules (erd.md flows 1-8), enforced in
-- the database so every write path obeys them, plus the guarded functions the
-- staff API calls. Idempotent; includes backfills for existing rows.
--
-- Order: 001_schema -> 002_hardening -> [seed_v2_demo] -> 004_erd_workflows.
-- (After the seed: the seed inserts reports with fixed ids for its high-risk
-- test records, which the auto-report trigger below would otherwise pre-empt.)

begin;

-- ---------------------------------------------------------------------
-- 1. Private photo/file store (flows 4 and 6; also lab result files).
--    photo_url / result_file_url values are 'blob:<uuid>'. Inspected by the
--    API (upload_validation.inspect) before insert: images 'available', PDFs
--    'quarantined' (no malware scanner) and never served or verified.
--    ponytail: bytea in Postgres, 10 MiB cap per file; move to object storage
--    when volume makes the database backup unwieldy.
-- ---------------------------------------------------------------------
create table if not exists photo_blobs (
  id           uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  availability text not null check (availability in ('available', 'quarantined')),
  byte_size    int not null check (byte_size > 0 and byte_size <= 10485760),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data         bytea not null,
  uploaded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
alter table photo_blobs enable row level security;

-- ---------------------------------------------------------------------
-- 2. reports.version is optimistic concurrency: every update bumps it, on
--    every write path, so a stale expected_version is always detectable.
-- ---------------------------------------------------------------------
create or replace function bump_report_version() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  NEW.version := OLD.version + 1;
  return NEW;
end;
$$;
drop trigger if exists trg_reports_version on reports;
create trigger trg_reports_version before update on reports
  for each row execute function bump_report_version();

-- ---------------------------------------------------------------------
-- 3. TEST_RECORDS ||--|| REPORTS: exactly one (original) report per test
--    record. REPORTS ||--o| REPORTS: a report has at most one re-report.
-- ---------------------------------------------------------------------
create unique index if not exists uq_reports_one_per_test_record
  on reports (test_record_id) where not is_re_report;
create unique index if not exists uq_reports_one_re_report
  on reports (previous_report_id) where previous_report_id is not null;
alter table reports drop constraint if exists chk_re_report_has_previous;
alter table reports add constraint chk_re_report_has_previous
  check (is_re_report = (previous_report_id is not null));

-- Flow 2: a test record that warrants attention produces its report.
-- Also keeps water_sources.current_risk_level = the latest test's level.
create or replace function report_from_test_record() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.computed_risk_level in ('medium', 'high') then
    insert into reports (source_id, test_record_id, risk_level, created_by)
      values (NEW.source_id, NEW.id, NEW.computed_risk_level, NEW.performed_by)
      on conflict (test_record_id) where not is_re_report do nothing;
  end if;
  update water_sources ws set current_risk_level = coalesce(NEW.computed_risk_level, 'unknown')
    where ws.id = NEW.source_id
      and not exists (select 1 from test_records t
                      where t.source_id = NEW.source_id and t.id <> NEW.id
                        and coalesce(t.synced_at, t.created_at) > coalesce(NEW.synced_at, NEW.created_at));
  return NEW;
end;
$$;
drop trigger if exists trg_test_record_report on test_records;
create trigger trg_test_record_report after insert on test_records
  for each row execute function report_from_test_record();

-- ---------------------------------------------------------------------
-- 4. Labs. uploaded != verified: nothing is 'verified' without a verifier,
--    a time and a result file. Flow 3: a lab asking for a fresh sample
--    creates the re-report row pointing back (never mutates the original).
-- ---------------------------------------------------------------------
alter table lab_referrals drop constraint if exists chk_verified_has_evidence;
alter table lab_referrals add constraint chk_verified_has_evidence check (
  verification_status <> 'verified'
  or (verified_by is not null and verified_at is not null and result_file_url is not null));

create or replace function re_report_on_lab_request() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.re_report_requested and (TG_OP = 'INSERT' or not OLD.re_report_requested) then
    insert into reports (source_id, test_record_id, risk_level, is_re_report, previous_report_id, created_by)
      select r.source_id, r.test_record_id, r.risk_level, true, r.id, coalesce(NEW.verified_by, r.created_by)
      from reports r where r.id = NEW.report_id
      on conflict (previous_report_id) where previous_report_id is not null do nothing;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_lab_re_report on lab_referrals;
create trigger trg_lab_re_report after insert or update on lab_referrals
  for each row execute function re_report_on_lab_request();

-- ---------------------------------------------------------------------
-- 5. Water sources. Flow 8: a manual pin must name a SUPERVISOR as approver;
--    a GPS pin must carry the device's accuracy. updated_at is real.
--    'no_open_issues' is added to the public status set: once every report
--    on a source is closed, "Not yet tested" would be false and
--    "under review" stale; it is explicitly not a safety claim.
-- ---------------------------------------------------------------------
alter table water_sources drop constraint if exists water_sources_current_public_status_check;
alter table water_sources add constraint water_sources_current_public_status_check check (
  current_public_status in ('not_tested', 'under_review', 'action_pending', 'no_open_issues', 'lab_verified_safe'));
alter table water_sources drop constraint if exists chk_gps_pin_has_accuracy;
alter table water_sources add constraint chk_gps_pin_has_accuracy check (
  location_source = 'manual_override' or location_accuracy_m is not null);
alter table water_sources drop constraint if exists chk_accuracy_positive;
alter table water_sources add constraint chk_accuracy_positive check (
  location_accuracy_m is null or location_accuracy_m > 0);

create or replace function guard_water_source() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.location_source = 'manual_override' then
    if not exists (select 1 from profiles p where p.id = NEW.location_overridden_by
                   and p.role = 'supervisor' and p.active) then
      raise exception 'override_approver_must_be_supervisor';
    end if;
    NEW.location_auto_pinned := false;
  else
    NEW.location_auto_pinned := true;
  end if;
  if TG_OP = 'UPDATE' then
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_guard_water_source on water_sources;
create trigger trg_guard_water_source before insert or update on water_sources
  for each row execute function guard_water_source();

create or replace function derive_source_public_status(p_source uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_status text;
begin
  select case
      when exists (select 1 from reports r where r.source_id = ws.id and r.status = 'action_taken') then 'action_pending'
      when exists (select 1 from reports r where r.source_id = ws.id
                   and r.status in ('open', 'sent_to_lab', 'under_review')) then 'under_review'
      when ws.current_public_status = 'lab_verified_safe' then 'lab_verified_safe'
      when exists (select 1 from reports r where r.source_id = ws.id) then 'no_open_issues'
      else ws.current_public_status end
    into v_status
    from water_sources ws where ws.id = p_source;
  update water_sources set current_public_status = v_status
    where id = p_source and current_public_status is distinct from v_status;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Report status changes (flow 5 "message on phone"): queue an SMS to each
--    linked complainant and a push to the report's creator; closing a report
--    closes its linked complaints; the source's public status follows.
--    Queued means queued: delivery needs an SMS/push provider (blocker).
-- ---------------------------------------------------------------------
create or replace function on_report_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    insert into notifications (user_id, recipient_phone, related_report_id, channel, message)
      select c.submitted_by, pa.phone, NEW.id, 'sms',
             'JalSakshi: update on your report ' || c.reference_number || ': '
             || case when NEW.status = 'closed' then 'the investigation is closed.'
                     else 'the investigation status has changed.' end
      from complaints c join public_accounts pa on pa.profile_id = c.submitted_by
      where c.linked_report_id = NEW.id;
    if NEW.created_by is not null then
      insert into notifications (user_id, related_report_id, channel, message)
        values (NEW.created_by, NEW.id, 'push', 'A report you created is now ' || replace(NEW.status, '_', ' ') || '.');
    end if;
    if NEW.status = 'closed' then
      update complaints set status = 'closed' where linked_report_id = NEW.id and status <> 'closed';
    end if;
  end if;
  perform derive_source_public_status(NEW.source_id);
  return NEW;
end;
$$;
drop trigger if exists trg_report_status on reports;
create trigger trg_report_status after insert or update of status on reports
  for each row execute function on_report_status();

-- ---------------------------------------------------------------------
-- 7. Guarded functions. p_actor is the caller's profiles.id, resolved by the
--    API from a verified token. Each re-checks role and team server-side;
--    another team's object is 'not_found', indistinguishable from none.
-- ---------------------------------------------------------------------
create or replace function staff_team(p_actor uuid, p_roles text[]) returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_team uuid;
begin
  select team_id into v_team from profiles
    where id = p_actor and active and role = any(p_roles) and team_id is not null;
  if not found then
    raise exception 'forbidden';
  end if;
  return v_team;
end;
$$;

-- Locks and returns a report of the actor's team.
create or replace function lock_team_report(p_report uuid, p_team uuid) returns reports
language plpgsql set search_path = public, pg_temp as $$
declare
  v reports;
begin
  select r.* into v from reports r join water_sources ws on ws.id = r.source_id
    where r.id = p_report and ws.team_id = p_team
    for update of r;
  if not found then
    raise exception 'report_not_found';
  end if;
  return v;
end;
$$;

create or replace function transition_report(p_report uuid, p_actor uuid, p_expected_version int, p_to text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v reports;
  v_new int;
begin
  v := lock_team_report(p_report, staff_team(p_actor, array['supervisor']));
  if v.version <> p_expected_version then
    raise exception 'version_conflict';
  end if;
  if p_to = 'closed' then
    raise exception 'use_close_report';
  end if;
  if p_to = 'sent_to_lab' then
    raise exception 'use_refer_to_lab';
  end if;
  if not ((v.status = 'open' and p_to in ('under_review', 'action_taken'))
       or (v.status = 'sent_to_lab' and p_to in ('under_review', 'action_taken'))
       or (v.status = 'under_review' and p_to = 'action_taken')
       or (v.status = 'action_taken' and p_to = 'under_review')) then
    raise exception 'transition_illegal';
  end if;
  update reports set status = p_to where id = p_report returning version into v_new;
  insert into audit_log (actor_id, entity_type, entity_id, action, before_data, after_data)
    values (p_actor, 'reports', p_report, 'transition',
            jsonb_build_object('status', v.status, 'version', v.version),
            jsonb_build_object('status', p_to, 'version', v_new));
  return v_new;
end;
$$;

create or replace function refer_to_lab(p_report uuid, p_actor uuid, p_expected_version int, p_lab_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v reports;
  v_referral uuid;
begin
  v := lock_team_report(p_report, staff_team(p_actor, array['supervisor']));
  if v.version <> p_expected_version then
    raise exception 'version_conflict';
  end if;
  if v.status not in ('open', 'under_review', 'sent_to_lab') then
    raise exception 'transition_illegal';
  end if;
  if length(trim(coalesce(p_lab_name, ''))) = 0 then
    raise exception 'lab_name_required';
  end if;
  insert into lab_referrals (report_id, lab_name) values (p_report, trim(p_lab_name)) returning id into v_referral;
  if v.status <> 'sent_to_lab' then
    update reports set status = 'sent_to_lab' where id = p_report;
  end if;
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'lab_referrals', v_referral, 'referred', jsonb_build_object('report_id', p_report, 'lab_name', p_lab_name));
  return v_referral;
end;
$$;

-- Recording a lab result is a fact (worker or supervisor); it never verifies.
create or replace function record_lab_result(p_referral uuid, p_actor uuid, p_file_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid;
  v_ref lab_referrals;
  v reports;
begin
  v_team := staff_team(p_actor, array['supervisor', 'field_worker']);
  select * into v_ref from lab_referrals where id = p_referral for update;
  if not found then
    raise exception 'lab_referral_not_found';
  end if;
  v := lock_team_report(v_ref.report_id, v_team);   -- other team: report_not_found
  if v_ref.verification_status <> 'pending' then
    raise exception 'lab_result_already_recorded';
  end if;
  update lab_referrals set result_file_url = p_file_url, verification_status = 'uploaded' where id = p_referral;
  if v.status = 'sent_to_lab' then
    update reports set status = 'under_review' where id = v.id;
  end if;
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'lab_referrals', p_referral, 'lab_result_recorded', jsonb_build_object('result_file_url', p_file_url));
end;
$$;

-- Verifying is a deliberate supervisor action, never by whoever recorded it.
create or replace function verify_lab_referral(p_referral uuid, p_actor uuid, p_decision text, p_re_report boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid;
  v_ref lab_referrals;
begin
  v_team := staff_team(p_actor, array['supervisor']);
  select * into v_ref from lab_referrals where id = p_referral for update;
  if not found then
    raise exception 'lab_referral_not_found';
  end if;
  perform lock_team_report(v_ref.report_id, v_team);
  if p_decision not in ('verified', 'rejected') then
    raise exception 'decision_invalid';
  end if;
  if v_ref.verification_status in ('verified', 'rejected') then
    raise exception 'lab_referral_decided';
  end if;
  if v_ref.verification_status <> 'uploaded' or v_ref.result_file_url is null then
    raise exception 'lab_result_missing';
  end if;
  if v_ref.result_file_url like 'blob:%' and exists (
       select 1 from photo_blobs b where b.id = substr(v_ref.result_file_url, 6)::uuid and b.availability <> 'available') then
    raise exception 'lab_result_quarantined';
  end if;
  if exists (select 1 from audit_log a where a.entity_type = 'lab_referrals' and a.entity_id = p_referral
             and a.action = 'lab_result_recorded' and a.actor_id = p_actor) then
    raise exception 'self_review';
  end if;
  update lab_referrals set verification_status = p_decision, verified_by = p_actor, verified_at = now(),
                           re_report_requested = coalesce(p_re_report, false)
    where id = p_referral;
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'lab_referrals', p_referral, 'lab_' || p_decision,
            jsonb_build_object('re_report_requested', coalesce(p_re_report, false)));
end;
$$;

-- The ONLY way the API closes a report. Checks every prerequisite itself.
create or replace function close_report(p_report uuid, p_actor uuid, p_expected_version int, p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v reports;
  v_new int;
begin
  v := lock_team_report(p_report, staff_team(p_actor, array['supervisor']));
  if v.version <> p_expected_version then
    raise exception 'version_conflict';
  end if;
  if v.status <> 'action_taken' then
    raise exception 'transition_illegal';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'closure_reason_required';
  end if;
  if not exists (select 1 from lab_referrals l where l.report_id = p_report and l.verification_status = 'verified') then
    if exists (select 1 from lab_referrals l where l.report_id = p_report and l.verification_status = 'uploaded') then
      raise exception 'lab_not_verified';
    end if;
    raise exception 'lab_result_missing';
  end if;
  if not exists (select 1 from process_photos p where p.report_id = p_report
                 and p.process_stage in ('corrective_action', 'closure')) then
    raise exception 'action_evidence_missing';
  end if;
  if exists (select 1 from reports c where c.previous_report_id = p_report and c.status <> 'closed') then
    raise exception 're_report_open';
  end if;
  update reports set status = 'closed', closed_at = now(), closure_reason = trim(p_reason)
    where id = p_report returning version into v_new;
  insert into audit_log (actor_id, entity_type, entity_id, action, before_data, after_data)
    values (p_actor, 'reports', p_report, 'closed',
            jsonb_build_object('status', v.status, 'version', v.version),
            jsonb_build_object('status', 'closed', 'version', v_new, 'closure_reason', trim(p_reason)));
  return v_new;
end;
$$;

-- Supervisor complaint review: escalate (+100 via trigger), link to a report,
-- or dismiss. Unsourced complaints are visible to every supervisor.
create or replace function review_complaint(p_complaint uuid, p_actor uuid, p_action text, p_report uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid;
  v complaints;
  v_status text;
begin
  v_team := staff_team(p_actor, array['supervisor']);
  select c.* into v from complaints c left join water_sources ws on ws.id = c.source_id
    where c.id = p_complaint and (c.source_id is null or ws.team_id = v_team)
    for update of c;
  if not found then
    raise exception 'complaint_not_found';
  end if;
  if v.status = 'closed' then
    raise exception 'complaint_closed';
  end if;
  if p_action = 'escalate' then
    v_status := 'escalated';
    update complaints set status = v_status where id = p_complaint;
  elsif p_action = 'dismiss' then
    if v.status = 'escalated' then
      raise exception 'complaint_escalated';
    end if;
    v_status := 'closed';
    update complaints set status = v_status where id = p_complaint;
  elsif p_action = 'link' then
    perform 1 from reports r join water_sources ws on ws.id = r.source_id
      where r.id = p_report and ws.team_id = v_team and r.status <> 'closed';
    if not found then
      raise exception 'report_not_found';
    end if;
    v_status := case when v.status = 'escalated' then 'escalated' else 'linked' end;
    update complaints set linked_report_id = p_report, status = v_status where id = p_complaint;
  else
    raise exception 'action_invalid';
  end if;
  insert into audit_log (actor_id, entity_type, entity_id, action, before_data, after_data)
    values (p_actor, 'complaints', p_complaint, 'review_' || p_action,
            jsonb_build_object('status', v.status, 'linked_report_id', v.linked_report_id),
            jsonb_build_object('status', v_status, 'linked_report_id', coalesce(p_report, v.linked_report_id)));
  return v_status;
end;
$$;

-- A lab-verified mark is deliberate, needs a verified lab result on a closed
-- report of this source, and is cleared by the next open report.
create or replace function mark_source_lab_verified(p_source uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid;
begin
  v_team := staff_team(p_actor, array['supervisor']);
  perform 1 from water_sources where id = p_source and team_id = v_team for update;
  if not found then
    raise exception 'source_not_found';
  end if;
  if exists (select 1 from reports r where r.source_id = p_source and r.status <> 'closed') then
    raise exception 'source_has_open_reports';
  end if;
  if not exists (select 1 from reports r join lab_referrals l on l.report_id = r.id
                 where r.source_id = p_source and r.status = 'closed' and l.verification_status = 'verified') then
    raise exception 'lab_not_verified';
  end if;
  update water_sources set current_public_status = 'lab_verified_safe' where id = p_source;
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'water_sources', p_source, 'marked_lab_verified', jsonb_build_object('status', 'lab_verified_safe'));
end;
$$;

-- Fulfil or cancel a pending redemption; cancel refunds points and restocks.
create or replace function decide_redemption(p_redemption uuid, p_actor uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v reward_redemptions;
begin
  perform staff_team(p_actor, array['supervisor']);
  select * into v from reward_redemptions where id = p_redemption for update;
  if not found then
    raise exception 'redemption_not_found';
  end if;
  if p_status not in ('fulfilled', 'cancelled') then
    raise exception 'decision_invalid';
  end if;
  if v.status <> 'pending' then
    raise exception 'redemption_decided';
  end if;
  update reward_redemptions set status = p_status where id = p_redemption;
  if p_status = 'cancelled' then
    insert into points_ledger (profile_id, points, reason, awarded_by)
      values (v.profile_id, v.points_spent, 'manual_adjustment', p_actor);
    update sponsor_rewards set quantity_available = quantity_available + 1
      where id = v.reward_id and quantity_available is not null;
  end if;
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'reward_redemptions', p_redemption, 'redemption_' || p_status,
            jsonb_build_object('points_refunded', case when p_status = 'cancelled' then v.points_spent else 0 end));
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Backfill existing rows to the rules above (no fabricated history:
--    past status changes do not get notifications after the fact).
-- ---------------------------------------------------------------------
insert into reports (source_id, test_record_id, risk_level, is_re_report, previous_report_id, created_by)
  select r.source_id, r.test_record_id, r.risk_level, true, r.id, coalesce(lr.verified_by, r.created_by)
  from lab_referrals lr join reports r on r.id = lr.report_id
  where lr.re_report_requested
  on conflict (previous_report_id) where previous_report_id is not null do nothing;

update complaints c set status = 'closed'
  from reports r where r.id = c.linked_report_id and r.status = 'closed' and c.status <> 'closed';

update water_sources ws set current_risk_level = latest.level
  from (select distinct on (source_id) source_id, coalesce(computed_risk_level, 'unknown') as level
        from test_records order by source_id, coalesce(synced_at, created_at) desc, id) latest
  where latest.source_id = ws.id and ws.current_risk_level is distinct from latest.level;

select derive_source_public_status(id) from water_sources;

refresh materialized view public_map_view;

-- ---------------------------------------------------------------------
-- 9. Service role only.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on function
  bump_report_version(), report_from_test_record(), re_report_on_lab_request(), guard_water_source(),
  derive_source_public_status(uuid), on_report_status(), staff_team(uuid, text[]), lock_team_report(uuid, uuid),
  transition_report(uuid, uuid, int, text), refer_to_lab(uuid, uuid, int, text), record_lab_result(uuid, uuid, text),
  verify_lab_referral(uuid, uuid, text, boolean), close_report(uuid, uuid, int, text),
  review_complaint(uuid, uuid, text, uuid), mark_source_lab_verified(uuid, uuid), decide_redemption(uuid, uuid, text)
  from public, anon, authenticated;

commit;
