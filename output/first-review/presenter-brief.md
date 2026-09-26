# JalSakshi first review: presenter brief

For whoever presents at the first review, 25 Sep 2026. One page. Page numbers refer to `jalsakshi-first-review.pdf`.

## Opening line (15 seconds)

"India runs about a crore field-kit water tests a year. Official audits show the weak point is not the test but what happens after a bad result. JalSakshi makes sure a flagged result gets an owner, a lab check, a fix, a retest and a resident update, or stays visibly overdue."

## Five strongest talking points

1. **The gap is documented by the state's own auditors (p.4).** Karnataka retested 559 of 3,078 kit-contaminated samples in 2023-24 (18%), and none in the two previous years. Lab turnaround was 9–106 days against a 1–2 day norm. In Kerala, district labs did not send results to panchayats for remedial action. (CAG Reports 12/2025 and 10/2025.)
2. **People cannot see the risk (p.6).** In the Ministry's 2024 national survey, 1 in 4 household tap samples failed microbiological tests (27% at schools, anganwadis and health centres), while 92.4% of households said they were satisfied with quality.
3. **Our core claim is demonstrable live (p.9, p.17).** A record saved in airplane mode survives a forced restart and syncs once. The server then refuses to close the case until there is a verified lab report (checked by a different person), a corrective action, a same-source retest and a resident communication.
4. **We refuse false certainty (p.10, p.12).** Screening is always labelled indicative. The on-device model is research-only, abstains and has a kill switch, and the public view never says "safe to drink". Judges tend to trust teams that show their limits.
5. **There is a concrete path from project to product (p.15–16).** Residential campuses first, priced per site rather than per user (₹7,500/month hypothesis). Break-even is about 58 customers, which is the number we will validate, not a promise.

## Claims to qualify every time

| If you say… | Always add… |
|---|---|
| "It works end to end" | on **synthetic** data, on an **emulator** and hosted **staging**. No physical-phone run yet |
| Any accuracy or AI statement | The model is **research-only**, trained on synthetic captures. In the live flow every reading is manual |
| "Unique" / "no one else does this" | Don't say it. Say "the combination we found in a dated desk review". mWater and ODK can be *configured* to do much of this |
| Audit percentages | These are **Karnataka / Kerala** findings, not national figures |
| Incident deaths (Indore 24 of 36) | The number is **reported** from a confidential judicial commission report. Never say JalSakshi would have prevented it |
| Kochi lab report delay | It is an **allegation** by residents |
| Revenue or impact numbers | They are **scenarios with labelled assumptions**, not forecasts. No customer, pilot or willingness-to-pay exists yet |
| Resident complaints / points | The **API** is built and tested. No app screen yet, and SMS/push delivery is not connected |
| "Ready for real data" | Not yet: 10 production blockers are open (RLS/owner role, phone encryption, secrets rotation, licence, domain sign-off…) |

## If something fails during the demo

- **No network:** the offline steps need none. Show local save, force-stop, reopen.
- **Staging asleep:** the first request can take about a minute. Wake `https://jalsakshi-api.onrender.com/health/ready` 5 minutes before you present.
- **Server steps fail:** show the recorded 8-step journey (`tests/e2e/field-case.spec.ts`) and **label it as a recording**.
- Never type a result in and present it as real.

## Housekeeping before presenting

- Rotate the database and demo passwords. The team's own release review flags them as exposed.
- Keep the "SYNTHETIC" banners visible in every screen you show.
