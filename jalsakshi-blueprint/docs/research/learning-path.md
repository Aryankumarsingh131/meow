# Learning path for three AI-assisted builders

Read to produce a small verification artifact, not to memorize every framework. Sources below are also catalogued in [source register](source-register.md).

| Order / owner | Learn | Resource | Exercise / completion evidence |
|---|---|---|---|
| 1 / all, 45 min | Screening vs confirmation and actual kit protocol | S01 + manufacturer instructions selected in T01 | Explain why normal pH does not certify potability; mark which outputs are allowed |
| 2 / B, 90 min | Illumination, reference colors, RGB/CIELAB and ordinal bins | P01/P03/P07 methods | On authorized sample photos compare raw/normalized features; explain why generated chart colors are not calibration |
| 3 / B, 90 min | Leakage, group splits, uncertainty | P14 + testing-and-evaluation | Split by preparation, not photos; make reliability/confusion plots with synthetic labels clearly marked |
| 4 / A+B, 90 min | Native app vs Expo Go; file-to-pixel-to-tensor | D01/D03/D04/D07 | One real photo through orientation/ROI fixture into local ONNX; record actual phone/build |
| 5 / A+C, 60 min | Durable offline state, transactions and retry | D02 and API contracts | Kill app mid-save and resend same event; explain each durable boundary |
| 6 / C, 60 min | Tenant policy, immutable events, authorization | D09 + data model/security | Two organizations attempt cross-access; only intended role transitions succeed |
| 7 / A, 45 min | Accessible field interactions | D11 + UI spec | Complete source/capture/manual/save using screen reader and larger text |
| 8 / C, 60 min | Recovery is part of deployment | Operations plan and provider backup docs selected in T35 | Restore a staging backup into isolated DB and verify counts/hashes |

Estimated learning times are orientation budgets, not mastery guarantees. If the exercise fails, give the coding agent the concrete failing input and authoritative contract; don't ask it to “make everything production ready.”

Before trusting generated code, each owner should be able to explain their critical boundary: A—what was saved; B—what the model does not know; C—who may change or close a case.

