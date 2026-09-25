-- JalSakshi public v2 — 006: residents, resident complaints, Pluccy screenings,
-- field-worker points. Owner decisions of 2026-09-25 (current-state.md):
--
-- * Residents are Supabase Auth users with their own `residents` row. They are
--   NOT profiles (profiles is staff-only: supervisor | field_worker).
--   public_accounts (phone + password, '1234' default) is removed; the demo
--   residents move over with fresh random passwords.
-- * complaints ARE the resident complaint intake. status new -> linked ->
--   resolved (resolution: case_closed | dismissed). Linking to a report is a
--   supervisor action that must name the report's current version.
-- * reports.origin in ('screening', 'resident'). A resident-origin report has
--   no test record; a supervisor opens it from a complaint.
-- * One points system: points_ledger, field workers only. +10 for a screening
--   with every kit reading filled in, a photo, and the strip read inside the
--   kit's window (timing_window_sec .. + read_grace_sec after the dip).
--   Resident points, sponsors, rewards and redemptions are removed.
-- * Pluccy kit config: reading_parameters (label, unit, input range, tip,
--   screening bands) and kit_parameters; one test_readings row per reading.
--   assess_readings() turns readings into a rule-based risk level.
--
-- RLS: residents may read their own residents row and their own complaints
-- (resident-safe columns only) as `authenticated`. Everything else stays
-- deny-all to anon/authenticated. Re-running 002/004/005 revokes these grants
-- (fails closed); re-run this file after them.
--
-- Order: 001 -> 002 -> [seed] -> 004 -> 005 -> 006. Idempotent.

begin;

-- ---------------------------------------------------------------------
-- 1. Residents: Supabase Auth user + residents row.
-- ---------------------------------------------------------------------
create table if not exists residents (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name    text check (full_name is null or length(full_name) <= 100),
  email        text not null unique
                 check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  phone        text unique check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table residents enable row level security;

-- Filled in exactly like a Supabase-created user (see 005), so GoTrue's
-- password grant accepts it. The email is NOT verified: no email provider is
-- configured (same blocker as SMS).
create or replace function create_resident_login(p_email text, p_password text, p_full_name text,
                                                 p_phone text, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid   uuid := coalesce(p_id, gen_random_uuid());
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'password_too_short';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'email_taken';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
            crypt(p_password, gen_salt('bf')), now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
            'email', now(), now());
  insert into residents (id, auth_user_id, full_name, email, phone)
    values (v_uid, v_uid, nullif(trim(p_full_name), ''), v_email, p_phone);
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. One-time conversion of the phone-login residents (skipped once done).
-- ---------------------------------------------------------------------
do $$
declare
  p record;
begin
  if to_regclass('public.public_accounts') is null then
    return;
  end if;

  -- Residents keep their id; the password is random and known to nobody
  -- (tools set a fresh one per resident and report it once).
  for p in select pr.id, pr.email, pr.full_name, pa.phone
           from profiles pr left join public_accounts pa on pa.profile_id = pr.id
           where pr.role = 'public' and not exists (select 1 from residents r where r.id = pr.id) loop
    perform create_resident_login(p.email, encode(gen_random_bytes(18), 'base64'), p.full_name, p.phone, p.id);
  end loop;

  drop trigger if exists trg_complaint_submit_points on complaints;
  drop trigger if exists trg_complaint_verified_points on complaints;
  drop trigger if exists trg_report_closed_points on reports;

  -- complaints: submitted_by (profile) -> resident_id; statuses remapped.
  alter table complaints add column resident_id uuid references residents(id);
  update complaints set resident_id = submitted_by;
  alter table complaints drop constraint if exists complaints_status_check;
  alter table complaints add column resolution text;
  update complaints set status = case when status = 'closed' then 'resolved'
                                      when linked_report_id is not null then 'linked'
                                      else 'new' end;
  update complaints set resolution = case when linked_report_id is not null then 'case_closed' else 'dismissed' end
    where status = 'resolved';
  alter table complaints drop column submitted_by;
  alter table complaints drop column self_test_record_id;   -- residents are not profiles; no resident self-tests

  -- Resident points and the reward marketplace go; the ledger is workers only.
  delete from points_ledger where profile_id in (select id from profiles where role = 'public');
  drop view if exists leaderboard_public, leaderboard_field_worker, leaderboard_location;
  drop function if exists redeem_reward(uuid, uuid), decide_redemption(uuid, uuid, text),
    check_complaint_status(text), create_public_login(text, text), create_public_login(text, text, text),
    verify_public_login(text, text), award_points_on_complaint_submit(), award_points_on_complaint_verified(),
    award_points_on_report_closed();
  drop table reward_redemptions, sponsor_rewards, sponsors, public_accounts;

  update notifications set user_id = null where user_id in (select id from profiles where role = 'public');
  update audit_log set actor_id = null where actor_id in (select id from profiles where role = 'public');
  update photo_blobs set uploaded_by = null where uploaded_by in (select id from profiles where role = 'public');
  delete from profiles where role = 'public';
end $$;

-- ---------------------------------------------------------------------
-- 3. profiles is staff-only.
-- ---------------------------------------------------------------------
alter table profiles drop constraint if exists chk_staff_has_auth_user;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('supervisor', 'field_worker'));
alter table profiles alter column auth_user_id set not null;

