import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function PreviewReveal(props: {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly enabled?: boolean;
  readonly zoom?: boolean;
  readonly className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const animation = props.zoom ? ZoomIn : FadeInDown;
  return (
    <Animated.View
      entering={
        !reducedMotion && props.enabled !== false
          ? animation
              .duration(240)
              .delay(props.delay ?? 0)
              .reduceMotion(ReduceMotion.System)
          : undefined
      }
      className={props.className}
    >
      {props.children}
    </Animated.View>
  );
}

export function BetterT3PreviewFrame(props: {
  readonly animationKey: string;
  readonly label: string;
  readonly tall?: boolean;
  readonly toggle?: boolean;
  readonly children: (expanded: boolean) => ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const reducedMotion = useReducedMotion();
  const [replay, setReplay] = useState(0);
  const expanded = replay % 2 === 0;
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${props.label} · ${translator.message("mobile.prefs.replay")}`}
      accessibilityState={props.toggle ? { expanded } : undefined}
      onPress={() => setReplay((previous) => previous + 1)}
      className="gap-3 border-t border-border-subtle p-4 active:opacity-80"
    >
      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
        {translator.message("mobile.prefs.preview")} · {translator.message("mobile.prefs.replay")}
      </Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        className={
          props.tall
            ? "h-64 overflow-hidden rounded-xl bg-screen p-3"
            : "h-48 overflow-hidden rounded-xl bg-screen p-3"
        }
      >
        <Animated.View
          key={`${props.animationKey}:${replay}`}
          entering={
            !reducedMotion ? FadeIn.duration(160).reduceMotion(ReduceMotion.System) : undefined
          }
          className="flex-1 justify-center gap-3"
        >
          {props.children(expanded)}
        </Animated.View>
      </View>
    </Pressable>
  );
}
