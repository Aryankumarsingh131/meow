"""The committed public-v2 SQL rebuilds the database from nothing.

Inside ONE transaction that is always rolled back: drop every public-v2 object
(and the residents' auth users), replay 001 -> 002 -> seed -> 004 -> 005 -> 006,
and check the result is the documented demo state after 006 (residents moved to
Supabase Auth, complaint statuses, no resident points, kit config). Nothing
persists.

It takes exclusive locks on the live public-v2 tables for a few seconds, so it
only runs when asked:

    set PUBLIC_V2_REBUILD_TEST=1 && python -m unittest tests.public_v2_rebuild_test -v
"""

from __future__ import annotations

import os
import re
import unittest
from pathlib import Path

from tests.public_v2_postgres_test import URL, psycopg

SQL_DIR = Path(__file__).resolve().parents[1] / "services/api/sql/public_v2"

DROP_ALL = """
create temp table resident_auth_ids on commit drop as select auth_user_id from public.residents;
drop table if exists residents, test_readings, kit_parameters, reading_parameters cascade;
delete from auth.users where id in (select auth_user_id from resident_auth_ids);
drop function if exists create_resident_login(text, text, text, text, uuid), assess_readings(jsonb),
  award_screening_points(), current_resident_id(), review_complaint(uuid, uuid, text, uuid, int, text) cascade;
drop materialized view if exists public_map_view cascade;
drop view if exists leaderboard_public, leaderboard_field_worker, leaderboard_location cascade;
drop function if exists lock_team_report(uuid, uuid) cascade;
drop table if exists photo_blobs, complaint_rate_limits, points_ledger, reward_redemptions, sponsor_rewards, sponsors,
  public_accounts, retention_policies, audit_log, complaints, notifications, process_photos,
  lab_referrals, reports, test_records, test_kits, water_sources, profiles, teams, organizations cascade;
drop function if exists create_public_login(text, text), create_public_login(text, text, text), sync_staff_email(),
  verify_public_login(text, text),
  purge_old_data(), redeem_reward(uuid, uuid), check_complaint_status(text), refresh_public_map(),
  apply_points_ledger_entry(), award_points_on_complaint_submit(),
  award_points_on_complaint_verified(), award_points_on_report_closed(),
  bump_report_version(), report_from_test_record(), re_report_on_lab_request(), guard_water_source(),
  derive_source_public_status(uuid), on_report_status(), staff_team(uuid, text[]),
  transition_report(uuid, uuid, int, text), refer_to_lab(uuid, uuid, int, text), record_lab_result(uuid, uuid, text),
  verify_lab_referral(uuid, uuid, text, boolean), close_report(uuid, uuid, int, text),
  review_complaint(uuid, uuid, text, uuid), mark_source_lab_verified(uuid, uuid),
  decide_redemption(uuid, uuid, text) cascade;
"""


def body(name: str) -> str:
    """File content without its own begin/commit, to run inside our transaction."""
    sql = (SQL_DIR / name).read_text(encoding="utf-8")
    return re.sub(r"^\s*(begin|commit);\s*$", "", sql, flags=re.IGNORECASE | re.MULTILINE)


@unittest.skipIf(psycopg is None or not URL, "JALSAKSHI_DATABASE_URL not configured")
@unittest.skipUnless(os.environ.get("PUBLIC_V2_REBUILD_TEST") == "1", "set PUBLIC_V2_REBUILD_TEST=1")
class RebuildFromRepoTests(unittest.TestCase):
    def test_schema_hardening_and_seed_rebuild_the_demo_state(self) -> None:
        conn = psycopg.connect(URL, connect_timeout=45)
        try:
            conn.execute("set local statement_timeout = '120s'")
            conn.execute(DROP_ALL)
            for name in ("001_schema.sql", "002_hardening.sql", "seed_v2_demo.sql", "004_erd_workflows.sql",
                         "005_profile_emails.sql", "006_residents_points_pluccy.sql", "006_residents_points_pluccy.sql"):
                with self.subTest(file=name):   # 006 twice: it must be idempotent
                    conn.execute(body(name))

            counts = {
                t: conn.execute(f"select count(*) from {t}").fetchone()[0]
                for t in ("organizations", "teams", "profiles", "residents", "water_sources",
                          "test_kits", "test_records", "reports", "lab_referrals", "process_photos",
                          "notifications", "complaints", "points_ledger", "public_map_view",
                          "reading_parameters", "kit_parameters")
            }
            self.assertEqual(counts, {
                "organizations": 5, "teams": 6, "profiles": 18, "residents": 15,
                # 11 seeded reports + 3 re-reports the lab asked for (erd.md flow 3, 004 backfill).
                "water_sources": 18, "test_kits": 5, "test_records": 20, "reports": 14,
                "lab_referrals": 10, "process_photos": 10, "notifications": 10, "complaints": 15,
                "points_ledger": 0, "public_map_view": 18, "reading_parameters": 9, "kit_parameters": 5,
            })
            for gone in ("public_accounts", "sponsors", "sponsor_rewards", "reward_redemptions", "leaderboard_public"):
                self.assertIsNone(conn.execute("select to_regclass(%s)", (f"public.{gone}",)).fetchone()[0], gone)
            self.assertEqual(conn.execute("select count(*) from profiles where points_balance <> 0").fetchone()[0], 0)
            refs = conn.execute("select count(*) from complaints where reference_number ~ '^JS-[0-9A-F]{10}$'").fetchone()[0]
            self.assertEqual(refs, 15)
            # 006: closed -> resolved (the seed's closed complaints sit on closed reports), escalated/new -> new.
            self.assertEqual(dict(conn.execute("select status || coalesce('/' || resolution, ''), count(*)"
                                               " from complaints group by 1").fetchall()),
                             {"new": 10, "resolved/case_closed": 5})
            self.assertEqual(conn.execute("select count(*) from complaints c join residents r on r.id = c.resident_id")
                             .fetchone()[0], 15)
            self.assertEqual(dict(conn.execute("select origin, count(*) from reports group by 1").fetchall()), {"screening": 14})
            self.assertEqual(dict(conn.execute("select current_public_status, count(*) from water_sources group by 1").fetchall()),
                             {"not_tested": 11, "under_review": 6, "no_open_issues": 1})
            self.assertEqual(conn.execute("select count(*) from reports where is_re_report and status = 'open'").fetchone()[0], 3)
            # Staff keep unique emails (their Supabase Auth logins); residents are auth users now.
            self.assertEqual(conn.execute("select count(*), count(distinct email) from profiles").fetchone(), (18, 18))
            self.assertEqual(conn.execute("select r.email, u.email, (select count(*) from auth.identities i"
                                          " where i.user_id = u.id) from residents r join auth.users u on u.id = r.auth_user_id"
                                          " where r.phone = '+91980000001'").fetchone(),
                             ("vikram.rao.demo@example.org", "vikram.rao.demo@example.org", 1))
        finally:
            conn.rollback()
            conn.close()


if __name__ == "__main__":
    unittest.main()
