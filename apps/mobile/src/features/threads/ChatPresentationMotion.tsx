import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useViewabilityAmount } from "@legendapp/list/react-native";
import type { ViewProps } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { chatMotionTiming, type createChatMotionAdmission } from "./chat-presentation-motion";

interface ChatPresentationMotionState {
  readonly betterT3: boolean;
  readonly enabled: boolean;
  readonly resetKey?: string;
  readonly claim: ReturnType<typeof createChatMotionAdmission>["claim"];
  readonly discardPending?: () => void;
}

export const ChatPresentationMotionContext = createContext<ChatPresentationMotionState>({
  betterT3: false,
  enabled: false,
  claim: () => null,
});

// Reanimated 4.5's spring duration is perceptual; actual settling takes 1.5 times as long.
const SPRING_ACTUAL_DURATION_MULTIPLIER = 1.5;

export function useChatPresentationMotion() {
  return useContext(ChatPresentationMotionContext);
}

/** Native shared values can be cancelled immediately when motion becomes unavailable. */
export function ChatPresentationMotion(
  props: ViewProps & {
    readonly motionId?: string;
    readonly children?: ReactNode;
  },
) {
  const { motionId, children, ...viewProps } = props;
  const motion = useChatPresentationMotion();
  const claim = motion.claim;
  const [visible, setVisible] = useState<boolean | null>(null);
  useViewabilityAmount(useCallback((token) => setVisible(token.sizeVisible > 0), []));
  const opacity = useSharedValue(1);
  const offset = useSharedValue(0);
  const previousLifecycle = useRef<{
    enabled: boolean;
    resetKey: string | undefined;
    visible: boolean | null;
  } | null>(null);
  useLayoutEffect(() => {
    const previous = previousLifecycle.current;
    if (
      previous?.enabled === motion.enabled &&
      previous.resetKey === motion.resetKey &&
      previous.visible === visible
    )
      return;
    previousLifecycle.current = { enabled: motion.enabled, resetKey: motion.resetKey, visible };
    cancelAnimation(opacity);
    cancelAnimation(offset);
    opacity.set(1);
    offset.set(0);
  }, [motion.enabled, motion.resetKey, offset, opacity, visible]);
  useLayoutEffect(
    () => () => {
      cancelAnimation(opacity);
      cancelAnimation(offset);
    },
    [offset, opacity],
  );
  useLayoutEffect(() => {
    if (!motion.enabled || visible === null) return;
    const admission = motionId ? claim(motionId, Date.now()) : null;
    if (!admission || !visible) return;
    cancelAnimation(opacity);
    cancelAnimation(offset);
    const timing = chatMotionTiming(admission.kind);
    const delay = admission.delay;
    const config = {
      duration: timing.duration,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    };
    opacity.set(0);
    offset.set(timing.translateY);
    opacity.set(withDelay(delay, withTiming(1, config)));
    if (timing.translateY > 0) {
      offset.set(
        withDelay(
          delay,
          withSpring(0, {
            duration: timing.duration / SPRING_ACTUAL_DURATION_MULTIPLIER,
            dampingRatio: 1,
            overshootClamping: true,
            reduceMotion: ReduceMotion.System,
          }),
        ),
      );
    }
  }, [claim, motion.enabled, motionId, offset, opacity, visible]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: offset.get() }],
  }));
  return (
    <Animated.View {...viewProps} style={[viewProps.style, style]}>
      {children}
    </Animated.View>
  );
}
