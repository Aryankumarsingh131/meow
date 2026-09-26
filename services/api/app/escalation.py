"""Automatic email escalation to the responsible authority (010).

Every run:
  1. every report still not closed after its team authority's
     escalate_after_hours gets ONE email notification queued to that authority
     (reports.escalated_at makes it once);
  2. every queued email is sent over SMTP, if SMTP is configured, and marked
     sent or failed.

SMTP comes from the settings (config.py; environment or .env, never code):
JALSAKSHI_SMTP_HOST, _SMTP_PORT (587), _SMTP_USER, _SMTP_PASSWORD, _SMTP_FROM,
_SMTP_STARTTLS (true). Without a host the emails stay 'queued' and go out on the
first run after it is set. JALSAKSHI_ESCALATION_INTERVAL_S (300) sets how often
the worker runs; 0 turns it off.

Wording: a screening flag is not a laboratory result and says nothing about
drinking; the email states the record, not a verdict on the water.
"""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any

log = logging.getLogger("jalsakshi.escalation")



@dataclass(frozen=True)
class Smtp:
    host: str
    port: int
    user: str | None
    password: str | None
    sender: str
    starttls: bool


def smtp_settings(settings: Any = None) -> Smtp | None:
    if settings is None:
        from .config import load_settings

        settings = load_settings()
    if not settings.smtp_host.strip():
        return None
    user = settings.smtp_user or None
    return Smtp(host=settings.smtp_host.strip(), port=settings.smtp_port, user=user,
                password=settings.smtp_password.get_secret_value() or None,
                sender=settings.smtp_from or user or "jalsakshi@localhost", starttls=settings.smtp_starttls)


def compose(source: str, village: str | None, risk: str, status: str, origin: str, hours: int, report_id: str,
            dashboard_url: str = "http://127.0.0.1:5175") -> str:
    where = f"{source}{f' ({village})' if village else ''}"
    cause = "a field screening" if origin == "screening" else "a resident's complaint"
    return (
        f"JalSakshi escalation: a {risk}-risk report at {where} has been open for more than {hours} hours.\n\n"
        f"Opened from: {cause}\nCurrent status: {status.replace('_', ' ')}\nReport: {report_id}\n"
        f"Review it on the supervisor dashboard: {dashboard_url}\n\n"
        "A field screening is not a laboratory result and is not a statement about the quality of the water for drinking. "
        "This email was sent automatically because the report passed your office's response window."
    )


def escalate_due(conn: Any, dashboard_url: str = "http://127.0.0.1:5175") -> int:
    """Queue one email per overdue, not-yet-escalated report. Returns how many."""
    rows = conn.execute(
        "select r.id::text, ws.name, ws.village, r.risk_level, r.status, r.origin, a.email, a.escalate_after_hours"
        " from public.reports r join public.water_sources ws on ws.id = r.source_id"
        " join public.authorities a on a.team_id = ws.team_id and a.active"
        " where r.status <> 'closed' and r.escalated_at is null"
        "   and r.created_at < now() - make_interval(hours => a.escalate_after_hours)"
        " order by r.created_at limit 200 for update of r skip locked").fetchall()
    for report_id, source, village, risk, status, origin, email, hours in rows:
        conn.execute(
            "insert into public.notifications (related_report_id, channel, recipient_email, message)"
            " values (%s, 'email', %s, %s)", (report_id, email, compose(source, village, risk, status, origin, hours, report_id, dashboard_url)))
        conn.execute("update public.reports set escalated_at = now() where id = %s", (report_id,))
        conn.execute("insert into public.audit_log (entity_type, entity_id, action, after_data)"
                     " values ('reports', %s, 'escalated_to_authority', jsonb_build_object('email', %s::text, 'after_hours', %s::int))",
                     (report_id, email, hours))
    conn.commit()
    return len(rows)


def send_queued(conn: Any, smtp: Smtp | None, send: Any = None) -> tuple[int, int]:
    """Send queued emails. `send(msg)` is injectable for tests. Returns (sent, failed)."""
    if smtp is None and send is None:
        return 0, 0
    rows = conn.execute("select id::text, recipient_email, message from public.notifications"
                        " where channel = 'email' and delivery_status = 'queued' order by id limit 100"
                        " for update skip locked").fetchall()
    sent = failed = 0
    client = None
    for nid, to, body in rows:
        msg = EmailMessage()
        msg["From"] = smtp.sender if smtp else "jalsakshi@localhost"
        msg["To"] = to
        msg["Subject"] = body.split("\n", 1)[0][:180]
        msg.set_content(body)
        try:
            if send is not None:
                send(msg)
            else:
                if client is None:
                    client = smtplib.SMTP(smtp.host, smtp.port, timeout=20)
                    if smtp.starttls:
                        client.starttls()
                    if smtp.user and smtp.password:
                        client.login(smtp.user, smtp.password)
                client.send_message(msg)
            conn.execute("update public.notifications set delivery_status = 'sent', sent_at = now() where id = %s", (nid,))
            sent += 1
        except (smtplib.SMTPException, OSError) as exc:
            log.warning("escalation email %s failed: %s", nid, exc.__class__.__name__)
            conn.execute("update public.notifications set delivery_status = 'failed' where id = %s", (nid,))
            failed += 1
    if client is not None:
        try:
            client.quit()
        except (smtplib.SMTPException, OSError):
            pass
    conn.commit()
    return sent, failed


def run_once(connect: Any, settings: Any) -> dict[str, int]:
    conn = connect()
    try:
        queued = escalate_due(conn, settings.dashboard_url)
        sent, failed = send_queued(conn, smtp_settings(settings))
        if queued or sent or failed:
            log.info("escalation: queued %s, sent %s, failed %s", queued, sent, failed)
        return {"queued": queued, "sent": sent, "failed": failed}
    finally:
        conn.close()
