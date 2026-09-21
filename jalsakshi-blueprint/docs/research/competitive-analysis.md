# Competitive positioning and product hypotheses

## Competitive baseline

| Alternative | Verified strength | What is not established | Consequence |
|---|---|---|---|
| Akvo Caddisfly + Flow | Smartphone water testing and platform linkage, open Android repository | Current maintenance, our-kit support and local deployment quality not tested | Do not claim first phone water test; assess existing solution before custom work |
| mWater | Offline collection, sources, assignments/issues, longitudinal data and portal synchronization | Exact kit-specific image-quality + calibrated local inference support not confirmed | Offline case handling alone is not differentiation; configuration-first is credible |
| ODK Collect/Central Entities | Linked longitudinal records and supported offline workflows | Ready-made kit interpretation/closure policy not established; version constraints matter | Possible lower-cost operational foundation; evaluate before commercial build |
| WQMIS | Official sample/mobile registration context | Full workflow coverage and public integration API not audited | Companion export/manual reference only; no “they lack closure” claim |
| Notebook/chat plus lab | Familiar low-setup process and human expertise | Actual local error/delay rate requires observation | Baseline for pilot, not a straw man |

Links and inspection limits: C01–C04 in [source register](source-register.md).

## Defensible statement

“JalSakshi combines a validated kit protocol, on-device capture assistance and explicit uncertainty with an auditable path from screening to lab confirmation, action and retest.”

This is **engineering/product differentiation to test**, not a global novelty claim. The hard-to-copy asset, if earned, is validated device/kit data plus trusted operational adoption, not a colorful dashboard.

**Configure-versus-build gate:** T02 gives one teammate a time-boxed walkthrough of mWater/ODK documentation and, with user authorization, a synthetic sandbox trial. If configuration covers the workflow, a local capture companion/integration may be a stronger startup than replacing the platform. That would be a user-approved architecture revision, not a silent deletion of the requested product.

## Proposed enhancements — not extra committed scope

| ID | Enhancement / user benefit | Rationale / dependencies | Estimated effort and performance | Demo value / success metric |
|---|---|---|---|---|
| E01 | Cheap fold-flat light shield | P01/P02; kit safety and phone fit review | 4–8 h prototype plus materials; more setup, less lighting variance | Show paired images; reduce major errors/retakes without >20 s added setup |
| E02 | Signed printable case receipt with verification link | Residents need understandable handoff; privacy approval | 3–5 h; small server export; no public sensitive data | QR verifies record ID, not water safety; comprehension study |
| E03 | Kit-lot drift warning | Lot shift may invalidate calibration; sufficient longitudinal labels | 1–2 days analysis; periodic batch job | Detect known lot shift on held-out set without excessive alerts |
| E04 | Supervisor-calibrated workload escalation | Owner/due logic exists; pilot rules needed | 3–6 h; indexed due query, no separate queue service | Fewer unowned overdue cases; no notification flood |
| E05 | In-app voice instructions | Literacy/language access; native audio and reviewed script | 1–2 days plus translation; bundled audio storage | Guided task completion improves in target-user test |
| E06 | External platform adapter | Avoid duplicate entry; partner API/permission required | Unknown until contract known; network dependency | Round-trip selected records with reconciliation; never claim integration from CSV alone |

Time estimates are assumptions, not commitments. Full required scope is in [requirements](../requirements.md); these proposals do not displace it.

## Startup hypothesis

Initial buyers: campus/hostel operators, testing providers and implementation partners already responsible for follow-up. Value proposition: less time chasing missing evidence and fewer unowned cases. A subscription per program/site plus onboarding is a pricing hypothesis; no customer, revenue or willingness-to-pay is established.

T38 interviews at least one budget holder and compares cost to their current workflow and free/configurable alternatives. Ask who pays for lab tests, who owns data, who can authorize remediation, and why the existing system cannot be configured. Track cost per evidence-complete case, staff minutes per case, retention and support burden. Do not calculate national market revenue from volunteer counts.

## Likely objections

- **“Can it tell us water is safe?”** No; selected kit screening is bounded and confirmatory evidence remains distinct.
- **“Why not mWater?”** It may be the right choice. Our hypothesis concerns protocol-specific capture/uncertainty integrated into the response loop; pilot comparison must establish advantage.
- **“Where is your AI?”** A versioned, locally executed model evaluated against simple baselines, or an explicitly labeled research model if validation is unfinished.
- **“What happens without internet?”** Durable capture works after provisioning; multi-user decisions wait for authenticated synchronization.
- **“Why will staff act?”** A named operational partner and measured follow-up are essential; software alone does not create institutional capacity.

