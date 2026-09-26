"""Fill the live v2 database with 12 weeks of SYNTHETIC demo activity, so the
dashboard, graphs, map and leaderboard look like a system in use.

    python tools/seed_bulk_demo.py            # adds the data (idempotent)
    python tools/seed_bulk_demo.py --dry-run  # builds everything, then rolls back

What it adds, per team: new water sources (GPS pins around the team's area),
screenings by the team's field workers on most days with readings drawn around
the BIS bands and sanitary judgement answers, the reports the database's own
triggers open for flagged screenings, those reports moving through lab referral,
verification, corrective action and closure, and resident complaints.

Everything is synthetic: names are generic, proof/lab/repair "photos" are small
generated images labelled SYNTHETIC DEMO. IDs are uuid5 of fixed keys, so a
second run inserts nothing new. The database's rules still apply: risk comes
from the same assessment as the API (public_v2), points from the 006 trigger.
"""

from __future__ import annotations

import base64
import io
import json
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import psycopg  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from apply_public_v2 import database_url  # noqa: E402
from services.api.app.public_v2 import Upload, combine, judge, store_upload  # noqa: E402

NS = uuid.UUID("5b0c0de0-0000-4000-8000-00000000d3a0")
DAYS = 84
IST = timezone(timedelta(hours=5, minutes=30))
SOURCE_TEMPLATES = [
    ("Government School Tap", "tap"), ("Temple Well", "well"), ("Market Hand Pump", "hand_pump"),
    ("Anganwadi Tank", "tank"), ("Village Pond", "pond"), ("Canal Intake", "river"),
    ("Health Centre Tap", "tap"), ("Bus Stand Hand Pump", "hand_pump"), ("Panchayat Overhead Tank", "tank"),
]
COMPLAINT_TEXT = {
    "discoloration": "The water has looked yellowish for a few days.", "smell": "There is a strong smell when the tap opens.",
    "taste": "The water tastes metallic since last week.", "sediment": "Sand and particles settle at the bottom of the pot.",
    "illness": "Several children in our lane had stomach upsets.", "other": "The platform around the pump is broken.",
}
CLOSURE_REASONS = ["Platform repaired and retest within band", "Chlorination restored; lab result verified",
                   "Pipe leak fixed; follow-up screening within band", "Source cleaned and lab re-test verified"]


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "/".join(map(str, parts))))


def demo_image(title: str, colour: tuple[int, int, int]) -> Upload:
    img = Image.new("RGB", (320, 200), (245, 247, 250))
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(52, 120, 200), (240, 190, 60), (220, 90, 60), (90, 170, 110), colour]):
        d.rectangle([20 + i * 56, 30, 60 + i * 56, 130], fill=c)
    d.text((20, 150), f"SYNTHETIC DEMO - {title}", fill=(20, 40, 70))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return Upload(content_type="image/jpeg", data_base64=base64.b64encode(buf.getvalue()).decode())


def draw_reading(rng: random.Random, p: dict) -> float:
    if p["input_kind"] == "presence":
        return 1.0 if rng.random() < 0.06 else 0.0
    lo, hi = p["min_value"], p["max_value"]
    ok_lo, ok_hi = p["ok_min"] if p["ok_min"] is not None else lo, p["ok_max"] if p["ok_max"] is not None else hi
    w_lo, w_hi = p["watch_min"] if p["watch_min"] is not None else lo, p["watch_max"] if p["watch_max"] is not None else hi
    r = rng.random()
    if r < 0.93:
        v = rng.uniform(ok_lo, ok_hi)
    elif r < 0.985 and (ok_lo - w_lo > 1e-9 or w_hi - ok_hi > 1e-9):
        sides = [(w_lo, ok_lo)] * (ok_lo - w_lo > 1e-9) + [(ok_hi, w_hi)] * (w_hi - ok_hi > 1e-9)
        a, b = rng.choice(sides)
        v = rng.uniform(a, b)
    else:
        v = rng.uniform(w_hi, min(hi, w_hi * 1.8 + 0.5)) if w_hi < hi else rng.uniform(lo, w_lo)
    return round(min(max(v, lo), hi), 1 if p["key"] == "ph" else 2)


