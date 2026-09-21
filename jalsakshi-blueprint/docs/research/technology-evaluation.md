# Technology evaluation

All classifications are proposed decisions. “Adopt” means intended architecture, not installed/verified. Source IDs refer to the [register](source-register.md). Effort is estimated focused engineering time, excluding waiting for kit/lab access.

| Candidate | Status / concrete reason | Trade-offs, maturity and reversibility | Experiment / success |
|---|---|---|---|
| Reference-normalized ordinal color baseline | Adopt; interpretable comparator before learning (P01/P07) | Small compute, no training; sensitive to reference and lighting; replace through one analysis contract | X01/X02; establish error/rejection baseline |
| Small feature MLP on ONNX | Adopt as first local-ML candidate, subject to gates; no cloud needed | CPU-trainable; standard MatMul/activation operators, small asset; accuracy unknown; reversible signed model version | T25/T26; gates in evaluation, airplane-mode proof |
| kNN/linear model | Prototype first as competing baselines (P04/P10) | Simple but kNN memory scales with examples; exporting every estimator to mobile is not automatic | Compare in Python; choose smallest passing runtime-compatible candidate |
| Random forest/XGBoost | Prototype first (P08/P15) | Useful nonlinearity; tree operator availability/size must be proved; no mandatory dependency if MLP sufficient | Equal split, export and device smoke; adopt only meaningful gain |
| MobileNetV3-Small quality head | Prototype first only if rules fail on glare/ROI | More labels, pixel/tensor memory, native preprocessing; pretrained object labels do not read chemistry (P11) | Error reduction on hard capture set without loss of supported coverage |
| MobileNetV4 replacement | Defer (P12) | Newer hardware-oriented design; extra backend/export work; not needed for tiny features | Revisit if CNN bottleneck remains after measurement |
| int8 / QAT / distillation | Prototype int8; defer QAT/distillation unless needed | Possible memory savings, not guaranteed speed; representative calibration/data burden (P13/D06) | Paired quality and p95 gates; fp32 rollback retained |
| RAW flash/no-flash correction | Defer, not required by original scope | Stronger physical control but multi-capture, alignment and camera-API support costs (P03) | Revisit if one-shot capture cannot reach valid operating domain |
| SQLite + atomic outbox | Adopt (D02/R16) | Durable offline core; native DB migrations and disk failure handling required | X07; exactly one server record after retries |
| OS background synchronization | Adopt best effort only (D05) | Battery/scheduler constraints; cannot be source of correctness | Reopen/Sync Now always drains; closed-app delay honestly displayed |
| General CRDT database | Reject for current workflow | Concurrent clinical-style closure should conflict, not merge silently | Immutable samples + case version checks simpler; revisit collaborative drafting only |
| Postgres ordinary indexes | Adopt | Enough for identifiers, queue filters and cursors; no new service | Query plans and T30 load tests |
| PostGIS/live clustered map | Defer optional map, not source lookup | Map maintenance/privacy/offline tile costs; a searchable list covers committed workflow | Add only when geographic triage demonstrably improves task completion |
| Redis/Kafka/microservices | Reject now | Adds ordering/ops/memory risk to three-person team | Per-tenant changefeed and Postgres worker; reconsider measured saturation |
| LLM/RAG/vector database/product agents | Reject | No need for generative interpretation of safety-related results; hallucination/privacy/latency costs | Coding agents stay development-only; no runtime spend |
| Live sockets/token streaming | Reject for normal case board | Bounded polling and mutation refresh meet freshness needs | Revisit only if measured multi-user urgency requires it |
| Native preprocessing via Kotlin + OpenCV | Adopt behind one explicit bridge (D07) | Handles pixels, orientation and homography off UI thread; APK size/build risk | T04 fixtures + real-device proof before UI investment |

## Compatibility gate

T03 must record exact Expo SDK, React Native, Android SDK/minSdk, JDK, Node, ONNX runtime, OpenCV, SQLite/SQLCipher and Python dependency versions in lockfiles and a tested matrix. Do not select “latest” independently for every package. Build a release-mode APK, run one known tensor and one camera-derived tensor on the actual phone.

Astra/Fable access does not remove this gate. Agents can generate code quickly but cannot synthesize reliable labels, physical calibration or device measurements.

