import type { ExpoConfig } from "expo/config";

// D03 (docs/research/source-register.md): onnxruntime-react-native is a
// native module, so this project requires an Expo development build.
// It will NOT run inside Expo Go.
const config: ExpoConfig = {
  name: "mobile",
  slug: "mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "org.jalsakshi.mobile",
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
};

export default config;