-- ---------------------------------------------------------------------
-- 4. Resident complaints.
-- ---------------------------------------------------------------------
alter table complaints alter column resident_id set not null;
alter table complaints add column if not exists linked_at timestamptz;
alter table complaints add column if not exists linked_by uuid references profiles(id);
alter table complaints add column if not exists version int not null default 1;
create index if not exists idx_complaints_resident on complaints(resident_id);

alter table complaints drop constraint if exists complaints_status_check;
alter table complaints add constraint complaints_status_check check (status in ('new', 'linked', 'resolved'));
alter table complaints drop constraint if exists chk_complaint_resolution;
-- Written NULL-safe: a CHECK that evaluates to NULL passes.
alter table complaints add constraint chk_complaint_resolution check (
  (status = 'resolved') = (resolution is not null) and coalesce(resolution, 'case_closed') in ('case_closed', 'dismissed'));
alter table complaints drop constraint if exists chk_complaint_link;
alter table complaints add constraint chk_complaint_link check (
  status = 'new' and linked_report_id is null
  or status = 'linked' and linked_report_id is not null
  or status = 'resolved');

-- bump_report_version() is generic (NEW.version := OLD.version + 1).
drop trigger if exists trg_complaints_version on complaints;
create trigger trg_complaints_version before update on complaints
  for each row execute function bump_report_version();

-- ---------------------------------------------------------------------
-- 5. reports.origin. A resident-origin report has no test record.
-- ---------------------------------------------------------------------
alter table reports add column if not exists origin text not null default 'screening';
alter table reports drop constraint if exists chk_report_origin;
alter table reports add constraint chk_report_origin check (origin in ('screening', 'resident'));
alter table reports alter column test_record_id drop not null;
alter table reports drop constraint if exists chk_report_origin_evidence;
alter table reports add constraint chk_report_origin_evidence check ((origin = 'screening') = (test_record_id is not null));

create or replace function re_report_on_lab_request() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.re_report_requested and (TG_OP = 'INSERT' or not OLD.re_report_requested) then
    insert into reports (source_id, test_record_id, risk_level, origin, is_re_report, previous_report_id, created_by)
      select r.source_id, r.test_record_id, r.risk_level, r.origin, true, r.id, coalesce(NEW.verified_by, r.created_by)
      from reports r where r.id = NEW.report_id
      on conflict (previous_report_id) where previous_report_id is not null do nothing;
  end if;
  return NEW;
end;
$$;

