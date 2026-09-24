import type { ExpoConfig } from "expo/config";

// Native modules require a built APK; this app does not run inside Expo Go.
const config: ExpoConfig = {
  name: "JalSakshi",
  slug: "jalsakshi-v1",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "org.jalsakshi.prototype",
    versionCode: 1,
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
          // The Version 1 APK uses local data and does not need HTTP access.
          usesCleartextTraffic: false,
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
