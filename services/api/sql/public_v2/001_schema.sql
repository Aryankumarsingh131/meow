-- JalSakshi public v2 schema — as supplied by the project owner (2026-09-25)
-- and applied to Supabase that day. Source of truth for the `public` schema.
-- Fixes and missing contracts are in 002_hardening.sql; the erd.md workflow
-- rules and guarded staff functions in 004_erd_workflows.sql.
-- Fresh setup: 001 -> 002 -> [seed_v2_demo.sql, demo only] -> 004.
-- (003_demo_reconcile.sql is a one-off for databases seeded with the original seed.)
--
-- Separate from the FastAPI migrations (services/api/migrations, schema
-- `jalsakshi`): this file needs PostGIS, pg_cron and Supabase's auth schema,
-- which the CI Postgres service does not have.

begin;

create extension if not exists "uuid-ossp";
create extension if not exists postgis;

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  org_type      text not null check (org_type in ('ngo','panchayat','industrial','government','other')),
  contact_info  text,
  created_at    timestamptz not null default now()
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  region      text,
  created_at  timestamptz not null default now()
);

-- Staff (supervisor/field_worker) link to auth.users; public users have no
-- auth.users row and log in through public_accounts.
create table profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete cascade,
  role          text not null check (role in ('supervisor','field_worker','public')),
  full_name     text,
  phone         text,
  language_pref text default 'en',
  team_id       uuid references teams(id),
  org_id        uuid references organizations(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint chk_staff_has_auth_user
    check (role = 'public' or auth_user_id is not null)
);

-- Location is device-GPS by default; manual entry is an explicit, logged exception.
create table water_sources (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  source_type            text not null check (source_type in ('tap','well','hand_pump','tank','pond','river','other')),
  location               geography(point, 4326) not null,
  location_source        text not null check (location_source in ('gps_auto','manual_override')) default 'gps_auto',
  location_accuracy_m    numeric,
  location_auto_pinned   boolean not null default true,
  location_overridden_by uuid references profiles(id),
  location_override_reason text,
  approx_size            text,
  village                text,
  ward                   text,
  landmark               text,
  team_id                uuid references teams(id),
  org_id                 uuid references organizations(id),
  created_by             uuid references profiles(id),
  current_risk_level     text check (current_risk_level in ('unknown','low','medium','high')) default 'unknown',
  current_public_status  text check (current_public_status in ('not_tested','under_review','action_pending','lab_verified_safe')) default 'not_tested',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint chk_manual_override_requires_reason
    check (location_source = 'gps_auto' or (location_overridden_by is not null and location_override_reason is not null))
);

create index idx_water_sources_location on water_sources using gist (location);

create table test_kits (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  strip_type        text not null,
  icon_ref          text,
  timing_window_sec int,
  active            boolean not null default true
);

create table test_records (
  id                     uuid primary key default gen_random_uuid(),
  source_id              uuid not null references water_sources(id),
  performed_by           uuid not null references profiles(id),
  kit_id                 uuid references test_kits(id),
  method                 text not null check (method in ('manual','camera')),
  dropdown_selection     text,
  raw_input              jsonb,
  autofill_calculation   jsonb,
  computed_risk_level    text check (computed_risk_level in ('unknown','low','medium','high')),
  photo_url              text,
  local_record_id        uuid not null unique,
  cached_locally         boolean not null default true,
  synced_at              timestamptz,
  created_at             timestamptz not null default now()
);

create index idx_test_records_source on test_records(source_id);
create index idx_test_records_performer on test_records(performed_by);

create table reports (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references water_sources(id),
  test_record_id     uuid not null references test_records(id),
  risk_level         text not null check (risk_level in ('low','medium','high')),
  status             text not null check (status in ('open','sent_to_lab','under_review','action_taken','closed')) default 'open',
  is_re_report       boolean not null default false,
  previous_report_id uuid references reports(id),
  version            int not null default 1,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closure_reason     text
);

create index idx_reports_source on reports(source_id);
create index idx_reports_previous on reports(previous_report_id);

create table lab_referrals (
  id                    uuid primary key default gen_random_uuid(),
  report_id             uuid not null references reports(id),
  lab_name              text not null,
  sent_at               timestamptz not null default now(),
  result_file_url       text,
  verification_status   text not null check (verification_status in ('pending','uploaded','verified','rejected')) default 'pending',
  re_report_requested   boolean not null default false,
  verified_by           uuid references profiles(id),
  verified_at           timestamptz
);