-- Status change: SMS to each linked resident with a phone, push to the
-- report's creator; closing resolves the linked complaints.
create or replace function on_report_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    insert into notifications (recipient_phone, related_report_id, channel, message)
      select r.phone, NEW.id, 'sms',
             'JalSakshi: update on your complaint ' || c.reference_number || ': '
             || case when NEW.status = 'closed' then 'the investigation is closed.'
                     else 'the investigation status has changed.' end
      from complaints c join residents r on r.id = c.resident_id
      where c.linked_report_id = NEW.id and r.phone is not null;
    if NEW.created_by is not null then
      insert into notifications (user_id, related_report_id, channel, message)
        values (NEW.created_by, NEW.id, 'push', 'A report you created is now ' || replace(NEW.status, '_', ' ') || '.');
    end if;
    if NEW.status = 'closed' then
      update complaints set status = 'resolved', resolution = 'case_closed'
        where linked_report_id = NEW.id and status = 'linked';
    end if;
  end if;
  perform derive_source_public_status(NEW.source_id);
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Supervisor complaint review: link (to a report, at its current
--    version), open_report (a resident-origin report from this complaint),
--    or dismiss. Another team's complaint or report is not_found.
-- ---------------------------------------------------------------------
drop function if exists review_complaint(uuid, uuid, text, uuid);
create or replace function review_complaint(p_complaint uuid, p_actor uuid, p_action text, p_report uuid,
                                            p_expected_version int, p_risk_level text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid;
  v complaints;
  r reports;
  v_report uuid;
  v_status text;
begin
  v_team := staff_team(p_actor, array['supervisor']);
  select c.* into v from complaints c left join water_sources ws on ws.id = c.source_id
    where c.id = p_complaint and (c.source_id is null or ws.team_id = v_team)
    for update of c;
  if not found then
    raise exception 'complaint_not_found';
  end if;
  if v.status <> 'new' then
    raise exception 'complaint_not_new';
  end if;

  if p_action = 'link' then
    r := lock_team_report(p_report, v_team);
    if r.status = 'closed' then
      raise exception 'report_closed';
    end if;
    if v.source_id is not null and r.source_id <> v.source_id then
      raise exception 'source_mismatch';
    end if;
    if p_expected_version is null or r.version <> p_expected_version then
      raise exception 'version_conflict';
    end if;
    update reports set version = version where id = r.id;   -- linking changes the case: bump its version
    v_report := r.id;
    v_status := 'linked';
  elsif p_action = 'open_report' then
    if v.source_id is null then
      raise exception 'complaint_needs_source';
    end if;
    if coalesce(p_risk_level, '') not in ('low', 'medium', 'high') then
      raise exception 'risk_level_invalid';
    end if;
    insert into reports (source_id, test_record_id, risk_level, origin, created_by)
      values (v.source_id, null, p_risk_level, 'resident', p_actor) returning id into v_report;
    v_status := 'linked';
  elsif p_action = 'dismiss' then
    update complaints set status = 'resolved', resolution = 'dismissed' where id = p_complaint;
    v_status := 'resolved';
  else
    raise exception 'action_invalid';
  end if;

  if v_status = 'linked' then
    update complaints set status = 'linked', linked_report_id = v_report, linked_at = now(), linked_by = p_actor
      where id = p_complaint;
  end if;
  insert into audit_log (actor_id, entity_type, entity_id, action, before_data, after_data)
    values (p_actor, 'complaints', p_complaint, 'review_' || p_action,
            jsonb_build_object('status', v.status),
            jsonb_build_object('status', v_status, 'linked_report_id', v_report));
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Pluccy kit config and per-reading rows.
--    Bands: 'low' inside ok_min..ok_max, 'medium' inside watch_min..watch_max,
--    else 'high'. They are SCREENING bands (BIS 10500:2012 acceptable /
--    permissible limits where one exists), not a lab verdict.
-- ---------------------------------------------------------------------
create table if not exists reading_parameters (
  key        text primary key check (key ~ '^[a-z_]{2,32}$'),
  label      text not null,
  unit       text not null default '',
  input_kind text not null default 'number' check (input_kind in ('number', 'presence')),
  min_value  numeric not null,
  max_value  numeric not null,
  ok_min     numeric,
  ok_max     numeric,
  watch_min  numeric,
  watch_max  numeric,
  tip        text not null,
  basis      text not null,
  check (min_value < max_value)
);
alter table reading_parameters enable row level security;

insert into reading_parameters (key, label, unit, input_kind, min_value, max_value, ok_min, ok_max, watch_min, watch_max, tip, basis) values
  ('ph', 'pH', '', 'number', 0, 14, 6.5, 8.5, 5.5, 9.5,
   'Match the pad to the colour chart in daylight, straight after pulling it out.', 'BIS 10500 acceptable 6.5-8.5; watch band 5.5-9.5'),
  ('chlorine', 'Free chlorine', 'mg/L', 'number', 0, 10, 0.2, 1.0, 0, 4,
   'Read the chlorine pad first; its colour fades within a minute.', 'BIS 10500 residual 0.2-1.0; WHO max 5'),
  ('iron', 'Iron', 'mg/L', 'number', 0, 10, 0, 0.3, 0, 1.0,
   'Compare against the chart held flat; a pale orange tint counts.', 'BIS 10500 acceptable 0.3, permissible 1.0'),
  ('tds', 'Total dissolved solids', 'mg/L', 'number', 0, 5000, 0, 500, 0, 2000,
   'Type the number shown on the meter strip, not the colour band.', 'BIS 10500 acceptable 500, permissible 2000'),
  ('coliform', 'Coliform bacteria', '', 'presence', 0, 1, 0, 0, 0, 0,
   'Any colour change in the vial means present. When unsure, choose present.', 'BIS 10500: not detectable in 100 mL'),
  ('turbidity', 'Turbidity', 'NTU', 'number', 0, 1000, 0, 1, 0, 5,
   'Look down through the tube against the printed mark on a white surface.', 'BIS 10500 acceptable 1, permissible 5'),
  ('nitrate', 'Nitrate', 'mg/L', 'number', 0, 500, 0, 45, 0, 45,
   'Wait for the full colour to develop before comparing.', 'BIS 10500 acceptable 45'),
  ('fluoride', 'Fluoride', 'mg/L', 'number', 0, 20, 0, 1.0, 0, 1.5,
   'Compare in shade; direct sun washes out the pink shades.', 'BIS 10500 acceptable 1.0, permissible 1.5'),
  ('hardness', 'Total hardness', 'mg/L CaCO3', 'number', 0, 2000, 0, 200, 0, 600,
   'Count the pads that changed colour and read the matching value.', 'BIS 10500 acceptable 200, permissible 600')
on conflict (key) do update set
  label = excluded.label, unit = excluded.unit, input_kind = excluded.input_kind,
  min_value = excluded.min_value, max_value = excluded.max_value,
  ok_min = excluded.ok_min, ok_max = excluded.ok_max, watch_min = excluded.watch_min, watch_max = excluded.watch_max,
  tip = excluded.tip, basis = excluded.basis;

create table if not exists kit_parameters (
  kit_id    uuid not null references test_kits(id) on delete cascade,
  parameter text not null references reading_parameters(key),
  position  int not null default 0,
  primary key (kit_id, parameter)
);
alter table kit_parameters enable row level security;

alter table test_kits add column if not exists dip_instruction text;
alter table test_kits add column if not exists read_grace_sec int not null default 60;
alter table test_kits drop constraint if exists chk_read_grace;
alter table test_kits add constraint chk_read_grace check (read_grace_sec between 0 and 3600);

-- The five demo kits each measure one parameter.
insert into kit_parameters (kit_id, parameter)
  select k.id, m.param from test_kits k
  join (values ('chlorine', 'chlorine'), ('iron', 'iron'), ('coliform', 'coliform'), ('pH', 'ph'), ('TDS', 'tds'))
    as m(strip, param) on m.strip = k.strip_type
  on conflict do nothing;
update test_kits set dip_instruction = case strip_type
    when 'coliform' then 'Fill the vial to the line, close it, and keep it upright and warm.'
    else 'Dip the strip so every pad is under water for 2 seconds, then hold it flat, pads up.' end
  where dip_instruction is null;

create table if not exists test_readings (
  test_record_id uuid not null references test_records(id) on delete cascade,
  parameter      text not null references reading_parameters(key),
  value          numeric not null,
  primary key (test_record_id, parameter)
);
alter table test_readings enable row level security;

alter table test_records add column if not exists dip_started_at timestamptz;
alter table test_records add column if not exists read_at timestamptz;
alter table test_records add column if not exists rule_assessment jsonb;
alter table test_records drop constraint if exists chk_read_after_dip;
alter table test_records add constraint chk_read_after_dip check (read_at is null or dip_started_at is null or read_at >= dip_started_at);

-- Rule-based assessment: {"risk_level", "findings": [{parameter, value, level}]}.
create or replace function assess_readings(p_readings jsonb) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with v as (
    select rp.key, (p_readings ->> rp.key)::numeric as value,
           case when (rp.ok_min is null or (p_readings ->> rp.key)::numeric >= rp.ok_min)
                 and (rp.ok_max is null or (p_readings ->> rp.key)::numeric <= rp.ok_max) then 1
                when (rp.watch_min is null or (p_readings ->> rp.key)::numeric >= rp.watch_min)
                 and (rp.watch_max is null or (p_readings ->> rp.key)::numeric <= rp.watch_max) then 2
                else 3 end as rank
    from reading_parameters rp where p_readings ? rp.key
  )
  select jsonb_build_object(
    'risk_level', coalesce((select (array['low', 'medium', 'high'])[max(rank)] from v), 'unknown'),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('parameter', key, 'value', value,
                                            'level', (array['low', 'medium', 'high'])[rank]) order by key) from v), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- 8. Points: field workers only, one ledger.
