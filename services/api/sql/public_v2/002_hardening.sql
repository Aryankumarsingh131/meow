-- JalSakshi public v2 — hardening and missing server-side contracts.
-- Applies on top of 001_schema.sql. Idempotent: safe to re-run.
-- Apply:  python tools/apply_public_v2.py 002_hardening.sql
--
-- The FastAPI service (role postgres, BYPASSRLS) is the only intended client of
-- these tables. Supabase's Data API exposes `public` to the publishable key, so
-- anon/authenticated must hold no privilege at all here (db.py's rule for the
-- jalsakshi schema, applied to public).

begin;

-- ---------------------------------------------------------------------
-- 1. Data API lockdown: RLS on everywhere (deny by default, no policies),
--    no grants to anon/authenticated, views run as the caller.
-- ---------------------------------------------------------------------
create table if not exists complaint_rate_limits (
  bucket_key   text not null,               -- e.g. 'complaint:profile:<uuid>', 'complaint:ip:<sha256>'
  window_start timestamptz not null,
  hits         int not null default 0 check (hits >= 0),
  primary key (bucket_key, window_start)
);

do $$
declare t record;
begin
  for t in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and c.relname <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter view leaderboard_public set (security_invoker = true);
alter view leaderboard_field_worker set (security_invoker = true);

-- ---------------------------------------------------------------------
-- 2. One public account per phone NUMBER, not per spelling.
--    '+91-98000-0001' and '+919800000001' were two accounts for one number.
-- ---------------------------------------------------------------------
update public_accounts set phone = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  where phone !~ '^\+[1-9][0-9]{7,14}$';
update profiles p set phone = pa.phone from public_accounts pa
  where pa.profile_id = p.id and p.phone is distinct from pa.phone;
update notifications set recipient_phone = '+' || regexp_replace(recipient_phone, '[^0-9]', '', 'g')
  where recipient_phone is not null and recipient_phone !~ '^\+[1-9][0-9]{7,14}$';

alter table public_accounts drop constraint if exists chk_public_phone_e164;
alter table public_accounts add constraint chk_public_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$');