create index idx_lab_referrals_report on lab_referrals(report_id);

create table process_photos (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid references reports(id),
  source_id        uuid references water_sources(id),
  photo_url        text not null,
  process_stage    text not null check (process_stage in ('initial_capture','lab_referral','corrective_action','retest','closure')),
  inspection_level text check (inspection_level in ('field','supervisor','lab')),
  uploaded_by      uuid references profiles(id),
  uploaded_at      timestamptz not null default now()
);

create index idx_process_photos_report on process_photos(report_id);

create table notifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references profiles(id),
  recipient_phone   text,
  related_report_id uuid references reports(id),
  channel           text not null check (channel in ('sms','ivr','push','in_app')),
  message           text not null,
  sent_at           timestamptz,
  delivery_status   text not null check (delivery_status in ('queued','sent','failed','confirmed')) default 'queued'
);

create index idx_notifications_report on notifications(related_report_id);

create table complaints (
  id                 uuid primary key default gen_random_uuid(),
  submitted_by       uuid references profiles(id),
  source_id          uuid references water_sources(id),
  complaint_type     text not null check (complaint_type in ('discoloration','smell','taste','sediment','illness','other')),
  details            jsonb,
  photo_url          text,
  self_test_record_id uuid references test_records(id),
  status             text not null check (status in ('new','linked','escalated','closed')) default 'new',
  linked_report_id   uuid references reports(id),
  reference_number   text unique,
  submitted_at       timestamptz not null default now()
);

create index idx_complaints_source on complaints(source_id);
create index idx_complaints_report on complaints(linked_report_id);

create table audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references profiles(id),
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  before_data jsonb,
  after_data  jsonb,
  at          timestamptz not null default now()
);

create index idx_audit_log_entity on audit_log(entity_type, entity_id);

-- Fuzzes every location that is not lab-verified.
create materialized view public_map_view as
select
  ws.id            as source_id,
  ws.name,
  ws.source_type,
  ws.current_public_status as status_label,
  ws.updated_at    as last_updated,
  case
    when ws.current_public_status = 'lab_verified_safe'
      then ws.location
    else (st_snaptogrid(ws.location::geometry, 0.005))::geography
  end as public_location
from water_sources ws;

create unique index idx_public_map_view_source on public_map_view(source_id);

create extension if not exists pg_cron;

create table retention_policies (
  id              uuid primary key default gen_random_uuid(),
  entity_table    text not null unique,
  retention_days  int not null,
  delete_strategy text not null check (delete_strategy in ('hard_delete','archive_then_delete')) default 'hard_delete',
  enabled         boolean not null default true,
  notes           text
);

-- reports, lab_referrals and complaints deliberately have NO policy: they are
-- the evidence chain. Add one only with explicit sign-off.
insert into retention_policies (entity_table, retention_days, delete_strategy, notes) values
  ('notifications',   180, 'hard_delete', 'delivery receipts only, low evidentiary value after 6 months'),
  ('process_photos',  730, 'archive_then_delete', 'move to cold storage bucket before deleting row, per case history value'),
  ('test_records',    1095,'archive_then_delete', 'keep 3 years — feeds model retraining and case history'),
  ('audit_log',       1825,'hard_delete', 'keep 5 years for tamper-evidence review, then purge — adjust per legal/domain requirement');

-- purge_old_data() is (re)defined in 002_hardening.sql.
select cron.schedule('nightly-data-purge', '0 2 * * *', $$select purge_old_data();$$);

create extension if not exists pgcrypto;

-- Default password '1234' is a project-owner requirement for the demo; it is
-- hashed and forces a change on first login.
create table public_accounts (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null unique references profiles(id) on delete cascade,
  phone                text not null unique,
  password_hash        text not null default crypt('1234', gen_salt('bf')),
  must_change_password boolean not null default true,
  failed_login_count    int not null default 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now()
);

create or replace function create_public_login(p_phone text, p_full_name text default null)
returns uuid language plpgsql security definer as $$
declare
  v_profile_id uuid;
begin
  insert into profiles (id, auth_user_id, role, full_name, phone)
    values (gen_random_uuid(), null, 'public', p_full_name, p_phone)
    returning id into v_profile_id;

  insert into public_accounts (profile_id, phone) values (v_profile_id, p_phone);

  return v_profile_id;
end;
$$;

create or replace function verify_public_login(p_phone text, p_password text)
returns table(profile_id uuid, must_change_password boolean) language plpgsql security definer as $$
declare
  acc public_accounts%rowtype;
