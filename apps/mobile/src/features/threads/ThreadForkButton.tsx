import { forkBoundaryKey } from "@t3tools/client-runtime/thread-fork";
import type { ThreadForkBoundary } from "@t3tools/contracts";
import { Platform, Pressable } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import type { ThreadForkAction } from "./use-thread-fork-action";

export function ThreadForkButton(props: {
  readonly boundary: ThreadForkBoundary;
  readonly action: ThreadForkAction;
  readonly buttonSize: number;
  readonly iconSize: number;
}) {
  const translator = useMobileInterfaceTranslator();
  const busy = props.action.pendingBoundaryKey === forkBoundaryKey(props.boundary);
  return (
    <Pressable
      accessibilityLabel={translator.message("mobile.thread.forkHere")}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: props.action.disabled }}
      disabled={props.action.disabled}
      hitSlop={8}
      onPress={() => props.action.onFork(props.boundary)}
      className="h-7 w-7 items-center justify-center disabled:opacity-40"
      style={
        Platform.OS === "android"
          ? { width: props.buttonSize, height: props.buttonSize }
          : undefined
      }
    >
      {busy ? (
        <AppActivityIndicator size="small" />
      ) : (
        <SymbolView
          name="arrow.triangle.branch"
          size={props.iconSize}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      )}
    </Pressable>
  );
}
