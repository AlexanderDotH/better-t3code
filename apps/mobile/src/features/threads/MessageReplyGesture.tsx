import type { createMessageReplyReference } from "@t3tools/client-runtime/messageReplies";
type MessageReplySource = Parameters<typeof createMessageReplyReference>[0] & {
  readonly role: "user" | "assistant";
};
import * as Haptics from "expo-haptics";
import { memo, type ReactNode } from "react";
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
  readonly message: MessageReplySource;
  readonly enabled: boolean;
  readonly onReply: (message: MessageReplySource) => void;
  readonly children: ReactNode;
};

const ReplyGesture = memo(function ReplyGesture(props: MessageReplyGestureProps) {
  const translation = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const startedAt = useSharedValue(0);
  const activated = useSharedValue(false);
  const role = props.message.role;
  const reply = () => {
    void Haptics.selectionAsync().catch(() => undefined);
    props.onReply(props.message);
  };
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan creates a native gesture handler.
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) {
        manager.fail();
        return;
      }
      originX.set(touch.absoluteX);
      originY.set(touch.absoluteY);
      // oxlint-disable-next-line react/purity -- Touch handlers sample their event time on the UI thread.
      startedAt.set(Date.now());
      activated.set(false);
    })
    .onTouchesMove((event, manager) => {
      if (activated.get()) return;
      const touch = event.allTouches[0];
      if (!touch) {
        manager.fail();
        return;
      }
      const intent = classifyMessageReplyMovement({
        role,
        translationX: touch.absoluteX - originX.get(),
        translationY: touch.absoluteY - originY.get(),
        // oxlint-disable-next-line react/purity -- This native touch callback runs after render.
        elapsedMs: Date.now() - startedAt.get(),
        touchCount: event.numberOfTouches,
      });
      if (intent === "activate") manager.activate();
      else if (intent === "fail") manager.fail();
    })
    .onStart(() => {
      activated.set(true);
    })
    .onUpdate((event) => {
      translation.set(messageReplyTranslation(event.translationX, role));
    })
    .onEnd((event, completed) => {
      if (acceptsMessageReplyGesture(event.translationX, event.translationY, completed, role))
        runOnJS(reply)();
    })
    .onFinalize(() => {
      activated.set(false);
      translation.set(withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System }));
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translation.get() }] }));
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
