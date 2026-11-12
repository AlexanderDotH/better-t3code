import type { ReactNode } from "react";
import { Platform, View } from "react-native";

export function ScreenContent({
  children,
  insetHorizontal = false,
  fitToContents = false,
  header,
}: {
  readonly children: ReactNode;
  readonly insetHorizontal?: boolean;
  readonly fitToContents?: boolean;
  readonly header?: ReactNode;
}) {
  if (Platform.OS !== "android")
    return (
      <>
        {header}
        {children}
      </>
    );

  return (
    // Material chooses the first nested-scrolling child; Compose header hosts must follow the content.
    <View
      className={fitToContents ? "shrink bg-header" : "flex-1 bg-header"}
      style={header ? { flexDirection: "column-reverse" } : undefined}
    >
      <View
        className="overflow-hidden rounded-t-[28px] bg-sheet-solid"
        style={{
          flexShrink: 1,
          flexGrow: fitToContents ? 0 : 1,
          flexBasis: fitToContents ? "auto" : 0,
          marginHorizontal: insetHorizontal ? 4 : 0,
        }}
      >
        {children}
      </View>
      {header}
    </View>
  );
}