begin
  select * into acc from public_accounts where phone = p_phone;

  if acc.id is null then
    return;
  end if;

  if acc.locked_until is not null and acc.locked_until > now() then
    raise exception 'account temporarily locked';
  end if;

  if acc.password_hash = crypt(p_password, acc.password_hash) then
    update public_accounts
      set last_login_at = now(), failed_login_count = 0
      where id = acc.id;
    return query select acc.profile_id, acc.must_change_password;
  else
    update public_accounts
      set failed_login_count = failed_login_count + 1,
          locked_until = case when failed_login_count + 1 >= 5 then now() + interval '15 minutes' else null end
      where id = acc.id;
    return;
  end if;
end;
$$;

create table sponsors (
  id                 uuid primary key default gen_random_uuid(),
  company_name       text not null,
  logo_url           text,
  contact_email      text,
  sponsorship_tier   text check (sponsorship_tier in ('gold','silver','bronze','partner')) default 'partner',
  active             boolean not null default true,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);

create table sponsor_rewards (
  id                 uuid primary key default gen_random_uuid(),
  sponsor_id         uuid not null references sponsors(id),
  reward_title       text not null,
  description        text,
  points_required    int not null check (points_required > 0),
  quantity_available int,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table reward_redemptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id),
  reward_id     uuid not null references sponsor_rewards(id),
  points_spent  int not null,
  redeemed_at   timestamptz not null default now(),
  status        text not null check (status in ('pending','fulfilled','cancelled')) default 'pending'
);

-- Append-only ledger is the source of truth; points_balance is trigger-maintained.
alter table profiles add column points_balance int not null default 0;

create table points_ledger (
  id                  bigint generated always as identity primary key,
  profile_id          uuid not null references profiles(id),
  points              int not null,
  reason              text not null check (reason in (
                         'complaint_submitted',
                         'complaint_verified_correct',
                         'complaint_resolved',
                         'reward_redeemed',
                         'manual_adjustment'
                       )),
  related_complaint_id uuid references complaints(id),
  related_report_id    uuid references reports(id),
  awarded_by            uuid references profiles(id),
  awarded_at             timestamptz not null default now()
);

create index idx_points_ledger_profile on points_ledger(profile_id);

create or replace function apply_points_ledger_entry() returns trigger
language plpgsql as $$
begin
  update profiles set points_balance = points_balance + NEW.points where id = NEW.profile_id;
  return NEW;
end;
$$;

create trigger trg_points_ledger_apply
  after insert on points_ledger
  for each row execute function apply_points_ledger_entry();

-- award_points_* bodies are replaced (idempotent payouts) in 002_hardening.sql.
create or replace function award_points_on_complaint_submit() returns trigger
language plpgsql as $$ begin return NEW; end; $$;
create or replace function award_points_on_complaint_verified() returns trigger
language plpgsql as $$ begin return NEW; end; $$;
create or replace function award_points_on_report_closed() returns trigger
language plpgsql as $$ begin return NEW; end; $$;

create trigger trg_complaint_submit_points
  after insert on complaints
  for each row execute function award_points_on_complaint_submit();

create trigger trg_complaint_verified_points
  after update on complaints
  for each row execute function award_points_on_complaint_verified();

create trigger trg_report_closed_points
  after update on reports
  for each row execute function award_points_on_report_closed();

create view leaderboard_public as
select
  p.id as profile_id,
  p.full_name,
  p.points_balance,
  rank() over (order by p.points_balance desc) as rank
from profiles p
where p.role = 'public'
order by p.points_balance desc;

create view leaderboard_field_worker as
select
  p.id as profile_id,
  p.full_name,
  p.team_id,
  count(distinct tr.id) as tests_performed,
  count(distinct r.id) filter (where r.status = 'closed') as cases_resolved,
  count(distinct lr.id) filter (where lr.verification_status = 'verified') as lab_verified_count,
  (count(distinct tr.id) + 5 * count(distinct r.id) filter (where r.status = 'closed')) as worker_score,
  rank() over (
    order by (count(distinct tr.id) + 5 * count(distinct r.id) filter (where r.status = 'closed')) desc
  ) as rank
from profiles p
left join test_records tr on tr.performed_by = p.id
left join reports r on r.test_record_id = tr.id
left join lab_referrals lr on lr.report_id = r.id
where p.role = 'field_worker'
group by p.id, p.full_name, p.team_id
order by worker_score desc;

-- leaderboard_location is created in 002_hardening.sql (the original fanned out).

commit;
