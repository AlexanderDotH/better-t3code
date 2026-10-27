import { createContext, use, useMemo, type ReactNode } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { ScopedVariables } from "uniwind";
import Animated, { LinearTransition, ReduceMotion } from "react-native-reanimated";
import { useChatPresentationMotion } from "./ChatPresentationMotion";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { flattenThemeColor, themeColorWithAlpha } from "../../lib/mobileTheme";

export type ChatBubbleTone = "neutral" | "info" | "success" | "warning" | "error";
export const ChatBubbleToneContext = createContext<ChatBubbleTone>("neutral");

export function useChatBubblePalette(tone?: ChatBubbleTone) {
  const inheritedTone = use(ChatBubbleToneContext);
  const { chatVisualMode, themeVariables: colors, chatPresentation } = useAppearancePreferences();
  const resolvedTone = tone ?? inheritedTone;
  return useMemo(() => {
    const base = flattenThemeColor(colors["--color-user-bubble"], colors["--color-screen"]);
    const foreground = colors["--color-user-bubble-foreground"];
    const accent =
      resolvedTone === "info"
        ? colors["--color-primary-text"]
        : resolvedTone === "success"
          ? colors["--color-update-foreground"]
          : resolvedTone === "warning"
            ? colors["--color-warning-foreground"]
            : resolvedTone === "error"
              ? colors["--color-danger-foreground"]
              : foreground;
    const mix = (amount: number, surface: string) =>
      flattenThemeColor(themeColorWithAlpha(accent, amount), surface);
    const surface = resolvedTone === "neutral" ? base : mix(0.11, base);
    return {
      better: chatVisualMode === "better-t3",
      motion: chatPresentation.presentationMotion,
      surface,
      foreground,
      accent,
      control: mix(0.1, surface),
      hover: mix(0.17, surface),
      field: mix(0.04, surface),
      border: mix(0.3, surface),
    };
  }, [chatVisualMode, chatPresentation.presentationMotion, colors, resolvedTone]);
}

export function ChatBubbleSurface({
  color,
  side = "assistant",
}: {
  color: ColorValue;
  side?: "user" | "assistant";
}) {
  const user = side === "user";
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: color,
          borderRadius: 25,
          borderTopLeftRadius: user ? 25 : 12,
          borderTopRightRadius: user ? 12 : 25,
        },
      ]}
    >
      <Svg
        width={24}
        height={22}
        viewBox="0 0 24 22"
        style={{
          position: "absolute",
          top: 0,
          ...(user ? { right: -10 } : { left: -10 }),
          transform: [{ scaleX: user ? -1 : 1 }],
        }}
      >
        <Path d="M24 0H2.6C.8 0 .2 1.8 1.5 3C6.8 7.8 10 13.8 10 22H24Z" fill={color} />
      </Svg>
    </View>
  );
}

const STATUS_SIZE_TRANSITION = LinearTransition.springify()
  .duration(280)
  .dampingRatio(0.9)
  .reduceMotion(ReduceMotion.System);

const compactPadding = 4;
const statusMargin = 8;
export const CHAT_STATUS_COMPACT_VERTICAL_SPACE = compactPadding * 2 + statusMargin;

export function ChatStatusBubble({
  children,
  tone = "neutral",
  compact = false,
}: {
  children: ReactNode;
  tone?: ChatBubbleTone;
  compact?: boolean;
}) {
  const palette = useChatBubblePalette(tone);
  const motion = useChatPresentationMotion();
  if (!palette.better) return children;
  return (
    <ChatBubbleToneContext value={tone}>
      <Animated.View
        layout={motion.enabled ? STATUS_SIZE_TRANSITION : undefined}
        style={{
          position: "relative",
          alignSelf: "flex-start",
          maxWidth: "100%",
          paddingHorizontal: compact ? 8 : 16,
          overflow: compact ? "hidden" : "visible",
          paddingVertical: compact ? compactPadding : 14,
          marginBottom: statusMargin,
          backgroundColor: palette.surface,
          borderRadius: 25,
        }}
      >
        <ScopedVariables
          variables={{
            "--color-foreground": palette.foreground,
            "--color-foreground-muted": palette.foreground,
            "--color-foreground-secondary": palette.foreground,
          }}
        >
          {children}
        </ScopedVariables>
      </Animated.View>
    </ChatBubbleToneContext>
  );
}
