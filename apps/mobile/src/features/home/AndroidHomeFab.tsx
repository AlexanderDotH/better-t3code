import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { getAndroidHomeFabLayout } from "./homeContentInsets";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

/**
 * Android-only wrapper that overlays a bottom-right new-task FAB on a thread
 * list. Other platforms render children unchanged.
 */
export function AndroidHomeFabLayout(props: {
  readonly onStartNewTask: () => void;
  readonly children: ReactNode;
}) {
  if (Platform.OS !== "android") {
    return <>{props.children}</>;
  }

  return <AndroidHomeFab {...props} />;
}

function AndroidHomeFab(props: {
  readonly onStartNewTask: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const translator = useMobileInterfaceTranslator();
  const layout = getAndroidHomeFabLayout(insets.bottom);
  return (
    <View className="flex-1">
      {props.children}
      <Pressable
        accessibilityLabel={translator.message("mobile.navigation.newTask")}
        accessibilityHint={translator.message("mobile.navigation.newTaskHint")}
        accessibilityRole="button"
        android_ripple={{
          color: "rgba(255, 255, 255, 0.22)",
          foreground: true,
          radius: layout.buttonSize / 2,
        }}
        onPress={props.onStartNewTask}
        className="absolute right-5 items-center justify-center overflow-hidden rounded-full bg-primary"
        style={({ pressed }) => ({
          bottom: layout.buttonBottom,
          elevation: pressed ? 4 : 8,
          height: layout.buttonSize,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          width: layout.buttonSize,
        })}
      >
        <SymbolView
          name="square.and.pencil"
          size={22}
          tintColorClassName={"accent-primary-foreground"}
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}
