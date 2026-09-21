# Research review: decisions, not headline accuracy

## Findings that change the plan

1. **The chemical protocol is the measurement system.** Papers P01/P03/P07 support controlled imaging/reference methods; none establishes that an arbitrary phone photograph of water reveals contaminants. Our interpretation must bind kit, lot, read window, parameter and supported capture domain. → ADR-002; T01/T23; AC-002/019.
2. **Start with physically interpretable features.** P01/P10 and the partially accessible P04 favor testing simple methods before a CNN. Engineering inference: a feature-vector model is a better first local-AI candidate than a large visual-language model. → T25/T26; paired baseline comparison.
3. **Uncertainty is a product behavior.** Calibration literature P14 does not make a chemically invalid image valid. Separate quality, model confidence, domain support and human judgment. → T10/T27; reject/retake/manual/referral routes.
4. **Offline capture is established practice.** C02/C03 already cover important workflow needs; C01 and P15 challenge the originality of phone-based local water analysis. The hypothesis is better execution of a protocol-specific loop, not invention of its ingredients. → T02/T38.
5. **Native integration is a real build risk.** Camera image → correctly oriented/normalized pixels → tensor → local inference → durable encrypted storage requires engineering beyond adding ONNX as a dependency. → T03/T04 first.
6. **Scientific validity, runtime speed and operational impact are three different evaluations.** A short model inference, strong image correlation and reduced overdue referrals answer different questions. Report all separately; do not conflate them.

Bibliographic details, source links and reading depth are in the [register](source-register.md). Entries P01/P03/P07/P10/P11/P12/P13/P14 informed method-level analysis. Remaining papers were investigated at partial/abstract depth and are lower-confidence leads, not reproduced evidence.

## Proposed experiments

| Experiment | Decision tested | Design / outcome | Linked work |
|---|---|---|---|
| X01 Physical setup | Reference card alone versus simple light shield | Same independent kit preparations under varied lighting/phones; group all repeats; compare rejection and ordinal errors with setup time | T04/T23 |
| X02 Method ladder | Raw nearest chart → normalized distance → kNN → small MLP | Same frozen split; macro-F1, serious undercall rate, abstention/coverage, size and device latency; pick simplest passing model | T24/T25 |
| X03 Domain transfer | Leave-phone/lot/operator out | No near-duplicate leakage; evaluate per domain and unseen conditions; unsupported domains may abstain but coverage must be reported | T24/T27 |
| X04 Human factors | Does guidance improve reliable capture? | Counterbalanced task order with 5–8 target users; completion, retakes, interpretation errors, time; qualitative evidence only at this size | T02/T28 |
| X05 Runtime optimization | CPU fp32 versus supported int8 | Identical images/device builds; paired outputs, warm/cold latency, memory, failure rate | T27/T29 |
| X06 Workflow value | JalSakshi versus current process/configured existing tool | Shadow baseline then 50–100 records; ownership completeness, referral time, overdue and evidence-complete closure; no causal claim from uncontrolled before/after | T38 |
| X07 Offline correctness | Can interrupted writes/sync lose or duplicate evidence? | Process kill at each save stage, duplicate deliveries, reordered requests, token expiry and server failover | T12/T14/T15 |
| X08 Capacity | Does per-tenant serialization bottleneck bursts? | 1/10/50 request-per-second steps with hot tenant, long transaction and image uploads; count accepted unique events | T30/T41 |

## Data acquisition protocol — proposed, not collected

Select one kit with a domain reviewer. Record manufacturer method, allowed temperature/lighting/read window, expiry, lot and chart provenance. Prefer prepared standards/reference measurements supervised by a qualified lab; do not ask teammates to mix hazardous contaminants.

A feasibility collection might use 60 independent preparations spanning the kit's reportable bins, with repeated captures on three phones and several light conditions. That creates many photos but still only 60 independent preparations. It is enough for pipeline exploration, not a definitive safety claim. Validation sample size must follow the clinically/operationally significant error rate and uncertainty, not an attractive image count.

Preserve raw originals securely where approved; derived crops/features are reproducible. Group by physical preparation, session and source. Record device, lighting, operator, kit lot, reference, timing, actual reference result and uncertainty. Missing reference labels must not be manufactured from the model itself.

## Statistical interpretation

Correlation and R-squared do not equal accuracy; a biased instrument can correlate strongly. For any later numerical concentration output, evaluate agreement/bias, repeatability, units and reportable range against the appropriate reference method. For initial ordinal bins, report confusion matrices and dangerous-direction errors, not only overall accuracy.

Train/validation/calibration/test partitions serve different purposes. Photographs of the same strip, augmentations or images from the same preparation cannot be scattered across them. Confidence intervals must use independent units or clustered resampling.

No selected publication's timing can be transplanted onto an unknown Android handset. No disease reduction, nationwide savings or percentage improvement is currently measured.

## Recentness and limits

Recent P07 (2025), P08/P15 (2026) and P09's 2026 issue were investigated; older papers remain valuable for optical control, efficient inference and confidence calibration. This is a focused technical/prior-art review, not a systematic review or patent freedom-to-operate opinion. Paywalls, intermittent PDF access and unverified reusable datasets limit reproduction. A pilot should fund protocol/data work before polishing a numerical accuracy claim.

