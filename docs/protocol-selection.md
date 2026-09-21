# Protocol selection — T01

> **STATUS: FICTIONAL DEMO TEMPLATE — NOT FOR OPERATIONAL USE.**
> Every kit/lot/read-window value below is invented purely to illustrate the
> document shape required by [jalsakshi-blueprint/docs/architecture/protocol-schema.md](../jalsakshi-blueprint/docs/architecture/protocol-schema.md).
> None of it comes from a real manufacturer's instructions. No real kit has
> been selected. Do not use these numbers to interpret a real test strip.

## Provenance

| Field | Value |
|---|---|
| Source of these values | Authored by the agent as a template illustration, at the user's explicit request, on 2026-09-22. |
| Real manufacturer instructions consulted? | **No.** |
| Kit physically owned/inspected? | **No.** |
| Operational approval status | **Not approved. Fictional.** |

## Protocol document (illustrative shape only)

```json
{
  "schema_version": 1,
  "id": "00000000-0000-0000-0000-000000000000",
  "version": 1,
  "manufacturer": "FICTIONAL DEMO MFG (not a real company)",
  "kit": "Demo-Strip-X (fictional, illustrative only)",
  "parameter": "free_chlorine (illustrative choice, not confirmed)",
  "unit": "mg/L",
  "method": "colorimetric_strip",
  "read_window": {
    "prepare_seconds": 0,
    "read_at_seconds": 60,
    "tolerance_seconds": 10,
    "invalid_after_seconds": 180
  },
  "bins": [
    { "key": "bin_0", "ordinal": 0, "chart_value": "0",   "labels": { "en": "0 mg/L (fictional)" },   "review_trigger": false },
    { "key": "bin_1", "ordinal": 1, "chart_value": "0.5", "labels": { "en": "0.5 mg/L (fictional)" }, "review_trigger": false },
    { "key": "bin_2", "ordinal": 2, "chart_value": "3+",  "labels": { "en": "3+ mg/L (fictional)" },  "review_trigger": true }
  ],
  "quality_policy": {
    "require_reference_card": true,
    "min_roi_pixels": 40,
    "max_blur_variance": null,
    "max_clipped_fraction": null,
    "max_glare_fraction": null,
    "allow_manual_without_capture": true,
    "allow_direct_action": false,
    "closure_requires": {
      "verified_report": true,
      "accepted_action": true,
      "linked_retest": true,
      "communication": true
    },
    "model": { "enabled": false, "min_confidence": null, "abstain_outside_domain": true }
  },
  "reference_card": {
    "layout_id": "demo-card-fictional",
    "patch_count": 3,
    "lot": "FICTIONAL-LOT-0000"
  },
  "validity": { "from": "2026-09-22T00:00:00Z", "until": null },
  "approved_by": {
    "actor": "template-illustration-only",
    "role": "none — not a real domain approval",
    "at": "2026-09-22T00:00:00Z",
    "source_document": "none — fictional"
  }
}
```

Every numeric threshold that would need real manufacturer data (`max_blur_variance`,
`max_clipped_fraction`, `max_glare_fraction`, `model.min_confidence`) is left `null`
("not yet fitted"), exactly as [protocol-schema.md](../jalsakshi-blueprint/docs/architecture/protocol-schema.md)
specifies — this document does not invent analytical thresholds. `read_at_seconds: 60`
and the bin chart values are **structural placeholders**, copied from that same
schema file's own example, not a real kit's read time.

## Synthetic demo vs. operational use (REQ-009)

This record is explicitly **synthetic-demo-only**. It must never gate:
- an automated interpretation shown to a real user as a suggested result,
- a real sample's `timing_valid` calculation,
- any claim that a kit/lot/read-window has been verified.

Before this protocol could support operational use, a human domain owner must
replace every field above with values transcribed from an actual kit's printed
instructions, cite the source document, and sign `approved_by` — none of which
has happened here.

## Open blockers (real, not fictional)

- No real kit/analyte/manufacturer has been chosen.
- No lot number, expiry, or read-window has been transcribed from a real
  instruction sheet.
- `quality_policy` numeric thresholds remain unfitted (`null`) — this is
  correct behavior per the schema, not a gap in this template.

Per T01's own inputs→outputs contract ("...→ approved protocol/eligibility
record **or explicit blockers**"), this document records the blocker branch:
no real kit exists yet to approve.
