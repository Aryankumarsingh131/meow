# Risk register

Scores are qualitative planning judgments; owner must update after evidence. H=high, M=medium. Residual risk is explicit rather than hidden by a demo.

| ID | Risk / likelihood-impact | Trigger | Mitigation / owner | Gate |
|---|---|---|---|---|
| R01 | Kit/protocol unspecified H-H | Cannot state manufacturer/read window | Select/approve exact protocol; synthetic-only analytical demo until then / A | T01/G0 |
| R02 | Native dependency failure M-H | APK/ONNX/pixel bridge fails on actual phone | Earliest build proof; tested version matrix; change architecture only explicitly / B | T03/T04 |
| R03 | Leakage/weak labels H-H | Same preparation crosses splits; model labels itself | Group manifests, independent reference and locked test / B | T23–T27 |
| R04 | False reassurance M-H | Review-required sample shown no_flag or safe | Domain limits, abstention, reviewer-approved gates, no potability claim / B+A | G3 |
| R05 | Phone/lot/light shift H-H | Good development score collapses on new domain | Held-out domain tests; unsupported status; per-kit revalidation / B | T27/T40 |
| R06 | Offline loss/duplication M-H | App kill, disk full, lost acknowledgment | Durable boundary tests, UUID receipt, server constraints / A+C | G1 |
| R07 | Cursor misses late commit M-H | Sequence allocated before later commit | Tenant commit ordering/snapshot protocol, concurrency test / C | T14 |
| R08 | Unauthorized closure/data leak M-H | Wrong role/tenant/report accepted | Server guards, object authorization, RLS, independent negative tests / C | T31/T48 |
| R09 | Photo privacy/retention gap M-H | Plaintext temp/shared public URL persists | Private encryption, explicit sharing, retention/deletion/restore checks / C | T32/T47 |
| R10 | Offline revocation limitation H-M | Lost phone stays disconnected | Bounded lease, screen lock, limited cache; disclose remote-revocation delay / C | T45 |
| R11 | Scope exceeds event H-H | Integration incomplete at18h | Complete small demo path; full requirements remain roadmap; freeze and rehearse / A | T34 |
| R12 | Existing tool already sufficient M-H | mWater/ODK config solves user job | Configure-versus-build review, test unique value before startup spend / A | T02/T38 |
| R13 | No operator/lab capacity H-H | Cases accumulate despite good software | Partner ownership/due rules and realistic lab workflow; no impact claim / A | T38 |
| R14 | Event participation/rules uncertain H-H | Deadline/RSVP passed or prework prohibited | Confirm with organizer; do not assume eligibility from plan / A | T01 |
| R15 | AI-generated code security debt M-H | Broad changes with no tests/explanation | Small claims, review contracts, native/security independent review / all | Every task |
| R16 | Cloud cost/recovery mismatch M-M | Restore exceeds RTO or budget | Pilot load/restore evidence and budget alerts; reprice real needs / C | T36/T41 |
| R17 | Pitch evidence overstatement H-H | Partial-year chart, generalization, fake accuracy | Correction ledger, source register and disclosure rehearsal / A | T34 |
| R18 | Retention destroys unsynced evidence M-H | Automatic purge while offline | Quarantine/review unresolved data, explicit disk-full refusal / C | T47 |
| R19 | Benchmark quality sacrificed M-H | Lower p95 through skipped checks/rejection | Joint quality/coverage/performance gate / B | T27/T29 |
| R20 | Reference card print drift M-H | Ink/paper/age changes colors | Approved physical reference/lot; measure drift; no generic generated card / B | T23 |

Escalation: safety, privacy, tenant-isolation and evidence-loss risks block real-data deployment. Document demo limitations rather than pretending these risks disappeared.

