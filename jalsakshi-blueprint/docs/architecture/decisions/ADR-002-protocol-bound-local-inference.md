# ADR-002 — Protocol-bound local inference with abstention

Status: proposed. Owner B. Related REQ-002–REQ-006/009/019.

Decision: capture must include approved kit reference and timing. First establish deterministic ordinal baseline; then evaluate small feature models, deploying a compatible small MLP through ONNX when quality gates pass. Local ML remains required in the complete product; an unvalidated demo model stays research-only.

Alternatives: a cloud vision LLM has weak measurement justification and breaks offline/privacy constraints; an end-to-end CNN may be useful but requires more data; exact concentration regression is deferred until method-specific agreement is established.

Consequences: no generic pretrained “water quality AI.” Calibration, dataset independence and domain coverage are substantial work. Never change no_flag into potable. Unsupported kit/lighting/device causes uncertainty or manual fallback.

Evidence: P01/P03/P04/P07/P10/P14; newer P08/P15 are relevant but only partially read. [Register](../../research/source-register.md). Validation: X01–X05, T23–T27. Revisit model family only for measured benefit at equal quality/coverage, not novelty.