def assess(params: dict[str, dict], readings: dict[str, float]) -> dict:
    """Same bands as the database's assess_readings (006), computed here to save round trips."""
    def rank(p: dict, v: float) -> int:
        inside = lambda lo, hi: (lo is None or v >= lo) and (hi is None or v <= hi)  # noqa: E731
        return 1 if inside(p["ok_min"], p["ok_max"]) else 2 if inside(p["watch_min"], p["watch_max"]) else 3
    ranks = {k: rank(params[k], v) for k, v in readings.items()}
    names = ["low", "medium", "high"]
    return {"risk_level": names[max(ranks.values()) - 1] if ranks else "unknown",
            "findings": [{"parameter": k, "value": readings[k], "level": names[ranks[k] - 1]} for k in sorted(ranks)]}


WORKER_NAMES = ["Asha Kumari", "Ravi Shankar", "Meena Patel", "Imran Qureshi", "Lakshmi Iyer", "Suresh Yadav",
                "Pooja Verma", "Arun Nair", "Kavita Joshi", "Deepak Singh", "Farida Begum", "Manoj Tiwari"]


def rename_demo_workers(conn) -> None:
    """Generic 'Field Worker <Area>-N' names become ordinary synthetic names (the public board shows first name + initial)."""
    rows = conn.execute("select id from profiles where full_name like 'Field Worker %%' order by email").fetchall()
    for (pid,), name in zip(rows, WORKER_NAMES):
        conn.execute("update profiles set full_name = %s where id = %s", (name, pid))


