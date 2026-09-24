# Visual evidence — JalSakshi mobile screens

Initial captures recorded 2026-09-22; T11 captures added 2026-09-24. Two independent surfaces:

1. **Android emulator** (`emulator-*.png`) — the real native build running on a
   real Android 15 emulator. This is what T03/T07/T08 were previously blocked
   on.
2. **Expo web** (`t07-*.png`, `t08-*.png`) — `react-native-web` in Microsoft
   Edge, driven by `tools/screenshot.mjs`. Faster to iterate, and it exercises
   the same components, but it is **not** a device.

> **All fixture data in these screenshots is fictional.** No real kit,
> manufacturer, lot, expiry or read window has been selected — T01 is still a
> fictional template. Every screenshot carries an on-screen banner saying so.
> These images demonstrate that the UI logic behaves correctly; they are
> **not** domain validation of any physical kit.

## Toolchain installed to produce these

| Component | Version / location | Notes |
|---|---|---|
| Microsoft OpenJDK | 17.0.20.1 (`C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`) | Closes the "Java 17 gap" recorded in `docs/toolchain-matrix.md`; the pre-existing JRE was 1.8 |
| Android SDK | `C:\Android\sdk` | cmdline-tools, platform-tools, platform 35, build-tools 35.0.0 |
| System image | `system-images;android-35;google_apis;x86_64` | |
| AVD | `jalsakshi_pixel` (pixel_7 profile) | |
| Playwright | devDependency at repo root | Drives **system-installed Edge** via `channel: 'msedge'` — no browser binary downloaded |

Playwright is a **root** devDependency deliberately, so the mobile app's own
`package.json`/lockfile (T03, role B) stays untouched.

## Reproducing

```bash
# Android emulator
C:/Android/sdk/emulator/emulator.exe -avd jalsakshi_pixel -no-snapshot-load -gpu swiftshader_indirect
cd apps/mobile && npx expo run:android      # needs JAVA_HOME -> JDK 17, ANDROID_HOME -> C:\Android\sdk
C:/Android/sdk/platform-tools/adb.exe exec-out screencap -p > shot.png

# Expo web + screenshots
cd apps/mobile && npx expo start --web --port 8081
node tools/screenshot.mjs
```

## Android emulator captures

| File | What it demonstrates |
|---|---|
| `emulator-01-sources.png` | T07 S02 list; `No saved location` for sources without coordinates; amber staleness label "Last known record, 12 days old — may be out of date (offline copy)"; screening provenance kept separate (`Screening: review (assisted)`) |
| `emulator-02-expired-kit.png` | **AC-002.** Expired + unverified lot → "Automatic reading is not available", *both* reasons listed together, and the manual path explicitly preserved |
| `emulator-03-timer-waiting.png` | Read-window timer started, before the window opens |
| `emulator-04-timer-in-window.png` | Inside the window → "Read now", primary action becomes **Capture now** (assisted permitted) |
| `emulator-05-timer-expired.png` | Past `invalid_after` → "Too late to read this test", action reverts to **Record a manual reading** (assisted blocked, manual open) |

The 03→04→05 sequence was captured from a single live run against the
short-window fixture (`prepare 2s, read at 6s ±2s, invalid after 12s`), so the
state transitions are real elapsed-time behaviour, not staged renders.

## Expo web captures

| File | What it demonstrates |
|---|---|
| `t07-sources-list.png` | Source list + cached history staleness label |
| `t07-sources-search.png` | Search filters the cached catalogue |
| `t07-sources-no-match.png` | No-match is an empty state, not an error |
| `t08-protocol-steps.png` | Manufacturer / lot / expiry header, one instruction per step |
| `t08-protocol-timer-waiting.png` | `preparing` state on the 60 s fixture |
| `t08-timer-waiting-countdown.png` | Countdown before the window opens |
| `t08-timer-in-window.png` | Inside the read window |
| `t08-timer-expired.png` | Past `invalid_after` |
| `t08-protocol-blocked-expired.png` | Expired + unverified lot blocked |
| `t11-review-suggestion.png` | T11 S05 research-only suggestion, screening boundary and confirm/manual actions |
| `t11-review-manual-override.png` | T11 S05 accessible bin selection and required human-override reason |

## Two real defects these captures found

Neither was visible from tests alone — both required actually looking at the
rendered screen:

1. **Status-bar collision (fixed).** The demo banner and tab row rendered
   *underneath* the Android system status bar, overlapping the clock and
   making the tabs untappable. Fixed by applying
   `StatusBar.currentHeight` padding in `App.tsx`. Visible in the difference
   between `emulator-01` (before) and `emulator-02` (after).
2. **`onnxruntime-react-native` blocks the native build (NOT fixed — see
   below).**

## Open issue for role B: onnxruntime-react-native vs Gradle 9

`onnxruntime-react-native@1.24.3` calls `VersionNumber.parse()` in
`android/build.gradle` line 250. Gradle removed `VersionNumber` from its public
API in Gradle 9, and React Native 0.86 pins Gradle 9.3.1, so the Android build
fails at configuration time:

```
> Could not get unknown property 'VersionNumber' for object of type
  org.gradle.api.internal.artifacts.dsl.dependencies.DefaultDependencyHandler
```

The guarded branch only applies to React Native < 0.71, so it is dead code
here — but Gradle evaluates it eagerly regardless.

**To get a build at all, `node_modules/onnxruntime-react-native/android/build.gradle`
was patched locally** to replace that condition with `if (false)`. This patch:

- lives only in `node_modules`, which is gitignored — **it is not committed**;
- **will be silently lost on the next `npm install`**;
- was **not** captured with `patch-package`, because adding that is a
  dependency change to `apps/mobile/package.json`, which is **T03's declared
  file (role B)**.

`onnxruntime-react-native` is role B's dependency (added in T03). **Role B
needs to decide the real fix** — upgrade the package, pin Gradle 8, or adopt
`patch-package`. Until then the Android build is not reproducible from a clean
checkout.

## What these screenshots are not

- Not a device. An emulator is not a phone: no real camera, no real sensors,
  no real field conditions, and x86_64 rather than ARM.
- Not domain validation. Fictional fixtures throughout.
- Not the screen recording T07/T08 nominally ask for — these are stills. A
  recording of the timer sequence is still outstanding.
- The demo harness in `App.tsx` is temporary scaffolding, not the app's real
  root component or navigation.
