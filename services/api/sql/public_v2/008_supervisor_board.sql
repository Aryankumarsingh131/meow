-- JalSakshi public v2 — 008: what the supervisor dashboard (apps/supervisor)
-- needs beyond 006. A supervisor may ask for a follow-up sample themselves
-- (a re-report), not only through a lab verification.
-- Order: ... -> 006 -> 007 -> 008. Idempotent.

begin;

create or replace function request_re_report(p_report uuid, p_actor uuid, p_expected_version int)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v reports;
  v_child uuid;
begin
  v := lock_team_report(p_report, staff_team(p_actor, array['supervisor']));
  if v.version <> p_expected_version then
    raise exception 'version_conflict';
  end if;
  if v.status = 'closed' then
    raise exception 'report_closed';
  end if;
  if exists (select 1 from reports c where c.previous_report_id = p_report) then
    raise exception 're_report_exists';
  end if;
  insert into reports (source_id, test_record_id, risk_level, origin, is_re_report, previous_report_id, created_by)
    values (v.source_id, v.test_record_id, v.risk_level, v.origin, true, v.id, p_actor)
    returning id into v_child;
  update reports set version = version where id = p_report;   -- the case changed: bump its version
  insert into audit_log (actor_id, entity_type, entity_id, action, after_data)
    values (p_actor, 'reports', p_report, 're_report_requested', jsonb_build_object('re_report_id', v_child));
  return v_child;
end;
$$;

revoke execute on function request_re_report(uuid, uuid, int) from public, anon, authenticated;

commit;
