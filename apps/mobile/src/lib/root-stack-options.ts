import type { ViewStyle } from "react-native";

export function rootHomeContentStyle(platform: "android" | "ios"): ViewStyle | undefined {
  return platform === "ios" ? { backgroundColor: "transparent" } : undefined;
}
