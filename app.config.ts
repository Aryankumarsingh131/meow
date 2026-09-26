import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "JalSakshi",
  slug: "mobile",
  version: "3.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  extra: {
    eas: {
      projectId: "1a8df564-a958-4787-800d-13d2b43e3c2b",
    },
  },
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "org.jalsakshi.mobile",
    versionCode: 5,
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
  plugins: [
    "onnxruntime-react-native",
    "expo-asset",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          usesCleartextTraffic: true,
        },
      },
    ],
    "expo-sqlite",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Allow JalSakshi to record where a new water source is.",
      },
    ],
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