def main(dry_run: bool) -> None:
    rng = random.Random(2026)
    now = datetime.now(timezone.utc)
    with psycopg.connect(database_url(), connect_timeout=45) as conn:
        conn.execute("set search_path = public, extensions")
        rename_demo_workers(conn)
        conn.commit()
        teams = conn.execute("select id::text, region from teams order by region").fetchall()
        if conn.execute("select 1 from water_sources where id = %s", (uid("source", teams[0][0], 0),)).fetchone():
            print("already seeded; nothing to do")
            return
        params = {r[0]: dict(zip(["key", "input_kind", "min_value", "max_value", "ok_min", "ok_max", "watch_min", "watch_max"],
                                 [r[0], r[1], *[float(x) if x is not None else None for x in r[2:]]]))
                  for r in conn.execute("select key, input_kind, min_value, max_value, ok_min, ok_max, watch_min, watch_max"
                                        " from reading_parameters")}
        kits = [(k, w, g, [r[0] for r in conn.execute("select parameter from kit_parameters where kit_id = %s order by position", (k,))])
                for k, w, g in conn.execute("select id::text, timing_window_sec, read_grace_sec from test_kits"
                                            " where active and timing_window_sec < 3600").fetchall()]
        kits = [k for k in kits if k[3]]
        criteria = conn.execute("select key, category from inspection_criteria").fetchall()
        first_staff = conn.execute("select id::text from profiles where role = 'supervisor' order by email limit 1").fetchone()[0]
        photos = {name: store_upload(conn, demo_image(name, colour), first_staff, images_only=True)
                  for name, colour in (("strip photo", (120, 60, 160)), ("lab result", (40, 40, 40)), ("repair", (60, 140, 60)))}
        residents = [r[0] for r in conn.execute("select id::text from residents where active order by email")]
        staff = conn.execute("select team_id::text, id::text, role from profiles where active and team_id is not null order by email").fetchall()
        anchors = {t: (lat, lon) for t, lat, lon in conn.execute(
            "select distinct on (team_id) team_id::text, st_y(location::geometry), st_x(location::geometry) from water_sources"
            " where name not like 'Demo GPS%%' order by team_id, created_at")}
        existing = {}
        for t, s in conn.execute("select team_id::text, id::text from water_sources"):
            existing.setdefault(t, []).append(s)

        src_rows, rec_rows, read_rows, supervisors = [], [], [], {}
        for team_id, region in teams:
            workers = [p for t, p, role in staff if t == team_id and role == "field_worker"]
            supervisors[team_id] = next(p for t, p, role in staff if t == team_id and role == "supervisor")
            lat0, lon0 = anchors[team_id]
            sources = list(existing.get(team_id, []))
            for n, (label, kind) in enumerate(rng.sample(SOURCE_TEMPLATES, 6)):
                sid = uid("source", team_id, n)
                sources.append(sid)
                src_rows.append((sid, f"{region} {label}", kind, lon0 + rng.uniform(-0.035, 0.035), lat0 + rng.uniform(-0.035, 0.035),
                                 rng.randint(3, 14), region, f"Ward {rng.randint(1, 12)}", label.split()[0], team_id,
                                 rng.choice(workers), now - timedelta(days=DAYS + rng.randint(1, 30))))
            for day in range(DAYS, 0, -1):
                weekday = (now - timedelta(days=day)).astimezone(IST).weekday() < 6
                for w in workers:
                    if rng.random() > (0.55 if weekday else 0.15):
                        continue
                    for visit in range(rng.choice([1, 1, 2])):
                        kit_id, wait, grace, keys = rng.choice(kits)
                        at = (now - timedelta(days=day)).astimezone(IST).replace(hour=rng.randint(9, 16), minute=rng.randint(0, 59),
                                                                              second=0, microsecond=0).astimezone(timezone.utc)
                        readings = {k: draw_reading(rng, params[k]) for k in keys}
                        answers = None
                        if rng.random() < 0.65:
                            answers = {k: (rng.random() < (0.12 if cat == "sanitary" else 0.01 if k == "illness_reports" else 0.05))
                                       for k, cat in criteria}
                        base = assess(params, readings)
                        risk, assessment = combine(base, base["risk_level"], judge(criteria, answers) if answers is not None else None)
                        elapsed = wait + rng.uniform(2, grace - 2) if rng.random() < 0.85 else wait + grace + rng.uniform(15, 240)
                        read_at = at - timedelta(seconds=rng.randint(20, 90))
                        rid = uid("record-id", team_id, w, day, visit)
                        rec_rows.append((rid, rng.choice(sources), w, kit_id, risk, photos["strip photo"] if rng.random() < 0.9 else None,
                                         uid("record", team_id, w, day, visit), at, at, read_at - timedelta(seconds=elapsed), read_at,
                                         json.dumps(assessment), json.dumps(answers) if answers is not None else None))
                        read_rows += [(rid, k, v) for k, v in readings.items()]
        print(f"built {len(src_rows)} sources, {len(rec_rows)} screenings, {len(read_rows)} readings")

        with conn.cursor() as cur:
            cur.executemany(
                "insert into water_sources (id, name, source_type, location, location_source, location_accuracy_m, village, ward,"
                " landmark, team_id, created_by, created_at) values (%s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography,"
                " 'gps_auto', %s, %s, %s, %s, %s, %s, %s)", src_rows)
            cur.executemany(
                "insert into test_records (id, source_id, performed_by, kit_id, method, computed_risk_level, photo_url, local_record_id,"
                " cached_locally, synced_at, created_at, dip_started_at, read_at, rule_assessment, inspection)"
                " values (%s, %s, %s, %s, 'manual', %s, %s, %s, false, %s, %s, %s, %s, %s, %s)", rec_rows)
            cur.executemany("insert into test_readings (test_record_id, parameter, value) values (%s, %s, %s)", read_rows)
            print("inserted")
            # Reports the trigger opened: give them the screening's time.
            cur.execute("update reports r set created_at = t.created_at from test_records t"
                        " where r.test_record_id = t.id and not r.is_re_report and t.id = any(%s::uuid[])", ([r[0] for r in rec_rows],))
            reports = cur.execute(
                "select r.id::text, r.created_at, ws.team_id::text, ws.village from reports r join water_sources ws on ws.id = r.source_id"
                " where r.status = 'open' and r.test_record_id = any(%s::uuid[]) order by r.created_at",
                ([r[0] for r in rec_rows],)).fetchall()
            phase: dict[str, list] = {k: [] for k in ("review", "lab", "ref", "verify", "act", "photo", "close")}
            for report_id, opened, team_id, region in reports:
                age, roll = (now - opened).days, rng.random()
                stage = ("closed" if roll < 0.75 else "action_taken") if age > 21 else \
                        ("closed" if roll < 0.3 else "sent_to_lab" if roll < 0.7 else "under_review") if age > 7 else \
                        ("under_review" if roll < 0.35 else "open")
                t = opened + timedelta(hours=rng.randint(4, 30))
                if stage == "under_review":
                    phase["review"].append((report_id,))
                elif stage != "open":
                    ref = uid("referral", report_id)
                    phase["lab"].append((report_id,))
                    phase["ref"].append((ref, report_id, f"{region} District Water Lab", t))
                    if stage in ("action_taken", "closed"):
                        verified = t + timedelta(days=rng.randint(2, 5))
                        phase["verify"].append((photos["lab result"], supervisors[team_id], verified, ref))
                        phase["act"].append((report_id,))
                        phase["photo"].append((report_id, photos["repair"], supervisors[team_id], verified + timedelta(days=1)))
                        if stage == "closed":
                            phase["close"].append((verified + timedelta(days=rng.randint(2, 6)), rng.choice(CLOSURE_REASONS), report_id))
            cur.executemany("update reports set status = 'under_review' where id = %s", phase["review"])
            cur.executemany("update reports set status = 'sent_to_lab' where id = %s", phase["lab"])
            cur.executemany("insert into lab_referrals (id, report_id, lab_name, sent_at) values (%s, %s, %s, %s)", phase["ref"])
            cur.executemany("update lab_referrals set verification_status = 'verified', result_file_url = %s, verified_by = %s,"
                            " verified_at = %s where id = %s", phase["verify"])
            cur.executemany("update reports set status = 'action_taken' where id = %s", phase["act"])
            cur.executemany("insert into process_photos (report_id, photo_url, process_stage, inspection_level, uploaded_by, uploaded_at)"
                            " values (%s, %s, 'corrective_action', 'field', %s, %s)", phase["photo"])
            cur.executemany("update reports set status = 'closed', closed_at = %s, closure_reason = %s where id = %s", phase["close"])
            print("reports:", {k: len(v) for k, v in phase.items()})

            open_by_source = {s: r for s, r in cur.execute(
                "select distinct on (source_id) source_id::text, id::text from reports where status <> 'closed'"
                " order by source_id, created_at desc")}
            all_sources = [r[0] for r in src_rows] + [s for v in existing.values() for s in v]
            team_of = {r[0]: r[9] for r in src_rows} | {s: t for t, v in existing.items() for s in v}
            comp_rows = []
            for n in range(60):
                kind = rng.choice(list(COMPLAINT_TEXT))
                source = rng.choice(all_sources)
                at = now - timedelta(days=rng.randint(1, DAYS), hours=rng.randint(0, 12))
                cid = uid("complaint", n)
                linked = open_by_source.get(source) if rng.random() < 0.6 else None
                status = "linked" if linked else ("resolved" if rng.random() < 0.4 else "new")
                comp_rows.append((cid, rng.choice(residents), source, kind, json.dumps({"description": COMPLAINT_TEXT[kind]}), status,
                                  "dismissed" if status == "resolved" else None, linked, at + timedelta(hours=6) if linked else None,
                                  supervisors[team_of[source]] if linked else None, "JS-" + uuid.UUID(cid).hex[:10].upper(), at))
            cur.executemany(
                "insert into complaints (id, resident_id, source_id, complaint_type, details, status, resolution, linked_report_id,"
                " linked_at, linked_by, reference_number, submitted_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                comp_rows)
            print("complaints:", len(comp_rows))
            cur.execute("refresh materialized view public_map_view")
        if dry_run:
            conn.rollback()
            print("dry run: rolled back")
        else:
            conn.commit()
            print("committed")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
