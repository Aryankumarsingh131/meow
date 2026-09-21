# User journeys

Screen IDs are defined in [UI specification](ui-ux-specification.md). Every journey must include errors; a static mock is not completion.

## J01 — First visit and valid screening

Worker provisions online (S01), confirms assigned program, language and offline validity. Opens assigned source by list or QR (S02), sees last known timestamp rather than an unqualified current status, and selects kit/lot (S03). Instructions explain preparation and read window; timer survives normal backgrounding but does not fabricate elapsed validity after uncertain restart.

At capture (S04), reference/strip must be visible. Quality failure explains one actionable reason. Valid capture proceeds to S05 with indicative bin, uncertainty and next action. Worker confirms or uses manual entry with reason. Save returns durable local receipt S06 even in airplane mode.

Success: source/protocol/provenance preserved; “Saved on this phone” shown only after persistence. Acceptance: AC-001–AC-009; J01 does not prove ML validity.

## J02 — Camera problem, no data loss

Permission denied, broken camera, failed reference detection or unsupported device exposes “Enter kit reading manually.” Manual entry uses the kit's allowed bins, never fabricated precise values. Retaking creates a new capture job; cancelled/late model output cannot overwrite it. If timing has expired, the app explains why a fresh test is needed.

Saving with insufficient disk space fails visibly and retains editable form state in memory; user can free space and retry. Do not delete unsynced records automatically. AC-004/006/007.

## J03 — Network returns and the response is lost

Queue S07 distinguishes pending metadata, pending image, blocked authorization and conflict. Worker taps Sync Now. Server accepts event, response is lost; retry uses same UUID and produces no duplicate case. App pulls updated source/case state and stores cursor atomically. Photo upload off means “Photo kept on device,” not endless failure.

Expired online credentials request sign-in without clearing outbox. Role revocation quarantines pending submission for authorized review; no forged offline authority. AC-008/017/018.

## J04 — Supervisor handles an adverse screening

Supervisor opens queue S08, filters review-needed/overdue, opens S09 and checks protocol/provenance. Assigns owner/due date, refers to lab and records external reference. Lab report enters S10 as unverified; authorized reviewer checks sample identity, method/units and result before verification.

Corrective action is assigned and completion recorded. A new linked retest uses the field workflow. Supervisor records resident communication and requests closure. Missing evidence returns an explicit checklist. Valid closure records reviewer, policy version and proof. AC-010–AC-015.

## J05 — Conflicting reviewers and repeated problem

Two supervisors open case version4. First assignment changes version5; second close command with expected_version4 fails. UI shows current data and preserves typed rationale for review; it does not auto-reapply closing intent. A later flagged retest reopens the case with a new event, preserving earlier closure.

A disputed lab report can be superseded; dependent closure becomes review-needed. AC-011/013.

## J06 — Program review and resident update

Program owner opens S11 with date/site filters and denominator definitions. Synthetic/research records are excluded from operational metrics by default. Export keeps sample/case IDs and uncertainty, not only green/red status. Resident summary states the tested parameter and whether confirmation is pending, with an authorized contact route chosen by the operator.

No public household map, automatic advisory or unverified message delivery. AC-014/015/023/026.

