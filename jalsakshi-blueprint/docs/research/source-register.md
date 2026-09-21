# Source register

Research cutoff: **21 September 2026 UTC**. Fifteen papers investigated. Reading depth is explicit: **M** = accessible methods/results inspected; **P** = partial text/abstract/metadata only. Neither means independently reproduced. Peer-reviewed status describes venue publication, not guaranteed correctness. Unless noted, no reusable code/data license or handset benchmark was verified. All performance implications below are engineering estimates, not measurements.

## Papers

### P01 — Single-Image-Referenced Colorimetric Water Quality Detection Using a Smartphone

Kılıç, Alankuş, Horzum, Mutlu, Bayram and Solmaz; ACS Omega 3, 5531–5536; 22 May 2018; peer-reviewed. DOI 10.1021/acsomega.8b00625. [Author-hosted paper](https://www.pncalab.com/uploads/pdfcatalog/2018_3.pdf). **M:** methods, classifier comparison and limitations inspected.

Addresses instrument cost through referenced color features. Four assays, LG G4, fixed capture settings and illuminated enclosure; compares CIELAB-distance/correlation approaches. Patch sampling is not independent field sampling. Some classes performed strongly but performance varied by analyte; discrete training levels limit interpretation.

**Decision:** adapt normalized ordinal-color baseline; reject universal-accuracy transfer. Quality depends on chemistry and lighting; compute should be small, but capture dominates; extra reference/setup effort is justified. Confidence high in baseline relevance, low in direct field generalization. Links: T10/T11, ADR-002. No dataset permission inferred from article access.

### P02 — A Smartphone-Based Automatic Measurement Method for Colorimetric pH Detection Using a Color Adaptation Algorithm

Sung Deuk Kim, Youngmi Koo and Yeoheung Yun; Sensors 17(7),1604; 10 July 2017; peer-reviewed. DOI 10.3390/s17071604. [Publisher](https://www.mdpi.com/1424-8220/17/7/1604); [paper mirror](https://pdfs.semanticscholar.org/d2da/c8ea7060ce25a3788eefdd2e858b1980a87d.pdf). **P:** abstract and accessible method excerpts; PDF initially indexed but subsequent body access failed.

Uses color adaptation and automatic measurement with a reference chart and controlled imaging accessory; multiple Android phones. Exact split, error distribution and reusable code were not independently established.

**Decision:** prototype physical light control against software-only correction, not copy reported accuracy. Potentially steadier quality but adds hardware/setup and user burden; small computational overhead. Confidence medium in direction, low in performance transfer. T04/T23. Do not choose a pH protocol merely because this paper used one.

### P03 — Accurate device-independent colorimetric measurements using smartphones

Miranda Nixon, Felix Outlaw and Terence S. Leung; PLOS ONE 15(3),e0230561; 26 March 2020; peer-reviewed. DOI 10.1371/journal.pone.0230561. [Full article](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230561). **M:** acquisition/calibration methods and discussion inspected.

Uses flash/no-flash RAW measurements, device mapping and shading correction, evaluated with Samsung S8/LG Nexus 5X and MATLAB. Stable capture and device calibration are substantive requirements; a white sheet or JPEG normalization is not equivalent.

**Decision:** adopt the principle of reference/device validation; defer full RAW-pair implementation. Extra captures and device support increase latency, effort and usability risk. Confidence high in calibration importance; no claim of device independence for our app. Public-data DOI [10.7910/DVN/JJRH4N](https://doi.org/10.7910/DVN/JJRH4N) is a candidate; repository access/license verification was unsuccessful. T23/T24.

### P04 — A field-deployable water quality monitoring with machine learning-based smartphone colorimetry

Vakkas Doğan, Tuğba Işık, Volkan Kılıç and Nesrin Horzum; Analytical Methods 14,3458–3466; September 2022; peer-reviewed. DOI 10.1039/D2AY00785A. [PubMed record](https://pubmed.ncbi.nlm.nih.gov/36000587/). **P:** abstract/metadata read; publisher full text blocked.

Reports seven-ion strip analysis across five phones/eight lighting conditions and a comparison of 23 classifiers; kNN was favored, with a Hydro Sens Android application. Dataset independence, split procedure, deployment time and distributable weights were not verified.

**Decision:** include simple feature models before CNNs. Potentially low compute and CPU-trainable, but a training distribution is still essential. Confidence medium for candidate selection; low for copying numerical performance. T25 compares baseline, kNN and small MLP. This is prior art, not proof that generic pretrained vision can read our chosen kit.

### P05 — Smartphone-based colorimetric method for decentralized wastewater treatment monitoring by inexperienced users

Sergei Gusev, Flor Louage, Stijn W. H. Van Hulle and Diederik P. L. Rousseau; Chemometrics and Intelligent Laboratory Systems 246,105087; March 2024; peer-reviewed. DOI 10.1016/j.chemolab.2024.105087. [Publisher](https://www.sciencedirect.com/science/article/pii/S0169743924000273). **P:** publisher abstract/introduction excerpts; full text unavailable.

Modified strips with markers/reference colors support multi-parameter wastewater measurements by nonexperts. Reported correlations are not classification accuracy or drinking-water certification. User-study size, independent validation and kit transfer remain unverified.

**Decision:** adapt human-centered capture guidance and evaluate handling errors. Adds protocol/UI work, little inference cost; marker printing may introduce consumable variation. Confidence medium. T02/T23/T28. No permission to reproduce proprietary charts inferred.

### P06 — Comparison of test strip, conductivity, and novel smartphone digital image colorimetry methods for field assessment of soil chloride and salinity

Michael R. Muir and Andrew Innes; Analytical Methods 16,5571–5583; 24 July 2024; peer-reviewed. DOI 10.1039/D4AY00991F. [Publisher](https://pubs.rsc.org/en/content/articlehtml/2024/ay/d4ay00991f); [PDF](https://pubs.rsc.org/en/content/articlepdf/2024/ay/d4ay00991f). **P:** abstract/introduction inspected; PDF indexed, later body requests blocked.

Compares practical field methods for soil extracts rather than our drinking-water matrix. Reference method selection and matrix effects matter. No reusable runtime or dataset was established.

**Decision:** use matched reference testing as an experimental design lesson; reject transferring soil performance to water. Lab cost/time dominates, not inference. Confidence medium in methodological relevance, low for domain transfer. T23/T24. Excluded from any “our water accuracy” calculation.

### P07 — Accessible water quality monitoring through hybrid human–machine colorimetric methods

Dakota Aaron McCarty, Minji Alyssa Kim, Hyunwoo Jo, Eunchong Yim, Hayoung Yun, Samuel Sims, Minji Kim and Soyoung Kwon; Environmental Monitoring and Assessment 197,555; 15 April 2025; peer-reviewed. DOI 10.1007/s10661-025-13983-x. [Full paper](https://d-nb.info/1371204373/34). **M:** methods, sampling and comparison sections inspected.

Uses 34 stream samples, commercial multi-parameter strips, human ROI selection and RGB-distance interpolation with laboratory comparisons. Strip/chart illumination was controlled. Correlation does not establish unbiased agreement, and a small stream study is not broad field validation.

**Decision:** keep human ROI/manual interpretation; evaluate ordinal bins before continuous concentration. Low-compute approach may improve feasibility; demands disciplined capture and reference testing. Confidence high for hybrid workflow, medium/low for analytical transfer. T09/T11/T24. No universal percentage claim adopted.

### P08 — Smartphone-based colorimetric sensing with reference calibration and ensemble machine learning for enhanced detection of nitrite and ammonium ions

Trung Nguyen Quoc and colleagues; Analytica Chimica Acta 1388,345097; 22 February 2026; peer-reviewed. DOI 10.1016/j.aca.2026.345097. [Publisher](https://www.sciencedirect.com/science/article/pii/S0003267026000474); [publisher-deposited author metadata](https://api.crossref.org/works/10.1016/j.aca.2026.345097). **P:** abstract and metadata; full body blocked.

Reports controlled lightbox/reference calibration, 2,700 dye images and 5,400 analyte images over multiple phones, comparing eight models. Image counts are not independent sample counts; exact device-held-out split was not established here.

**Decision:** prototype feature normalization and small ensembles offline; do not select XGBoost merely from headline scores. Quality gains are plausible; conversion/operator compatibility and model size add risk. Confidence medium in experimental direction, low in reproduced performance. T25/T27. Prefer native-compatible small model if it meets the same quality gate.

### P09 — A critical review of the use of smartphone cameras in water quality analysis

Chotiwat Jantarakasem, Laure Sioné and Michael R. Templeton; Environmental Technology Reviews 15(1),2026; peer-reviewed review. DOI 10.1080/21622515.2025.2593442. [Publisher](https://www.tandfonline.com/doi/full/10.1080/21622515.2025.2593442). **P:** indexed metadata/excerpts; full article blocked. Exact online-first date not independently verified; DOI year and issue year differ.

Survey context spans smartphone water analysis. Search coverage and individual study appraisal could not be fully audited.

**Decision:** retain as a reading lead, not an authority for a precise technical performance claim. No runtime benefit or cost estimate can be derived. Confidence low for substantive synthesis until full text is read. T23 researcher may obtain lawful access; no design gate relies solely on this review.

### P10 — Smartphone-based colorimetric detection via machine learning

Ali Y. Mutlu, Volkan Kılıç, Gizem Kocakuşak Özdemir, Abdullah Bayram, Nesrin Horzum and Mehmet E. Solmaz; Analyst 142,2434–2441; 19 May 2017; peer-reviewed. DOI 10.1039/C7AN00741H. [Publisher](https://pubs.rsc.org/en/content/articlelanding/2017/an/c7an00741h/unauth); [author PDF](https://www.pncalab.com/uploads/pdfcatalog/2017_2.pdf); [earlier arXiv manuscript](https://arxiv.org/abs/1703.10217). **M:** archived manuscript methods and publisher metadata inspected. The preprint is not a separate study.

Uses LS-SVM with pH strip images, apparatus/no-apparatus lighting experiments and different image formats. Reported perfect discrete classification is not evidence of universal precision or independent field performance.

**Decision:** adopt simple-model comparisons and lighting stress tests; reject unbounded accuracy wording. Low-dimensional models need little compute; acquisition/training bias remains the main difficulty. Confidence medium/high for baseline choice. T24/T25.

### P11 — Searching for MobileNetV3

Andrew Howard and colleagues; ICCV 2019; peer-reviewed conference paper. [Paper](https://arxiv.org/pdf/1905.02244), arXiv:1905.02244. **M:** architecture, search procedure and device tables inspected.

Combines hardware-aware architecture search, NetAdapt and efficient blocks. ImageNet/COCO and named Pixel devices support its original results, not strip accuracy. Training-search resources differ from fine-tuning resources.

**Decision:** prototype MobileNetV3-Small only for capture-quality/ROI classification if feature rules fail. CNN decoding/tensor memory and training burden exceed a small feature model; potential benefit is robustness to handling defects. Confidence high as a mobile candidate, low before domain testing. T25/T27. Weight license and export compatibility must be checked separately.

### P12 — MobileNetV4: Universal Models for the Mobile Ecosystem

Danfeng Qin and colleagues; ECCV 2024; peer-reviewed. DOI 10.1007/978-3-031-73661-2_5. [Conference paper](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/05647.pdf); [HTML manuscript](https://arxiv.org/html/2404.10518v1). **M:** architecture and hardware/evaluation discussion inspected.

Universal inverted bottlenecks and mobile attention address varied accelerators; ImageNet/COCO and multiple hardware backends. FLOPs alone do not predict latency; some model/backend combinations have support constraints.

**Decision:** defer replacing a functioning smaller model; benchmark if CNN performance is inadequate. New export/runtime risk and memory cost must buy measured quality/latency improvement. Confidence high in hardware-specific benchmarking principle, medium as later candidate. T27. A newer architecture is not automatically better for our feature-vector workload.

### P13 — Quantization and Training of Neural Networks for Efficient Integer-Arithmetic-Only Inference

Benoit Jacob and colleagues; CVPR 2018; peer-reviewed. [Paper](https://arxiv.org/pdf/1712.05877), arXiv:1712.05877. **M:** quantization/training method and evaluation inspected.

Integer arithmetic, calibrated activation ranges and quantization-aware training target efficient inference. ImageNet/detection trade-offs and device-specific kernels demonstrate that accuracy and speed require measurement.

**Decision:** prototype int8 only after fp32 baseline; require paired quality and handset benchmarks. Smaller weights may reduce memory/load time, but operator fallback or tiny-model overhead can eliminate speed gains. Confidence high in need for comparative gates; no fixed speedup promised. T27. Never calibrate quantization using the held-out test set.

### P14 — On Calibration of Modern Neural Networks

Chuan Guo, Geoff Pleiss, Yu Sun and Kilian Q. Weinberger; ICML 2017, PMLR70; peer-reviewed. [Proceedings](https://proceedings.mlr.press/v70/guo17a.html); [paper](https://proceedings.mlr.press/v70/guo17a/guo17a.pdf). **M:** temperature scaling, reliability measures and limitations inspected.

Held-out logit calibration improves many evaluated classifiers' confidence behavior. It does not detect every distribution shift or establish chemical validity.

**Decision:** calibrate a probabilistic model separately from training/selection and support abstention. Minimal runtime overhead; additional held-out data and reporting work. Confidence high in technique relevance, medium in benefit for a small/noisy dataset. T24/T27. Do not attach pseudo-confidence to deterministic nearest-color distance.

### P15 — A fully on-device and lighting-robust system for nitrite quantification using smartphone colorimetry and machine learning

Longqian Zhang, Fang Wang, Yuan Gao, Zhenrong Xu, Jie Shu, Junke Wang and Li Zhang; Journal of Food Measurement and Characterization 20,10228–10242; 31 March 2026; peer-reviewed. DOI 10.1007/s11694-026-04299-6. [Publisher](https://link.springer.com/article/10.1007/s11694-026-04299-6). **P:** abstract, availability and publication record; full text subscription-only.

Reports local Android processing and a 1,134-image dataset over controlled lighting, with additional-device calibration. Data are available on request, not confirmed openly licensed. This is particularly direct prior art for local colorimetric inference.

**Decision:** adapt the question “does unseen-phone calibration help?”; do not claim first offline AI water analysis. Runtime, split details and code reproducibility remain unverified. Confidence medium for relevance, low for transfer. T23/T25. Request data only with user authorization; no external contact has been sent.

## Official context and implementation sources

The entries below are primary documentation/product descriptions, not independent comparative trials. All visited at the cutoff; living documentation has no fixed study dataset.

| ID | Source, organization, date/status | What was inspected; adoption and limits |
|---|---|---|
| S01 | [FTKs under JJM](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2240597&lang=1&reg=1), Ministry of Jal Shakti, 16 March 2026, official release | Full body. Screening/confirmation boundary and reported program figures; high confidence for wording, not impact efficacy. REQ-009/011. |
| S02 | [Karnataka JJM audit](https://cag.gov.in/webroot/uploads/download_audit_report/2025/Combined-Pdf_JJM-Final-03.03.26-069c25b7fcf4287.01649139.pdf), CAG, Report 12 of 2025, official audit | Chapter V/table 5.1 text, printed p52: 18% contaminated samples retested in Karnataka 2023–24. Separate sampled-district result is 549/910; do not mix denominators. Screenshot retrieval failed; use original table for future slide recreation. |
| S03 | [Hack the Future listing](https://api.unstop.com/hackathons/hack-the-future-3o-tulas-university-1748989), organizer/Unstop, 2026 listing | Body inspected; event details and rubric, not guaranteed admission. Track website extraction failed. Schedule inconsistency recorded in assumptions. |
| D01 | [ONNX React Native](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html), Microsoft/ORT, living official docs | Native package API. Runtime, not a trained model; installation does not prove Expo/operator compatibility. High confidence; T03/T26 device smoke gate. |
| D02 | [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), Expo, living official docs | Persistence, prepared statements and SQLCipher configuration. Native rebuild needed for encryption; photos are separate. High confidence; T12/T32. |
| D03 | [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), Expo, updated September 2026 | Native libraries need own development build. Do not plan on Expo Go for custom native/ORT stack. High confidence; T03. |
| D04 | [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), Expo, living official docs | Capture/QR interface; file capture is not a ready-to-infer pixel tensor. Native preprocessing remains work. T04/T09, medium until device proof. |
| D05 | [Expo Background Task](https://docs.expo.dev/versions/latest/sdk/background-task/), Expo, living official docs | OS-scheduled tasks; Android minimum interval is not immediate delivery guarantee. Adopt foreground/reopen sync; background best effort. High confidence; T15. |
| D06 | [ORT quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html), Microsoft/ORT, official guide | Static/dynamic calibration, debugging and supported representations. Use only compatible operators after paired tests; no automatic speed claim. T27. |
| D07 | [OpenCV geometric transforms](https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html), OpenCV, official API | Perspective correction operations; not analytical calibration. Native integration adds binary/build cost; test coordinates/colors against fixtures. T04/T10. |
| D08 | [Android Keystore](https://developer.android.com/privacy-and-security/keystore), Google, official docs | Key handling, hardware availability and invalidation constraints. Adopt platform crypto rather than custom cryptography. Device compromise remains a risk; T32. |
| D09 | [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), PostgreSQL project, official docs | Policies default-deny when enabled; owners/superusers may bypass. Adopt non-owner app role plus tested API policy; T31. |
| D10 | [File upload risks](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload), OWASP, security guidance | Unsafe type/path/content handling. Allowlisted, private, bounded quarantine; not a claim of compliance. T16/T31. |
| D11 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/), W3C recommendation | Relevant criteria inspected; target AA web behavior and equivalent mobile usability, not certification. T28/T34. |
| D12 | [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/), AWS, official prices checked 21 September 2026 | Bundle, encrypted DB, storage and snapshot price lines; region/overage caveats. Cost arithmetic and assumptions are in cost-and-capacity, not benchmark claims. |
| C01 | [Akvo Caddisfly](https://github.com/akvo/akvo-caddisfly), Akvo, open-source Android repository | README and license label inspected. Smartphone water testing with Flow integration; GPL-3.0 reuse needs a licensing decision. Repository not built/audited; no maintenance claim. |
| C02 | [mWater app overview](https://portal.mwater.co/resource_center/app_overview.html), mWater, official product manual | Full operational sections: offline data, sites, surveys, assignments/issues and synchronization. Very strong alternative. Descriptions are not our hands-on evaluation. |
| C03 | [ODK Entities](https://docs.getodk.org/entities-intro/), ODK, official product docs | Longitudinal linked records and offline behavior/version limitations. Valuable configuration-first alternative; check target versions, access filters and deployment cost. |
| C04 | [WQMIS mobile app](https://ejalshakti.gov.in/WQMIS/main/mobile_app), government portal | Public registration/mobile description only. No comprehensive workflow audit or integration permission. No asserted absence of closure features. |
| R16 | [Local-first software](https://www.inkandswitch.com/essay/local-first/), Kleppmann and colleagues/Ink & Switch, 2019 research essay | Local ownership/availability and CRDT discussion inspected. Adopt local durability; reject general-purpose CRDT merging for authorization/closure. Conceptual evidence, no app latency estimate. |

## Data and model availability

| Candidate | Availability / licensing | Suitability and decision |
|---|---|---|
| P03 calibration dataset | Public DOI found; license/files not successfully inspected | Candidate calibration exercise only; not chosen training data |
| P04/P08 datasets | No verified downloadable licensed dataset in reviewed material | Request/verify before use; do not assume public |
| P15 dataset | Publisher says available on reasonable request; no automatic reuse license | Not a hackathon dependency |
| Akvo code | GPL-3.0 repository label; dependency/assets licenses require inspection | Study prior art; no copying into permissive code by default |
| MobileNet weights | Architecture paper is public; exact weight source/license not yet chosen | T25 records weight URL, SHA, license and allowed use before downloading for deployment |
| Own kit images | None collected; permissions and consent not established | Primary intended dataset under a written protocol, consent and versioned manifest |
| Generated deck images / web strip photos | Concept/unknown physical calibration | Never ground truth; generated images allowed only for visibly synthetic UI fixtures |

No suitable openly licensed, India-field, exact-kit cross-device dataset was verified. Data acquisition is a critical path, not a last-minute download task.

