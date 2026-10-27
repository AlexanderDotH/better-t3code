import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";
import { useViewabilityAmount } from "@legendapp/list/react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  CHAT_THINKING_CYCLE_MS,
  CHAT_THINKING_PHRASE_CYCLES,
  CHAT_THINKING_PHRASE_KEYS,
  CHAT_THINKING_WAVE_TRAVEL,
} from "@t3tools/client-runtime/chat-presentation";
import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useChatPresentationMotion } from "./ChatPresentationMotion";
import { useChatBubblePalette } from "./ChatBubble";

const labelStyle = StyleSheet.create({
  character: {
    fontSize: 12,
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  glow: { textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } },
});

const glyphStyle = StyleSheet.create({
  container: { width: 26, height: 26 },
  lobe: { position: "absolute", left: 8, top: 8, width: 10, height: 10, borderRadius: 5 },
});

function ThinkingCharacter({
  character,
  delay,
  phase,
  color,
  animated,
}: {
  character: string;
  delay: number;
  phase: SharedValue<number>;
  color: ColorValue;
  animated: boolean;
}) {
  const glow = useAnimatedStyle(() => ({
    opacity: interpolate(
      phase.get(),
      [delay, delay + 0.09, delay + 0.24],
      [0, 0.85, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <View className="shrink-0">
      <Text style={[labelStyle.character, { color, opacity: 0.68 }]}>{character}</Text>
      {animated ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glow]}>
          <Text style={[labelStyle.character, labelStyle.glow, { color, textShadowColor: color }]}>
            {character}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function ThinkingLobe({
  phase,
  color,
  horizontal,
  direction,
  offset,
}: {
  phase: SharedValue<number>;
  color: ColorValue;
  horizontal: boolean;
  direction: number;
  offset: number;
}) {
  const style = useAnimatedStyle(() => {
    const wave = Math.sin((phase.get() + offset) * Math.PI * 2);
    const distance = direction * (3.5 + wave * 1.5);
    return {
      transform: [
        { translateX: horizontal ? distance : 0 },
        { translateY: horizontal ? 0 : distance },
        { scaleX: 1 + wave * 0.15 },
        { scaleY: 1 - wave * 0.15 },
      ],
    };
  });
  return <Animated.View style={[glyphStyle.lobe, { backgroundColor: color }, style]} />;
}

export function ThreadThinkingIndicator({ color }: { color: ColorValue }) {
  const motion = useChatPresentationMotion();
  const palette = useChatBubblePalette();
  const translate = useMobileInterfaceTranslator().message;
  const [visible, setVisible] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const phase = useSharedValue(0);
  const characters = Array.from(translate(CHAT_THINKING_PHRASE_KEYS[phrase]!).normalize("NFC"));
  useViewabilityAmount(useCallback((token) => setVisible(token.sizeVisible > 0), []));
  useEffect(() => {
    cancelAnimation(phase);
    if (!motion.enabled || !visible) return;
    phase.set(
      withRepeat(
        withTiming(1, {
          duration: CHAT_THINKING_CYCLE_MS,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.System,
        }),
        -1,
      ),
    );
    const timer = setInterval(
      () => setPhrase((index) => (index + 1) % CHAT_THINKING_PHRASE_KEYS.length),
      CHAT_THINKING_CYCLE_MS * CHAT_THINKING_PHRASE_CYCLES,
    );
    return () => {
      clearInterval(timer);
      cancelAnimation(phase);
      phase.set(0);
    };
  }, [phase, motion.enabled, visible]);
  return (
    <View
      accessible
      accessibilityLabel={translate("chat.timeline.thinking")}
      className="min-w-0 flex-row items-center gap-2.5"
    >
      <View className="shrink-0" style={glyphStyle.container} accessible={false}>
        <View style={[glyphStyle.lobe, { backgroundColor: color }]} />
        <ThinkingLobe phase={phase} color={color} horizontal={false} direction={-1} offset={0} />
        <ThinkingLobe phase={phase} color={color} horizontal direction={1} offset={0.25} />
        <ThinkingLobe phase={phase} color={color} horizontal={false} direction={1} offset={0.5} />
        <ThinkingLobe phase={phase} color={color} horizontal direction={-1} offset={0.75} />
      </View>
      <View
        className="min-w-0 shrink flex-row items-center overflow-hidden"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {characters.map((character, index) => (
          <ThinkingCharacter
            key={index}
            character={character}
            delay={(index / Math.max(1, characters.length - 1)) * CHAT_THINKING_WAVE_TRAVEL}
            phase={phase}
            color={palette.foreground}
            animated={motion.enabled && visible}
          />
        ))}
      </View>
    </View>
  );
}
