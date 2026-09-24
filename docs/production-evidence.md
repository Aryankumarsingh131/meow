# Production release verification (T39), NOT RELEASED

Date 2026-09-25. **There is no production deployment.** No production URL
exists, and none is claimed.

## What is live

| Environment | URL | Data | Verified |
|---|---|---|---|
| staging | https://jalsakshi-api.onrender.com | synthetic | tests/e2e/staging_smoke.py 7/7 (T35); CI green on every push |

## Why not production

T39 depends on T38 (pilot), T43, T45, T47 and T48. T48's final review
(docs/final-review.md) lists 10 open blockers: RLS and the database role,
phone encryption, independent reviews, domain sign-offs, a real kit and data,
physical-phone evidence, the data-mode label, a licence, secret rotation, and
an always-on plan with scheduled backups. The configuration also refuses
`production` while the data is synthetic.

## Release checklist (for when the blockers clear)

1. All blockers in docs/final-review.md closed, with evidence links.
2. Owner approval recorded here (name, date).
3. Scheduled backup running, and one restore rehearsed on the production
   database (infra/backup.md).
4. Deploy and record the exact commit, image, app build and model SHA-256.
5. `staging_smoke.py` against the production URL with a production smoke account.
6. Alerts (docs/alert-runbook.md) watched for 24 hours; an on-call owner named.
