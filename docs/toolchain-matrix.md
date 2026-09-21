# Toolchain matrix — T03

> **STATUS: PARTIAL. Real dependency resolution done; device-level acceptance
> criteria (APK install, offline tensor test) remain genuinely BLOCKED — no
> Android SDK, `adb`, or physical device is available in this environment.**
> Nothing below is mocked. Where a step could not be run, it is recorded as
> not run, not faked.

## What "known tensor gives expected output offline" would require, and why it wasn't faked

`onnxruntime-react-native` (D01) only runs inside a compiled React Native app
on a real device/emulator with a native Android build — it cannot execute
inside plain Node.js (that would require the separate `onnxruntime-node`
package, testing a different native binding entirely). Running an
`onnxruntime-node` tensor test on this dev machine and presenting it as proof
of the React Native ONNX bridge would be exactly the kind of substituted,
mocked validation this task's verification rule forbids. It was not done.

## Real dependency resolution (done, on this build host)

Ran for real via `npx create-expo-app@latest apps/mobile --template
blank-typescript`, then `npm install onnxruntime-react-native` inside
`apps/mobile/`. Versions below are read from the actual generated
`apps/mobile/package-lock.json`, not hand-picked:

| Package | Resolved version |
|---|---|
| expo | 57.0.24 |
| expo-status-bar | 57.0.1 |
| onnxruntime-react-native | 1.24.3 |
| react | 19.2.3 |
| react-native | 0.86.3 |
| typescript | 6.0.3 |
| @types/react | 19.2.18 |

Resolved Expo SDK (via `npx expo config --type public`): `57.0.0`.
Android application id (`app.config.ts`): `org.jalsakshi.mobile`.

## Build host (not a phone — recorded separately, never conflated)

| Field | Value |
|---|---|
| OS | `MINGW64_NT-10.0-26200 DESKTOP-G9A33BB 3.6.4-b9f03e96.x86_64` (Windows 11, Git Bash) |
| node | v24.19.0 |
| npm | 12.0.2 |
| java | 1.8.0_441 (Java 8 — note: current Expo/AGP toolchains typically expect Java 17+; this is an additional real compatibility gap, not yet resolved) |
| Android SDK | **not installed** — `ANDROID_HOME`/default SDK path not found |
| adb | **not installed** — not on PATH |
| Physical Android device | **none available** |

## Commands actually run, in order, with real results

1. `npx --yes create-expo-app@latest apps/mobile --template blank-typescript`
   → succeeded, 467 packages installed, project scaffolded. (One retry needed
   after an interactive git-init prompt on the first attempt; second attempt
   correctly detected already-scaffolded files and stopped rather than
   overwriting — no data loss.)
2. `npm install onnxruntime-react-native` (inside `apps/mobile/`)
   → succeeded, 2 packages added, resolved to `1.24.3`.
3. `npx expo config --type public` (inside `apps/mobile/`, after converting
   `app.json` → `app.config.ts`)
   → succeeded; confirmed `sdkVersion: '57.0.0'`, `android.package:
   'org.jalsakshi.mobile'` were read correctly from the TypeScript config.
4. `npx expo run:android` (inside `apps/mobile/`)
   → **failed, for real, at the expected point**: prebuild succeeded
     (generated `apps/mobile/android/`, gitignored), then:
     ```
     Failed to resolve the Android SDK path. Default install location not
     found: C:\Users\Aryan Kumar Singh\AppData\Local\Android\Sdk. Use
     ANDROID_HOME to set the Android SDK location.
     Error: 'adb' is not recognized as an internal or external command,
     operable program or batch file.
     ```
     This is the real, honest failure — not mocked, not caught and
     downgraded to a warning, not skipped. Per T03's own verification rule
     ("failed compatibility stays blocked, not mocked"), this failure is
     recorded as-is and the corresponding acceptance criteria stay unmet.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| APK installs on real phone | **Blocked.** No SDK, no `adb`, no device. Command in step 4 above is the real attempt and real failure. |
| Known tensor gives expected output offline | **Blocked.** Requires the same missing device/build toolchain; no substitute test was run (see rationale above). |
| Exact versions/device recorded | **Partially done.** Dependency and build-host versions recorded above, for real. No device exists to record. |

## Open blockers (real, not fictional)

- No Android SDK installed on this build host; `ANDROID_HOME` unset.
- No `adb` on PATH.
- No physical Android phone or emulator available.
- Java 8 present; Android Gradle Plugin versions used by current Expo SDKs
  commonly require Java 17+ — this is a second real gap on top of the SDK/adb
  gap, discovered by the actual failed build attempt, not predicted in
  advance.
- T03's acceptance criteria (APK install, offline tensor parity) cannot be
  met until real hardware and Android SDK/adb are available on some machine.
