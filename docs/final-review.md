# Final release security and accessibility review (T48)

Date 2026-09-25. **Verdict: NOT cleared for a production release.** Staging
with synthetic data remains appropriate. Every blocker is named below.

**Independence:** this review was run by the same agent that wrote the code,
so it does not satisfy AGENTS.md's independent-review requirement; it is the
checklist an independent reviewer should repeat.

## Rechecked on the current build

| Area | Check | Result |
|---|---|---|
| All `/v1` routes | Tenant matrix (T31), fails on any unlisted route | Pass, 22 routes |
| New public endpoint `GET /auth/config` | Serves only a publishable key; a `sb_secret_` or non-anon JWT key is refused | Pass (tests/provider_test.py) |
| Logging (T33) | Injected secrets in query, header, body and exception message never logged | Pass |
| Retention paths (T47) | Unresolved evidence held; interrupted purge resumes; restore reapplies deletions | Pass |
| Offline paths (T45) | Lease, clock rollback, revocation: suites still pass | Pass |
| Case state machine | Random-walk invariants (T31) | Pass |
| Full regression | docs/release-test-matrix.md | All automated rows green |

## Accessibility (static scan + fixes, 2026-09-25)

A brace-aware scan of every routed screen for unlabelled controls found:

| Finding | Fix |
|---|---|
| Sign-in email/password fields had visible labels not attached to the input: a screen reader read only the placeholder | `accessibilityLabel` added |
| Public portal tabs had no role or selected state | `accessibilityRole="tab"` and `selected` state |
| "Report an issue" and "Request a retest" **did nothing when tapped** | Disabled visibly and for screen readers, with a hint naming the helpline, plus a visible note |

Still owed: a manual TalkBack pass on a phone, colour-contrast measurement,
large-font layout check, and Hindi (T28).

## Blockers to production, all open

| # | Blocker | Owner / what clears it |
|---|---|---|
| 1 | API connects as the table owner with RLS off (T31 F1) | Approve and apply the remediation in docs/security-review.md |
| 2 | No encryption at rest on the phone (T32) | Decide on `expo-secure-store` + SQLCipher + photo encryption; rebuild |
| 3 | No independent review of auth, sync, state, security (T06, T07, T13–T22, T31) | A reviewer other than the author |
| 4 | Closure policy unsigned (T46) and resident wording unreviewed (T44) | Domain reviewer sign-off |
| 5 | No real kit, protocol or validated model: everything is synthetic (T01, T23–T27) | Real kit, lab partner, data |
| 6 | No physical-phone evidence: performance, two cold journeys, offline recovery (T29, T34) | Test on the reference phone |
| 7 | Production would be mislabelled: today's data is synthetic and `production` requires operational data | Real data (5) first |
| 8 | Repository has no licence | Owner chooses a licence |
| 9 | Secrets exposure: a database password was pasted into chat earlier; demo account passwords are in chat; part of a secret reached Render logs before T33's fix | Rotate the database password; rotate demo passwords before real data |
| 10 | Render free plan sleeps (about 1 minute cold start) and backups/restore are unrehearsed (T36) | Paid plan for always-on; run T36 |

## Resolved since earlier reviews

- A real identity provider now exists (Supabase Auth, verified against
  published ES256 keys), closing T06's "no provider chosen" blocker for
  staging.
- Load-induced 500s (thread affinity, lock contention) fixed in T30.
- Plaintext camera originals no longer linger in the cache (T32).