-- ---------------------------------------------------------------------
alter table points_ledger drop column if exists related_complaint_id;
alter table points_ledger drop column if exists related_report_id;
alter table points_ledger add column if not exists related_test_record_id uuid references test_records(id);
alter table points_ledger drop constraint if exists points_ledger_reason_check;
alter table points_ledger add constraint points_ledger_reason_check check (reason in ('screening_on_time', 'manual_adjustment'));
create unique index if not exists uq_points_once_per_screening
  on points_ledger (related_test_record_id) where reason = 'screening_on_time';
update profiles p set points_balance = coalesce((select sum(l.points) from points_ledger l where l.profile_id = p.id), 0)
  where points_balance is distinct from coalesce((select sum(l.points) from points_ledger l where l.profile_id = p.id), 0);

-- Deferred to COMMIT, so the photo and readings written after the insert in
-- the same transaction count. ponytail: dip/read times come from the phone's
-- clock; a server-issued dip token would make them tamper-evident.
create or replace function award_screening_points() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  t test_records;
  k test_kits;
  elapsed numeric;
begin
  select * into t from test_records where id = NEW.id;
  if not found or t.photo_url is null or t.dip_started_at is null or t.read_at is null then
    return null;
  end if;
  if not exists (select 1 from profiles p where p.id = t.performed_by and p.role = 'field_worker' and p.active) then
    return null;
  end if;
  select * into k from test_kits where id = t.kit_id;
  if not found or k.timing_window_sec is null or not exists (select 1 from kit_parameters kp where kp.kit_id = k.id) then
    return null;
  end if;
  elapsed := extract(epoch from t.read_at - t.dip_started_at);
  if elapsed < k.timing_window_sec or elapsed > k.timing_window_sec + k.read_grace_sec then
    return null;
  end if;
  if exists (select 1 from kit_parameters kp where kp.kit_id = k.id and not exists (
               select 1 from test_readings r where r.test_record_id = t.id and r.parameter = kp.parameter)) then
    return null;
  end if;
  insert into points_ledger (profile_id, points, reason, related_test_record_id)
    values (t.performed_by, 10, 'screening_on_time', t.id)
    on conflict (related_test_record_id) where reason = 'screening_on_time' do nothing;
  return null;
