# Protocol and bins schema — v1

Fills the Phase 1 gap where `protocols.bins` and `protocols.quality_policy` were named in the data model but never given a shape. This is the most domain-critical structure in the system: it encodes what a kit can and cannot say. Owner: C (schema) with A/domain reviewer (values). Values are supplied by T01; **this document defines the container, never the thresholds.**

## Invariants

- A protocol version is **immutable**. Changing any field means a new `version`. Accepted samples keep the version they were captured under, forever.
- Thresholds, bins and read windows come from the manufacturer's instructions, transcribed and approved in T01. No value in this system is invented, rounded for convenience, or copied from a different kit.
- `review_trigger` decides which bins raise a case. It is a protocol property, not a global safety rule, and it is never "the red ones".
- Bins are **ordinal**, not numeric truth. `bin_2` means "the second reportable level of this chart", not a concentration measurement.

## Protocol document

```json
{
  "schema_version": 1,
  "id": "UUID",
  "version": 1,
  "manufacturer": "string",
  "kit": "string",
  "parameter": "string",
  "unit": "string | null",
  "method": "colorimetric_strip",
  "read_window": {
    "prepare_seconds": 0,
    "read_at_seconds": 60,
    "tolerance_seconds": 10,
    "invalid_after_seconds": 180
  },
  "bins": [
    {
      "key": "bin_0",
      "ordinal": 0,
      "chart_value": "0",
      "labels": { "en": "0 mg/L", "hi": "0 मिग्रा/ली" },
      "review_trigger": false
    }
  ],
  "quality_policy": { },
  "reference_card": {
    "layout_id": "string",
    "patch_count": 0,
    "lot": "string"
  },
  "validity": { "from": "ISO-8601", "until": "ISO-8601 | null" },
  "approved_by": { "actor": "string", "role": "string", "at": "ISO-8601", "source_document": "string" }
}
```

**`read_window` semantics.** `read_at_seconds` is measured from the protocol's declared start event. A capture inside `read_at ± tolerance` is `timing_valid = true`. A capture after `invalid_after_seconds`, or one whose elapsed time cannot be established (reboot, uncertain clock), is `timing_valid = false` — which forbids an assisted interpretation but still permits a manual reading recorded as such. The example values above are structural placeholders; **60 is not any selected kit's read time.**

**`bins` rules.** `ordinal` is contiguous from 0 and defines sort order for ordinal error metrics. `key` is stable and is what `observations.machine_bin` / `manual_bin` / `selected_bin` store. `chart_value` is the manufacturer's printed value as a string — never parsed into a float, because "0.5", "<0.3" and "0.3–0.6" are all real chart legends. `labels` must contain every language in the deployment's active set; a missing translation blocks protocol approval rather than silently falling back to English on a safety-relevant label.

## quality_policy

```json
{
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
  "model": {
    "enabled": false,
    "min_confidence": null,
    "abstain_outside_domain": true
  }
}
```

`null` means **not yet fitted** — the check is skipped and the reason code `THRESHOLD_UNSET` is recorded on the observation. It does not mean "unlimited" and it must never silently pass as if the check succeeded. T10 fits these experimentally and marks them provisional; T27 approves them.

`closure_requires` is consumed directly by guard G-CLOSE in the [case state machine](case-state-machine.md). `allow_direct_action` gates transition row 4. `model.enabled` is false until T27 approves a model for this protocol version — so a research model physically cannot produce an operational suggestion by configuration alone.

## Storage

Stored as a `jsonb` column on `protocols` validated by a Pydantic model at write time, not as a free-form blob. Rationale: the shape is stable but the *contents* vary per manufacturer, and normalising bins into their own table buys nothing when bins are only ever read as a complete immutable set alongside their protocol version.

Indexes: `(tenant_id, id, version)` unique; `(tenant_id, kit, parameter, active)`.

## What this schema deliberately cannot express

Continuous concentration output, multi-parameter strips, cross-parameter rules, and kit-specific temperature corrections. Each is a real thing some kits do. Adding them before one single-parameter kit is validated end to end would be designing for kits we have not selected. REQ-024's second-kit exercise (T40) is the checkpoint that tells us which of these is actually needed.
