import type { OrchestrationMessage } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  acceptsMessageReplyGesture,
  classifyMessageReplyMovement,
  messageReplyTranslation,
} from "./message-reply-gesture";

type MessageReplyGestureProps = {
  readonly message: OrchestrationMessage;
  readonly enabled: boolean;
  readonly onReply: (message: OrchestrationMessage) => void;
  readonly children: ReactNode;
};

const ReplyGesture = memo(function ReplyGesture(props: MessageReplyGestureProps) {
  const translation = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const startedAt = useSharedValue(0);
  const activated = useSharedValue(false);
  const role = props.message.role;
  const reply = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    props.onReply(props.message);
  }, [props.message, props.onReply]);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .maxPointers(1)
        .onTouchesDown((event, manager) => {
          const touch = event.allTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            manager.fail();
            return;
          }
          originX.value = touch.absoluteX;
          originY.value = touch.absoluteY;
          startedAt.value = Date.now();
          activated.value = false;
        })
        .onTouchesMove((event, manager) => {
          if (activated.value) return;
          const touch = event.allTouches[0];
          if (!touch) {
            manager.fail();
            return;
          }
          const intent = classifyMessageReplyMovement({
            role,
            translationX: touch.absoluteX - originX.value,
            translationY: touch.absoluteY - originY.value,
            elapsedMs: Date.now() - startedAt.value,
            touchCount: event.numberOfTouches,
          });
          if (intent === "activate") manager.activate();
          else if (intent === "fail") manager.fail();
        })
        .onStart(() => {
          activated.value = true;
        })
        .onUpdate((event) => {
          translation.value = messageReplyTranslation(event.translationX, role);
        })
        .onEnd((event, completed) => {
          if (acceptsMessageReplyGesture(event.translationX, event.translationY, completed, role))
            runOnJS(reply)();
        })
        .onFinalize(() => {
          activated.value = false;
          translation.value = withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System });
        }),
    [activated, originX, originY, reply, role, startedAt, translation],
  );
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View collapsable={false} style={style}>
        {props.children}
      </Animated.View>
    </GestureDetector>
  );
});

export const MessageReplyGesture = memo(function MessageReplyGesture(
  props: MessageReplyGestureProps,
) {
  return props.enabled ? <ReplyGesture {...props} /> : <>{props.children}</>;
});
