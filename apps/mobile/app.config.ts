import type { ExpoConfig } from "expo/config";

// D03 (docs/research/source-register.md): onnxruntime-react-native is a
// native module, so this project requires an Expo development build.
// It will NOT run inside Expo Go.
const config: ExpoConfig = {
  name: "mobile",
  slug: "mobile",
  version: "2.2.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "org.jalsakshi.mobile",
    versionCode: 4,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  // Plugin set integrated from the sibling `meow` repo. `expo-camera` is what
  // T07's QR scanning needs and `expo-crypto` is what T06's PKCE S256 needs
  // (Hermes has no crypto.subtle) - both were previously recorded as blocked
  // on this dependency change.
  plugins: [
    "onnxruntime-react-native",
    "expo-asset",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          // Development only: lets the emulator reach a local http API.
          // Must not survive into a production build.
          usesCleartextTraffic: true,
        },
      },
    ],
    "expo-sqlite",
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow JalSakshi to photograph the printed synthetic demo card.",
        recordAudioAndroid: false,
      },
    ],
  ],
};

export default config;
