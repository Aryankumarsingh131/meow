# Operational signals and alert runbook (T33)

## Tracing a failure a worker reports

1. The app's **Saved records** screen shows *Reference for support: …* after a
   failed server call. That is the server's request id.
2. In Render → `jalsakshi-api` → **Logs**, search for that id. Each request
   writes exactly one JSON line:
   `{"ts", "request_id", "method", "route", "status", "ms"}`, plus `"error"`
   (the exception type) when the server crashed.
3. `route` is the template (`/v1/cases/{case_id}`), so a line never contains
   the id of anything a person looked at. Status tells you where to go next:
   `401/403` sign-in or membership (docs/deploy-render.md step 5), `404` wrong
   or other-tenant id, `409` a case rule refused the step (the app shows which),
   `503` database busy or signing keys unreachable (retry; persistent = page),
   `500` a bug: file it with the request id and time.

Logs never contain: query strings (signed evidence URLs carry tokens there),
headers, request or response bodies, exception messages, names, emails or
tenant ids. `tests/telemetry_test.py` injects sensitive markers and a crash and
checks this.

## Alerts

Run `python -m services.api.app.telemetry alerts` (locally with
`JALSAKSHI_DATABASE_URL` set, or as a Render cron job). It prints one line per
alert that fired, with counts only.

| Alert | Fires when | What to do |
|---|---|---|
| `overdue_open_cases` | ≥ 1 open case past its due date | Open the board filtered to *overdue*; reassign or extend each with a reason |
| `unassigned_cases_older_than_1_day` | ≥ 1 open case without an owner for a day | Assign an owner and due date: a flagged sample is waiting for a person |
| `unverified_lab_reports_older_than_2_days` | ≥ 1 lab report still unverified after 2 days | Ask a lab reviewer to verify or reject; closure is blocked until then |

## Not covered yet

- **Device queue depth.** Unsent records live on each phone; the server cannot
  see them. The Saved records screen shows the count per phone. A server-side
  "device last synced N days ago" alert needs a sync heartbeat, not built.
- **Backup alerts.** Belong with T36 (backup and restore). Supabase's own
  backup status is in the Supabase dashboard.
- **Paging.** The alert command prints lines; wiring them to email or a chat
  channel is a deployment choice not yet made.
