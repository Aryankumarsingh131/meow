# Handoff — T18 supervisor queue and detail (backend for the external board)

- Task: T18 / REQ-010, REQ-015 / AC-010, AC-015. Role C for the API; the UI is owned elsewhere.
- **Project-owner decision (2026-09-24):** the supervisor board is a **separate web app at its own address**, not part of this repository. This repo provides only the API the board calls. The card's `apps/web/*` files are not built here. The board's own states, browser E2E, keyboard pass and session handling belong to that app and are **not verified by this repository**.
- Status: **`[~]` API built and verified.** Outstanding: the external board's E2E/keyboard/states against this API, its secure session (it holds a bearer token; see below), and independent review.

## Endpoints the board calls

All endpoints use `Authorization: Bearer <access token>`. The tenant and role always come from the membership, never from the request. Errors are `application/problem+json`.

| Request | Returns | Who |
|---|---|---|
| `GET /v1/me` | `{user_id, tenant_id, role}` for the caller only | any member |
| `GET /v1/cases?status=&owner_id=&overdue=&source_id=&cursor=&limit=` | `{items[], next_cursor, total, as_of}`. Order: `due_at` ascending, NULLS LAST, then `id`. `total` counts every row matching the filters; `as_of` is server time. `overdue` is computed from the **server** clock. Each item: `id, status, source_id, source_label, trigger_flag, owner_id, due_at (UTC), overdue, version, requires_rereview, updated_at` | supervisor, lab_reviewer, admin (workers get 403) |
| `GET /v1/cases/{id}` | the case plus `source`, `trigger_sample` (with **separate** `machine_suggestion`, `human_observation`, `quality_reasons`, `timing_valid`, `data_mode`), `evidence[]` (**states only, never URLs**), `timeline[]`, `as_of` | same |
| `POST /v1/cases/{id}/commands` | T17 engine. Send `expected_version` from the last read. A stale version returns **409 `CASE_VERSION_CONFLICT`** with `current_version`/`current_status`: reload and let the person decide again; **do not auto-resubmit** | supervisor, admin |
| `GET /v1/evidence/{id}/access` | short-lived read URL (T16), reauthorised on each call | per T16 |

- **Cursor.** Opaque, bound to tenant **and** filters. Reusing it with other filters returns 422. Pass it back unchanged for the next page.
- **Due dates** are stored as UTC `Z`; a due date without a timezone is refused. Send the end of the chosen day in the user's timezone, converted to ISO (e.g. `new Date('2026-10-01T23:59:59').toISOString()`), or the day shows as the next morning in IST.
- **Tokens.** In development, `POST /dev/v1/token {username, password}` (synthetic users: `supervisor`/`jalsakshi`). In production, the real identity provider (T06, not yet chosen).

## CORS

The board runs at another origin, so the API sends CORS headers only for origins listed in `JALSAKSHI_CORS_ALLOWED_ORIGINS` (comma-separated, exact `scheme://host[:port]`). Empty means no cross-origin access. `allow_credentials` is false: bearer tokens only, no cookies, so no ambient credential crosses origins and CSRF does not apply.

## What changed

- **Removed** (existed only for the in-app board): the Expo web board screens, the cookie web-session and CSRF path, and static serving of a web build. The mobile app is back to its committed state.
- **Kept or added:** `services/api/app/case_reads.py` (list/detail), `GET /v1/me`, `GET /v1/cases`, `GET /v1/cases/{id}`, the CORS allowlist (`config.py`, `main.py`), `render.yaml` documentation, and due dates normalised to UTC with zone-less dates refused (`cases.py`, `case_policy.py`).

## Verification actually run (2026-09-24)

- `python -m unittest tests.case_reads_test -v`: **11/11**.
  - Worker 403; stable NULLS-LAST order; paging never repeats or skips; totals equal paged counts for every filter.
  - Overdue follows the server clock and ignores closed cases; a cursor bound to its filters and tenant; the other tenant sees nothing.
  - Detail keeps provenance separate and contains no URL.
  - Over HTTP with bearer tokens: list, page, detail, assign, then a stale assign → 409 with `current_version`; the due date is stored in UTC.
  - CORS on the real `main.py` in a fresh interpreter: a listed origin gets the header; an unlisted one and an empty list get none; credentials are never allowed.
- CORS mutants caught: "allow any origin" and "allow credentials".
- `tests/case_policy_test.py` gained the UTC/zone-less due-date test.
- `python -m pytest -q`: **258 passed**. All Node suites pass; both `tsc` clean.
- An earlier in-app board build was verified in Edge (8 browser checks, 3 UI mutants) and then **removed** at the owner's request. None of that is claimed for the external board.

## Not done / limits

- **Board-side checks** (states, keyboard, conflict UX, two-role browser run) are **not verified here**; they belong to the external board's repository.
- **Assignment has no member-directory endpoint** (only the admin memberships route in the API inventory, which isn't built). The board can assign to the caller (`/v1/me`) or to a known member id; unknown or other-tenant ids are refused (`CASE_OWNER_REQUIRED`).
- **Case events are not in the changefeed** (see handoff-T17). The board must poll `GET /v1/cases`.
