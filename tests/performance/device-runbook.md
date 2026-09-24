# Device critical-path benchmark — runbook (T29)

Follows `jalsakshi-blueprint/docs/engineering/performance-plan.md`. Record every
field below for every session; a number without its conditions is not evidence.

## Record first

- Commit (`git rev-parse --short HEAD`), APK file and SHA-256, versionName.
- Phone: model, Android version, RAM (`adb shell cat /proc/meminfo | head -1`),
  battery level and temperature (`adb shell dumpsys battery`), thermal status
  (`adb shell dumpsys thermalservice | grep "Thermal Status"`), free storage.
- Network: airplane / Wi-Fi / constrained, and how it was emulated.
- Model hash from `apps/mobile/assets/model-manifest.json`.

## Scenarios and commands

| Scenario | How | Samples |
|---|---|---|
| Cold APK start → usable home | `adb shell am start -W -S -n org.jalsakshi.mobile/.MainActivity`, read `TotalTime`; `sleep 3` between runs | 10 warm-ups discarded, then ≥ 20 genuine cold starts per session, 3 sessions |
| On-device model inference | Sign in → *Model check (research)*; the screen reports the median over 29 inferences | ≥ 7 openings per session (≥ 200 inferences) |
| Memory | `adb shell dumpsys meminfo org.jalsakshi.mobile`, TOTAL PSS, on home and after Model check | each session |
| Warm analysis, durable save | Capture → review → save, timed with `diagnostics.ts` marks (T33) | ≥ 200 per session |
| Reconnect acknowledgement | Queue records offline, reconnect, time until "Accepted" | ≥ 20 |

Keep raw samples: `ml/reports/raw-*.tsv`. Report min/p50/p95/max with n, never an
average of percentiles. At n = 20 the p95 is the 19th value; say so.

## Honest limits

- An emulator uses the host CPU and software graphics. Its numbers show
  regressions between builds; they are not phone performance.
- Warm analysis and durable-save timings need the capture flow, which on this
  protocol always ends in a manual reading (no card locator), so the full
  analysis path cannot yet be exercised end to end.
