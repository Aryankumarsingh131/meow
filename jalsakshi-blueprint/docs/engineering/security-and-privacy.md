# Security and privacy plan

This is a project-specific engineering threat model, not a legal/compliance certification. Before a real pilot, operator approval and applicable local legal review must settle collection purpose, access and retention. Do not treat public-water data as automatically non-sensitive: locations, workers and household associations can reveal people.

## Assets and trust boundaries

Protect field-worker identity/session, exact source location where sensitive, photos/reports, case decisions, model/protocol authenticity and unsynced records. Attackers include an unauthorized tenant user, a lost-phone holder, malicious uploaded-file sender, stolen token user and compromised dependency. The physical sample can also be mislabeled or staged; software integrity cannot eliminate that risk.

| Threat | Required controls | Test |
|---|---|---|
| Wrong tenant/role access | OIDC validation; membership lookup; object-level checks; non-owner DB app role; tested RLS defense | Two tenants, each endpoint/upload/export/worker path, guessed IDs denied |
| Lost unlocked phone | Screen-lock onboarding, short app inactivity lock, offline grant expiry, encrypted DB/photos | Inspect app storage; simulate expired lease/credential changes |
| Token/secret leakage | Secure platform storage; no secrets in app bundle/git/logs; rotate exposed credentials | Secret scan + release artifact/log inspection |
| Upload abuse | Allowlist/magic/decode validation; size/pixel/page limits; private quarantine; malware scan for lab documents | Polyglot/malformed/oversize/zip-bomb-style inputs rejected safely |
| Replay/duplicate mutation | UUID+payload hash dedupe; immutable unique constraints; expected version | Lost-response replay and mutated-body replay |
| Fake closure/altered report | Server state guards, authorized verification, superseding corrections, audit | Unverified/wrong-source report cannot close case |
| Poisoned model/protocol | Signed manifest/hash, supported-domain binding, independent eval, last-known-good rollback | Tampered model, wrong feature schema and revoked protocol fail closed |
| Export injection | Quote CSV, neutralize leading formula control characters, preserve raw value in safe structured export | Cells beginning =,+,-,@ and whitespace prefixes do not execute |
| API abuse | Bounded batches/uploads, authenticated per-user/tenant quotas,429, job leases | Burst and resource exhaustion tests |
| Sensitive telemetry | Structured allowlist, no photos/tokens/free-text/lab personal details | Log/trace inspection against synthetic sensitive markers |

## Identity and offline policy

Select a maintained OIDC provider in T06, validate issuer/audience/signature/expiry and authorized scopes. Mobile PKCE; web secure HttpOnly SameSite cookies and CSRF protection where applicable. No production password store invented for speed.

Offline entitlement provisionally lasts72h and is separate from online access token validity. The app checks expiry and monotonic elapsed time while possible; clock rollback, reboot ambiguity or key invalidation prompts online revalidation. Offline clients cannot learn revocation instantly; disclose this limitation and restrict cached assignments/privileged actions. Collaborative lab verification/closure remains online.

A grant does not override server revocation on reconnect. Rejected pending data remains encrypted/quarantined until authorized handling; do not silently discard it. Logout warns about unsynced records, locks access and does not destroy encryption keys before resolution. Android keystore access is not guaranteed recoverable after uninstall or key invalidation; synced server copy and operational process are recovery paths, not a secret universal decryption key.

## Local storage

Enable SQLCipher only after native build verification; protect its key using platform key storage. SQLite encryption does not encrypt photo files. Use platform AES-GCM with unique nonce per file, authenticated metadata binding tenant/asset/schema; avoid custom crypto. Native module writes private encrypted files and removes plaintext camera temporaries promptly after successful encryption.

Exclude sensitive local data from ordinary device/cloud backups unless secure recovery is designed. Test screenshots/recents behavior for sensitive screens. App-private storage/device encryption is a demo containment measure, not evidence of the full encryption requirement. No real-data pilot before T32 passes.

## Evidence sharing and retention

Default demonstration: metadata only; photos remain on device. If real metadata itself is sensitive, synthetic mode only until policy approval.

Pilot optional evidence upload requires tenant policy, authorized worker action and appropriate collection notice/consent or other approved basis. No cloud model processes photos. Uploading to a private reviewer store is distinct from “local AI.” Explicitly show image kept local versus shared. Don't claim “no image ever leaves the phone” if upload is enabled.

Provisional policy A10: photos30days, metadata12months, backups30days, pending operator approval. Retention jobs support legal/operational holds approved by designated owner, audited purge, deleted-asset markers and eventual backup expiry. Avoid indefinite retention by default. Unsynced files need review before deletion; age alerts do not automatically erase unresolved evidence.

Server storage encrypted at rest and TLS in transit; least-privilege storage credentials; access URLs expire. Object deletion and metadata update reconcile idempotently. Backup restoration reapplies deletion ledger before access.

## Dependency and agent security

Lock dependencies, review native libraries and model provenance, scan before release and maintain an inventory/license list. Do not blindly copy GPL code/assets into a differently licensed project. A code generator's output is untrusted until reviewed and tested.

There is no product LLM, so runtime prompt injection is not a current model surface. Nevertheless QR strings, filenames, report text and external documents are untrusted data; render escaped, never execute or treat as instructions. Coding agents must not receive production secrets or personal data in prompts. Do not add a chatbot to justify a generic prompt-injection checklist.

Incident owner C; alternate A. On suspected tenant leak: disable affected route/credentials, preserve sanitized audit evidence, scope affected records, contact operator, remediate and verify before reopening. On suspected analytical error: disable affected model/protocol, retain manual/review path, identify dependent cases and arrange human review.

