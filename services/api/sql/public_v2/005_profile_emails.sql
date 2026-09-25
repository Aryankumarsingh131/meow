-- JalSakshi public v2 — every profile has an email, and every profile can sign
-- in with email + password (owner request, 2026-09-25).
--
-- * profiles.email: required, unique, stored lower-case.
--   Staff: always equal to their Supabase Auth (auth.users) email, kept so by a
--   trigger. Residents: their own address; the demo residents get
--   '<first>.<last>.demo@example.org' (fictional fixtures).
-- * Staff sign in through Supabase Auth. The seeded demo auth.users rows were
--   inserted with only id/email/password, so Supabase Auth could not find them
--   (verified: correct password -> 400 invalid_credentials). They are completed
--   here exactly like a Supabase-created user (instance, aud/role, provider
--   metadata, empty token columns, an 'email' identity).
-- * Residents keep their password in public_accounts (not Supabase Auth);
--   create_public_login now takes the email.
--
-- Order: 001 -> 002 -> [seed] -> 004 -> 005. Idempotent.

begin;

-- ---------------------------------------------------------------------
-- 1. Complete the staff logins so Supabase Auth accepts them.
-- ---------------------------------------------------------------------
update auth.users u set
  instance_id = coalesce(u.instance_id, '00000000-0000-0000-0000-000000000000'),
  aud = coalesce(u.aud, 'authenticated'),
  role = coalesce(u.role, 'authenticated'),
  raw_app_meta_data = coalesce(u.raw_app_meta_data, '{"provider": "email", "providers": ["email"]}'::jsonb),
  raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb),
  confirmation_token = coalesce(u.confirmation_token, ''),
  recovery_token = coalesce(u.recovery_token, ''),
  email_change_token_new = coalesce(u.email_change_token_new, ''),
  email_change = coalesce(u.email_change, ''),
  email_change_token_current = coalesce(u.email_change_token_current, ''),
  phone_change = coalesce(u.phone_change, ''),
  phone_change_token = coalesce(u.phone_change_token, ''),
  reauthentication_token = coalesce(u.reauthentication_token, ''),
  updated_at = now()
where u.id in (select auth_user_id from public.profiles where auth_user_id is not null)
  and (u.instance_id is null or u.aud is null or u.raw_app_meta_data is null or u.confirmation_token is null);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now()
from auth.users u
where u.id in (select auth_user_id from public.profiles where auth_user_id is not null)
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- ---------------------------------------------------------------------
-- 2. profiles.email
-- ---------------------------------------------------------------------
alter table profiles add column if not exists email text;

update profiles p set email = lower(u.email)
  from auth.users u where u.id = p.auth_user_id and p.email is distinct from lower(u.email);

update profiles set email = coalesce(
    nullif(trim(both '.' from regexp_replace(lower(coalesce(full_name, '')), '[^a-z0-9]+', '.', 'g')), ''),
    'resident.' || regexp_replace(coalesce(phone, id::text), '[^0-9a-z]', '', 'g')) || '.demo@example.org'
  where role = 'public' and email is null;

alter table profiles alter column email set not null;
alter table profiles drop constraint if exists chk_profile_email;
alter table profiles add constraint chk_profile_email
  check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254);
create unique index if not exists uq_profiles_email on profiles (email);

-- Staff email always mirrors their Supabase Auth login.
create or replace function sync_staff_email() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.auth_user_id is not null then
    select lower(u.email) into NEW.email from auth.users u where u.id = NEW.auth_user_id;
  end if;
  if NEW.email is not null then
    NEW.email := lower(trim(NEW.email));
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_sync_staff_email on profiles;
create trigger trg_sync_staff_email before insert or update of email, auth_user_id on profiles
  for each row execute function sync_staff_email();

-- ---------------------------------------------------------------------
-- 3. Resident accounts are created with their email.
-- ---------------------------------------------------------------------
drop function if exists create_public_login(text, text);
create or replace function create_public_login(p_phone text, p_full_name text, p_email text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_profile_id uuid;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'email_required';
  end if;
  insert into profiles (id, auth_user_id, role, full_name, phone, email)
    values (gen_random_uuid(), null, 'public', p_full_name, p_phone, lower(trim(p_email)))
    returning id into v_profile_id;
  insert into public_accounts (profile_id, phone) values (v_profile_id, p_phone);
  return v_profile_id;
end;
$$;

revoke execute on function create_public_login(text, text, text), sync_staff_email() from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;

commit;
