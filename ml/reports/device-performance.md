# Device performance (T29) — EMULATOR ONLY

Status: **partial.** No physical phone exists for this project, so every figure
below is from the Android emulator. They are useful for comparing builds, not as
evidence of how the app performs on the reference phone.

## Conditions (session 1, 2026-09-25)

| Field | Value |
|---|---|
| Build | `jalsakshi-v2.2.0.apk`, release, commit `d2cb7b9` |
| Device | `sdk_gphone64_x86_64` emulator, Android 15, 2.5 GB RAM, software GPU (swiftshader) |
| Thermal / battery | status 0 / 100% (both emulated, not measured) |
| Host | Windows 11 laptop, disk ~100% full (2 GB free) during the run |
| Model | `syn-color-001-mlp@1`, SHA-256 `597d667f…202e` |

## Results against the plan's budgets

| Workflow | n | Measured | Budget p50 / p95 | Verdict |
|---|---:|---|---|---|
| Cold APK start → sign-in screen | 20 (+10 warm-ups discarded) | min 2651, **p50 3339**, 19th of 20 3963, max 4123 ms | 1.5 s / 3 s | **Over budget on the emulator.** Needs a phone before any conclusion |
| On-device model inference | 29 per opening, 1 opening (release) | median 0.6 ms | inside "quality/model 20–250 ms" | Negligible share of the analysis path |
| Memory, sign-in screen | 1 | TOTAL PSS 86.9 MB (RSS 206 MB) | ≤ 250 MB peak | Inside budget |
| Warm analysis, durable save, reconnect | 0 | not measured | — | Blocked: needs a phone and the capture path (see runbook) |

Raw samples: `ml/reports/raw-cold-start.tsv`.

## What this does not show

- One session, not the three the plan asks for. Fewer than 200 samples per
  scenario.
- Real phone CPU, storage, thermal throttling and battery effects.
- The cold-start number is time to the **sign-in** screen (first launch has no
  session); a returning offline user would see the same screen.

## Next

Run the runbook on the real reference phone (ARM64, 4 GB, Android 10+) and one
second-vendor phone, three sessions each. If cold start stays over 3 s at p95
there, profile startup (JS bundle size is 1.5 MB; ONNX runtime is loaded lazily).
