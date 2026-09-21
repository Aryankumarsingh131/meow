# Project brief

## Purpose and evidence boundary

JalSakshi is an offline-first field-screening and follow-up system for community water programs. A field worker records the source and test protocol, captures a kit result, sees uncertainty, and creates an accountable handoff when a result needs review. A supervisor connects laboratory confirmation, actions, retesting and communication.

**FACT:** The Ministry of Jal Shakti describes FTKs as indicative screening and calls for laboratory confirmation and appropriate follow-up on adverse results. **INFERENCE:** Improving documentation and handoffs is useful only if local staff actually act on them; software cannot supply missing lab capacity. [PIB, 16 March 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2240597&lang=1&reg=1).

The original pitch's operational gap is a hypothesis to investigate, not proof that all existing systems fail. [Prior art and positioning](research/competitive-analysis.md).

## Users and complete workflows

| User | Job | Necessary outcome |
|---|---|---|
| Trained volunteer / Pani Samiti worker | Identify source; follow exact kit instructions; record result despite weak signal | Durable local record, clear next action, uncertainty rather than guessed precision |
| Lab/block supervisor | Triage, assign, refer, verify reports and decide next steps | One case with evidence, accountable owner and due time |
| Program/campus water operator | Complete corrective work, schedule retest, communicate | Closure backed by verified evidence, not a button alone |
| Resident | Receive understandable status from an authorized person | Clear screening-versus-confirmation wording; no false reassurance |

Resident communication is an operator-recorded step and printable/shareable approved summary. A resident app, automatic WhatsApp delivery or SMS purchase is not required.

## Inputs → processing → outputs

Inputs: source ID/QR; kit/version/lot/expiry; parameter; protocol timestamps; photo with physical reference; user-entered interpretation; optional location and uncertainty; laboratory report and reviewer decision; action/retest records.

Processing: validate protocol → capture-quality checks → reference normalization → deterministic baseline and eligible local model → indicative interpretation or abstention → atomic offline save → authorized sync → versioned case workflow.

Outputs: local receipt; separately visible metadata/image sync status; source history; case owner/due date; lab linkage; action and retest timeline; resident-update record; safe exports and program metrics.

## Baseline inventory

**FACT, inspected:** workspace contains a presentation-building script under `work/ppt-build/build.mjs` and two generated concept images under `outputs/assets/`. The script describes intended screens and stack; it is not application code. No application manifest, tested API, trained model, labeled kit dataset or deployed service was found in the inspected workspace. No inference benchmark has been run.

The intended stack in that script is retained, with its missing native image-processing work made explicit in [system design](architecture/system-design.md). Concept images are not training data or field evidence.

## Corrections to previous pitch

- “24.80 lakh women trained” is a cumulative reported figure as of 12 March 2026, not newly trained during that fiscal year.
- 47.59 lakh FTK samples in 2025–26 were reported as of 12 March; do not compare that bar with full-year 2024–25 as an established decline.
- The CAG retesting figure concerns Karnataka, not all India; distinguish state totals from sampled-district denominators.
- Remove “WQMIS has no end-to-end closure” unless its complete actual workflow is evaluated.
- “No image leaves the phone” applies to the default no-upload demo. Local inference does not prohibit a separately authorized evidence-upload feature in a pilot.
- “Every core action works offline” means field capture after provisioning. Server authorization, multi-user case closure and lab verification require connectivity.
- A classifier confidence score is not probability that water is safe; a kit reading is not a certified lab result.

Source detail and access limits: [register](research/source-register.md).

## Fully functional product definition

All REQ-001–REQ-028 must pass their acceptance checks on declared supported devices and kits, with training/onboarding, tenant isolation, recovery, measured performance, approved screening rules, validated local ML, authorized field pilot and a deployed environment that has passed smoke/restore tests. Scientific generalization beyond the evaluated kit/device/lighting range is not included merely because the software runs.

The demonstration instead proves one end-to-end path and deliberately demonstrates uncertainty, loss of connectivity and duplicate-safe synchronization. Simulated lab/action data must remain visibly marked. [Demo plan](delivery/demo-and-judging-plan.md).

