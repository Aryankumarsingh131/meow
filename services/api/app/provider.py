"""Hosted identity provider: Supabase Auth (project-owner decision, 2026-09-24).

Everywhere except the local synthetic dev stack, tokens come from Supabase
Auth and are verified by T06's `authenticate()` against Supabase's published
signing keys. Two pieces live here:

- `JwksCache` fetches `<issuer>/.well-known/jwks.json` over HTTPS with the
  standard library, keeps it for `ttl` seconds, and refetches early (at most
  once per `min_refresh` seconds) when a token names a key id it has not seen,
  which is how a provider key rotation is picked up. It FAILS CLOSED: with no
  key set ever fetched, `resolve()` returns None and the routes answer 503;
  they never run unauthenticated.
- `db_membership_lookup` reads the `memberships` table. The tenant and role
  come from this table, never from a token claim (T06).
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from typing import Any, Callable, Mapping, Sequence
from uuid import UUID

from jose import jwt

from .auth import Membership, OIDCConfig
from .samples import sql

Fetch = Callable[[str], Mapping[str, Any]]


def http_get_json(url: str) -> Mapping[str, Any]:
    if not url.startswith("https://"):
        raise ValueError("JWKS must be fetched over HTTPS")
    with urllib.request.urlopen(url, timeout=5) as response:  # noqa: S310 - scheme checked above
        return json.load(response)


class JwksCache:
    def __init__(self, url: str, *, fetch: Fetch = http_get_json, ttl: float = 600.0, min_refresh: float = 60.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.url, self._fetch, self._ttl, self._min_refresh, self._clock = url, fetch, ttl, min_refresh, clock
        self._keys: Mapping[str, Any] | None = None
        self._fetched_at = -float("inf")
        self._lock = threading.Lock()

    def _refresh(self) -> None:
        try:
            keys = self._fetch(self.url)
        except Exception:  # outage: keep serving the last good set, if any
            self._fetched_at = self._clock()
            return
        if isinstance(keys, Mapping) and isinstance(keys.get("keys"), list):
            self._keys = keys
        self._fetched_at = self._clock()

    def keys_for(self, kid: str | None) -> Mapping[str, Any] | None:
        with self._lock:
            age = self._clock() - self._fetched_at
            known = self._keys is not None and any(k.get("kid") == kid for k in self._keys["keys"])
            if age >= self._ttl or (not known and age >= self._min_refresh):
                self._refresh()
            return self._keys


def db_membership_lookup(connect: Callable[[], Any]) -> Callable[[str], Sequence[Membership]]:
    def lookup(user_id: str) -> Sequence[Membership]:
        try:
            UUID(user_id)
        except ValueError:
            return []  # Supabase subjects are UUIDs; anything else has no membership
        conn = connect()
        try:
            cursor = conn.cursor()
            cursor.execute(sql("SELECT user_id, tenant_id, role, active FROM memberships WHERE user_id = ?", conn),
                           (user_id,))
            return [Membership(str(r[0]), str(r[1]), r[2], bool(r[3])) for r in cursor.fetchall()]
        finally:
            conn.close()

    return lookup


class HostedAuth:
    """What `app.state.auth` holds outside the dev stack."""

    def __init__(self, issuer: str, audience: str, lookup: Callable[[str], Sequence[Membership]],
                 jwks: JwksCache | None = None) -> None:
        self.issuer, self.audience, self.lookup = issuer.rstrip("/"), audience, lookup
        self.jwks = jwks or JwksCache(f"{self.issuer}/.well-known/jwks.json")

    def resolve(self, token: str) -> OIDCConfig | None:
        try:
            kid = jwt.get_unverified_header(token).get("kid") if token else None
        except Exception:
            kid = None  # malformed: still resolve, so verify_token denies it with the generic 401
        keys = self.jwks.keys_for(kid)
        return None if keys is None else OIDCConfig(issuer=self.issuer, audience=self.audience, jwks=keys)