end;
$$;
drop trigger if exists trg_screening_points on test_records;
create constraint trigger trg_screening_points after insert on test_records
  deferrable initially deferred for each row execute function award_screening_points();

-- ---------------------------------------------------------------------
-- 9. Retention: a test record that earned points is evidence too.
-- ---------------------------------------------------------------------
create or replace function purge_old_data() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pol record;
begin
  for pol in select * from retention_policies where enabled loop
    if pol.entity_table = 'notifications' then
      delete from notifications
        where sent_at is not null and sent_at < now() - (pol.retention_days || ' days')::interval;
    elsif pol.entity_table = 'process_photos' then
      delete from process_photos
        where uploaded_at < now() - (pol.retention_days || ' days')::interval;
    elsif pol.entity_table = 'test_records' then
      delete from test_records t
        where t.created_at < now() - (pol.retention_days || ' days')::interval
          and t.synced_at is not null
          and not exists (select 1 from reports r where r.test_record_id = t.id)
          and not exists (select 1 from points_ledger pl where pl.related_test_record_id = t.id);
    elsif pol.entity_table = 'audit_log' then
      delete from audit_log
        where at < now() - (pol.retention_days || ' days')::interval;
    end if;
    insert into audit_log (entity_type, entity_id, action, after_data)
      values ('retention_policies', pol.id, 'purge_run', jsonb_build_object('table', pol.entity_table, 'ran_at', now()));
  end loop;
  delete from complaint_rate_limits where window_start < now() - interval '1 day';
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Row-level security for residents. The API runs resident reads as
--     `authenticated` with the resident's JWT claims, so these policies -
--     not API code - decide what a resident can see. Staff tokens have no
--     residents row and see nothing here.
-- ---------------------------------------------------------------------
create or replace function current_resident_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from residents r where r.auth_user_id = auth.uid() and r.active;
$$;

drop policy if exists residents_read_own on residents;
create policy residents_read_own on residents for select to authenticated
  using (id = current_resident_id());
drop policy if exists complaints_read_own on complaints;
create policy complaints_read_own on complaints for select to authenticated
  using (resident_id = current_resident_id());

-- ---------------------------------------------------------------------
-- 11. Privileges: service role only, except the resident-safe columns.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select (id, full_name, email, phone, created_at) on residents to authenticated;
grant select (id, reference_number, complaint_type, details, status, resolution, source_id, submitted_at, linked_at)
  on complaints to authenticated;

revoke execute on function
  create_resident_login(text, text, text, text, uuid), re_report_on_lab_request(), on_report_status(),
  review_complaint(uuid, uuid, text, uuid, int, text), assess_readings(jsonb), award_screening_points(),
  purge_old_data(), current_resident_id()
  from public, anon, authenticated;
grant execute on function current_resident_id() to authenticated;

commit;
