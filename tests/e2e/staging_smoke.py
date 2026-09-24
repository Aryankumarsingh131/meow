"""T35: staging smoke test against a deployed API.

Checks, in order: TLS + health (and how long a sleeping instance took to
wake), the public sign-in settings, a real Supabase sign-in, the caller's
membership, the synthetic source list, and request tracing. Read-only: it
creates no data.

    JALSAKSHI_SMOKE_EMAIL=... JALSAKSHI_SMOKE_PASSWORD=... \\
        python tests/e2e/staging_smoke.py [https://jalsakshi-api.onrender.com]

Credentials come only from the environment; nothing secret is printed.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://jalsakshi-api.onrender.com").rstrip("/")


def call(url: str, *, data: dict | None = None, headers: dict | None = None, timeout: float = 90):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={**({"Content-Type": "application/json"} if data is not None else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # verifies the TLS certificate
            return r.status, json.load(r), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, None, dict(e.headers)


def main() -> int:
    results: list[tuple[str, bool, str]] = []
    check = lambda name, ok, note="": results.append((name, bool(ok), note))  # noqa: E731

    check("HTTPS (certificate verified by the client)", BASE.startswith("https://"))
    started = time.perf_counter()
    status, body, _ = call(f"{BASE}/health/live")
    check("health/live", status == 200 and body == {"status": "ok"}, f"{time.perf_counter() - started:.1f}s incl. any wake-up")

    status, cfg, _ = call(f"{BASE}/auth/config")
    publishable = bool(cfg and str(cfg.get("publishable_key", "")).startswith(("sb_publishable_", "eyJ")))
    check("auth/config serves Supabase and a publishable key only", status == 200 and cfg["provider"] == "supabase" and publishable)

    email, password = os.environ.get("JALSAKSHI_SMOKE_EMAIL"), os.environ.get("JALSAKSHI_SMOKE_PASSWORD")
    if not (email and password):
        check("sign-in", False, "set JALSAKSHI_SMOKE_EMAIL and JALSAKSHI_SMOKE_PASSWORD")
    else:
        status, tok, _ = call(f"{cfg['url']}/auth/v1/token?grant_type=password", data={"email": email, "password": password},
                              headers={"apikey": cfg["publishable_key"]})
        check("Supabase sign-in", status == 200)
        auth = {"Authorization": f"Bearer {tok['access_token']}"} if status == 200 else {}
        status, me, _ = call(f"{BASE}/v1/me", headers=auth)
        check("/v1/me resolves a membership", status == 200, f"role {me.get('role') if me else '-'}")
        status, sources, _ = call(f"{BASE}/v1/sources?limit=100", headers=auth)
        check("/v1/sources returns the synthetic catalogue", status == 200 and len(sources["items"]) > 0,
              f"{len(sources['items']) if sources else 0} sources")

    status, _, headers = call(f"{BASE}/v1/me", headers={"X-Request-Id": "smoke-trace-1"})
    check("unauthenticated request is refused, and traced", status == 401 and headers.get("X-Request-Id") == "smoke-trace-1",
          f"status {status}")

    for name, ok, note in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  (' + note + ')' if note else ''}")
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} checks passed against {BASE}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
