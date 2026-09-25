-- JalSakshi public v2 — 007: three easy DEMO logins (owner request, 2026-09-25).
--   1@demo.org  field worker, East Plains team
--   2@demo.org  supervisor,   East Plains team
--   3@demo.org  resident
-- Password 1234 for all three. Demo only: delete these rows before any real use.
-- Order: ... -> 006 -> 007. Idempotent.

begin;

create or replace function pg_temp.demo_auth_user(p_id uuid, p_email text) returns void
language plpgsql as $$
begin
  if exists (select 1 from auth.users where id = p_id) then
    return;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
            extensions.crypt('1234', extensions.gen_salt('bf')), now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (p_id::text, p_id,
            jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
            'email', now(), now());
end;
$$;

select pg_temp.demo_auth_user('00000000-0000-4000-8000-000000000001', '1@demo.org'),
       pg_temp.demo_auth_user('00000000-0000-4000-8000-000000000002', '2@demo.org'),
       pg_temp.demo_auth_user('00000000-0000-4000-8000-000000000003', '3@demo.org');

insert into profiles (id, auth_user_id, role, full_name, language_pref, team_id, email)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'field_worker',
        'Demo Field Worker', 'en', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50', '1@demo.org'),
       ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'supervisor',
        'Demo Supervisor', 'en', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50', '2@demo.org')
on conflict (id) do nothing;

insert into residents (id, auth_user_id, full_name, email)
values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'Demo Resident', '3@demo.org')
on conflict (id) do nothing;

commit;