-- ---------------------------------------------------------------------
-- 3. Security-definer functions: pinned search_path, callable only by the
--    service role.
-- ---------------------------------------------------------------------
alter function create_public_login(text, text) set search_path = public, extensions, pg_temp;
alter function verify_public_login(text, text) set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------
-- 4. Points: each complaint event pays out at most once, and a balance can
--    never go negative (the backstop behind redeem_reward's own check).
-- ---------------------------------------------------------------------
create unique index if not exists uq_points_once_per_complaint_event
  on points_ledger (related_complaint_id, reason)
  where reason in ('complaint_submitted', 'complaint_verified_correct', 'complaint_resolved');

alter table profiles drop constraint if exists chk_points_balance_nonnegative;
alter table profiles add constraint chk_points_balance_nonnegative check (points_balance >= 0);
alter table sponsor_rewards drop constraint if exists chk_quantity_nonnegative;
alter table sponsor_rewards add constraint chk_quantity_nonnegative check (quantity_available is null or quantity_available >= 0);

-- Trigger functions run with the CALLER's search_path. The API's connections
-- use search_path=jalsakshi, where points_ledger does not exist, so every
-- complaint insert through the API failed. Pin them like the definer functions.
alter function apply_points_ledger_entry() set search_path = public, pg_temp;

-- A re-escalated complaint or a reopened-then-closed report used to pay again.
create or replace function award_points_on_complaint_submit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.submitted_by is not null then
    insert into points_ledger (profile_id, points, reason, related_complaint_id)
      values (NEW.submitted_by, 10, 'complaint_submitted', NEW.id)
      on conflict (related_complaint_id, reason)
        where reason in ('complaint_submitted', 'complaint_verified_correct', 'complaint_resolved')
        do nothing;
  end if;
  return NEW;
end;
$$;

create or replace function award_points_on_complaint_verified() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.status = 'escalated' and OLD.status is distinct from 'escalated' and NEW.submitted_by is not null then
    insert into points_ledger (profile_id, points, reason, related_complaint_id)
      values (NEW.submitted_by, 100, 'complaint_verified_correct', NEW.id)
      on conflict (related_complaint_id, reason)
        where reason in ('complaint_submitted', 'complaint_verified_correct', 'complaint_resolved')
        do nothing;
  end if;
  return NEW;
end;
$$;

create or replace function award_points_on_report_closed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  c record;
begin
  if NEW.status = 'closed' and OLD.status is distinct from 'closed' then
    for c in select * from complaints where linked_report_id = NEW.id and submitted_by is not null loop
      insert into points_ledger (profile_id, points, reason, related_complaint_id, related_report_id)
        values (c.submitted_by, 50, 'complaint_resolved', c.id, NEW.id)
        on conflict (related_complaint_id, reason)
          where reason in ('complaint_submitted', 'complaint_verified_correct', 'complaint_resolved')
          do nothing;
    end loop;
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. redeem_reward — atomic, race-safe. Row locks serialise concurrent
--    redemptions of the same reward or by the same account; lock order is
--    always reward then profile, so two redemptions cannot deadlock.
-- ---------------------------------------------------------------------
create or replace function redeem_reward(p_profile_id uuid, p_reward_id uuid)
returns table(redemption_id uuid, points_spent int, points_balance int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cost int;
  v_qty int;
  v_available boolean;
  v_balance int;
  v_id uuid;
begin
  select r.points_required, r.quantity_available,
         r.active and s.active and (s.ended_at is null or s.ended_at > now())
    into v_cost, v_qty, v_available
    from sponsor_rewards r join sponsors s on s.id = r.sponsor_id
    where r.id = p_reward_id
    for update of r;
  if not found then
    raise exception 'reward_not_found';
  end if;
  if not v_available then
    raise exception 'reward_unavailable';
  end if;
  if v_qty is not null and v_qty <= 0 then
    raise exception 'reward_out_of_stock';
  end if;

  select p.points_balance into v_balance
    from profiles p join public_accounts pa on pa.profile_id = p.id
    where p.id = p_profile_id and p.role = 'public' and p.active
    for update of p;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_balance < v_cost then
    raise exception 'insufficient_points';
  end if;

  insert into reward_redemptions (profile_id, reward_id, points_spent, status)
    values (p_profile_id, p_reward_id, v_cost, 'pending')
    returning id into v_id;
  insert into points_ledger (profile_id, points, reason)
    values (p_profile_id, -v_cost, 'reward_redeemed');
  if v_qty is not null then
    update sponsor_rewards set quantity_available = quantity_available - 1 where id = p_reward_id;
  end if;

  return query select v_id, v_cost, (select pr.points_balance from profiles pr where pr.id = p_profile_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Complaint reference numbers and status lookup. A reference is the
--    only thing a caller needs, so it must not be guessable: 40 random bits.
--    Status lookup returns the public status only — never details, photo,
--    submitter or linked report.
-- ---------------------------------------------------------------------
alter table complaints alter column reference_number
  set default ('JS-' || upper(encode(extensions.gen_random_bytes(5), 'hex')));
update complaints set reference_number = 'JS-' || upper(encode(extensions.gen_random_bytes(5), 'hex'))
  where reference_number is null;
alter table complaints alter column reference_number set not null;

create or replace function check_complaint_status(p_reference text)
returns table(reference_number text, status text, complaint_type text, submitted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.reference_number, c.status, c.complaint_type, c.submitted_at
  from complaints c where c.reference_number = upper(trim(p_reference));
$$;

-- ---------------------------------------------------------------------
-- 7. Public map refresh (materialized view; CONCURRENTLY uses the unique
--    index, so readers are never blocked).
-- ---------------------------------------------------------------------
create or replace function refresh_public_map() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  refresh materialized view concurrently public_map_view;
end;
$$;

select cron.schedule('refresh-public-map', '*/15 * * * *', $$select public.refresh_public_map();$$);

-- ---------------------------------------------------------------------
-- 8. Retention. test_records referenced by a report (reports.test_record_id
--    is NOT NULL, no cascade) or by a complaint self-test are evidence chain:
--    deleting them raised a foreign-key error that aborted the WHOLE nightly
--    run, so nothing was ever purged. reports, lab_referrals and complaints
--    are still never touched. Expired rate-limit windows are cleared too.
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
          and not exists (select 1 from complaints c where c.self_test_record_id = t.id);

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
-- 9. leaderboard_location: joining reports AND complaints to water_sources
--    multiplied rows, so sum(points) counted each ledger entry once per
--    report on the same source. Per-source subqueries cannot fan out.
-- ---------------------------------------------------------------------
drop view if exists leaderboard_location;
create view leaderboard_location with (security_invoker = true) as
with per_source as (
  select ws.village, ws.ward,
         (select count(*) from reports r where r.source_id = ws.id and r.status = 'closed') as closed_reports,
         (select coalesce(sum(pl.points), 0) from complaints c
            join points_ledger pl on pl.related_complaint_id = c.id
            where c.source_id = ws.id) as points
  from water_sources ws
)
select village, ward,
       count(*) as sources_tracked,
       sum(closed_reports)::bigint as cases_resolved,
       sum(points)::bigint as total_public_points_earned,
       rank() over (order by sum(closed_reports) desc) as rank
from per_source
group by village, ward
order by cases_resolved desc;

-- ---------------------------------------------------------------------
-- 10. Final revoke pass: covers objects (re)created above.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on function
  create_public_login(text, text), verify_public_login(text, text), purge_old_data(),
  redeem_reward(uuid, uuid), check_complaint_status(text), refresh_public_map()
  from public, anon, authenticated;

commit;
