"""Snapshot the live v2 data into services/api/local_db/seed.json.

The API's internal fallback database (services/api/app/local_store.py) is
built from this file whenever Supabase cannot be reached. Run it while online
to refresh the snapshot:

    python tools/export_local_seed.py

No passwords or password hashes and no photo/file bytes are exported. Offline
sign-in works only for the demo accounts listed in DEMO_LOGINS (password
1234); everyone else signs in again once Supabase is back.
"""

from __future__ import annotations

import datetime
import decimal
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from apply_public_v2 import database_url  # noqa: E402

import psycopg  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "services/api/local_db/seed.json"

# Offline demo sign-ins: the seeded demo staff (all use 1234) and 1@/2@/3@demo.org.
DEMO_LOGINS_SQL = ("select email from public.profiles where email like '%.demo@example.org' or email like '%@demo.org'"
                   " union select email from public.residents where email like '%@demo.org'")

QUERIES = {
    "teams": "select id, name, region from public.teams",
    "profiles": "select id, email, role, full_name, team_id, active from public.profiles",
    "residents": "select id, email, full_name, phone, active from public.residents",
    "water_sources": ("select id, team_id, name, source_type, st_y(location::geometry) as latitude,"
                      " st_x(location::geometry) as longitude, location_source, location_accuracy_m, village, ward,"
                      " current_risk_level, current_public_status, created_at from public.water_sources"),
    "test_kits": "select id, name, strip_type, dip_instruction, timing_window_sec, read_grace_sec, active, protocol from public.test_kits",
    "inspection_criteria": "select key, category, question, tip, position from public.inspection_criteria",
    "reading_parameters": "select * from public.reading_parameters",
    "kit_parameters": "select kit_id, parameter, position from public.kit_parameters",
    "test_records": ("select t.id, t.local_record_id, t.source_id, t.performed_by, t.kit_id, t.method, t.dropdown_selection,"
                     " t.raw_input, t.autofill_calculation, t.computed_risk_level, t.rule_assessment, t.dip_started_at, t.read_at,"
                     " t.created_at, t.inspection, (select jsonb_object_agg(parameter, value) from public.test_readings r where r.test_record_id = t.id)"
                     " as readings from public.test_records t"),
    "reports": ("select id, source_id, test_record_id, risk_level, status, version, origin, is_re_report, previous_report_id,"
                " created_by, created_at, closed_at, closure_reason from public.reports"),
    "lab_referrals": ("select id, report_id, lab_name, sent_at, verification_status, re_report_requested, verified_by, verified_at"
                      " from public.lab_referrals"),
    "process_photos": "select id, report_id, source_id, process_stage, inspection_level, uploaded_by, uploaded_at from public.process_photos",
    "complaints": ("select id, reference_number, resident_id, source_id, complaint_type, details->>'description' as description,"
                   " status, resolution, linked_report_id, linked_at, linked_by, version, submitted_at from public.complaints"),
    "points_ledger": "select profile_id, points, reason, related_test_record_id, awarded_at from public.points_ledger",
    "notifications": ("select id, related_report_id, channel, message, sent_at, delivery_status from public.notifications"
                      " where related_report_id is not null and channel in ('sms', 'ivr')"),
    "audit_log": ("select actor_id, entity_type, entity_id, action, after_data, at from public.audit_log"
                  " where entity_type in ('reports', 'lab_referrals', 'complaints', 'water_sources') order by at, id"),
}


def plain(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


def main() -> None:
    snapshot: dict = {"exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    with psycopg.connect(database_url(), connect_timeout=45) as conn:
        conn.execute("set search_path = public, extensions")
        for name, sql in QUERIES.items():
            cur = conn.execute(sql)
            cols = [d.name for d in cur.description]
            snapshot[name] = [{c: plain(v) for c, v in zip(cols, row)} for row in cur.fetchall()]
        snapshot["demo_logins"] = sorted(r[0] for r in conn.execute(DEMO_LOGINS_SQL).fetchall())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=1, sort_keys=True), encoding="utf-8")
    print(OUT, {k: len(v) for k, v in snapshot.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
