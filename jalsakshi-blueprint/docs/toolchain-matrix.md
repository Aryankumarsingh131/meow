# Native toolchain proof (T03, partial)

| Item | Observed |
|---|---|
| Computer | ASUS TUF Gaming A15 FA506IU; Windows 11 Home; Ryzen 7 4800H; 16 GB RAM; GTX 1660 Ti |
| Runtime | Node 24.13.0; npm 11.6.2; system Java 25.0.1; Gradle build on auto-provisioned Temurin JDK 17; Python 3.11.9 through `py`/`uv` |
| Android SDK | `D:\Android\Sdk`; command-line tools 22/23, platform-tools 37.0.1, platform 36, build-tools 35.0.0/36.0.0, NDK 27.1.12297006, CMake 3.22.1; standard licenses accepted |
| Android build | minSdk 26 (Android 8), compile/target SDK 36; `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| Mobile packages | Expo 57.0.24, React Native 0.86.3, ONNX Runtime React Native 1.24.3, Expo Camera/SQLite/FileSystem/Crypto/Device; exact transitive versions in `apps/mobile/package-lock.json` |
| Model | Bundled `apps/mobile/assets/identity.onnx`, SHA-256 `ccfbfaca271d0339c7ee711b426688c54f380c952660ac63d24f0256b308b38f` |
| Release APK | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`; 238,225,035 bytes; SHA-256 `a277bd8547e0d2e3aa7d21a4960bb6b84dcf723190c70d57c40c00c5add58de1` |
| Signature | APK Signature Scheme v2 verifies; development/debug certificate only, not a store or production signing identity |
| Phones | `adb devices -l` returned no attached devices after the build; Redmi/Xiaomi and OnePlus model, Android version, RAM and available storage remain unrecorded until physical testing begins |

`npx expo prebuild --platform android --no-install`, `npx tsc --noEmit`, `npm run test:demo`, and `npx expo-doctor` passed (21/21 checks). With `ANDROID_HOME=D:\Android\Sdk`, Temurin JDK 17 and `NODE_ENV=production`, `android\gradlew.bat -p android assembleRelease --no-daemon` passed 318 tasks in 13m30s on the first build and 4m5s on the final reviewed rebuild on 22 September 2026. `aapt` confirmed minSdk 26 and targetSdk 36; `apksigner` confirmed the v2 signature. The generated `android/` directory and APK are ignored; recreate them with prebuild and Gradle.

ONNX Runtime React Native 1.24.3 does not build unchanged under this Gradle 9 toolchain. `apps/mobile/scripts/patch-onnxruntime.mjs` applies two version-pinned upstream-compatible fixes after install: it removes the retired Gradle `VersionNumber` use and the obsolete Expo `unimodule.json` marker. Remove the patch when an ONNX package release contains both fixes.

Model generation: `uv run --no-project --python 3.11 --with onnx==1.23.0 python make_probe_model.py` reproduces the model hash above. The desktop ONNX check produced `[[1. 2.]]`; that checks the file, not the Android native bridge.

`npm audit` reports 10 moderate findings through Expo's build-tool dependency path; the suggested force fix is breaking. Reassess with a compatible upstream fix before distribution; do not force the downgrade.

Next: attach each phone, record the exact model, Android version, total RAM and available storage shown in the app, install this release APK, and run controlled-image capture, camera capture, force-stop/restart, airplane/reconnect sync and supervisor-decision checks. A successful APK build is not a physical-device result. [Expo local-build guidance](https://docs.expo.dev/guides/local-app-overview/) and [ONNX Runtime React Native guidance](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html) informed the setup.
