import {
  hasMessageReplyHorizontalIntent,
  isMessageReplySwipeDirection,
  MESSAGE_REPLY_SELECTION_DELAY_MS,
  shouldTriggerMessageReply,
} from "@t3tools/client-runtime/messageReplies";
import type { OrchestrationMessage } from "@t3tools/contracts";

export const MESSAGE_REPLY_MAX_TRANSLATION = 72;
const MESSAGE_REPLY_INTENT_DISTANCE = 12;
const MESSAGE_REPLY_VERTICAL_TOLERANCE = 12;

export function classifyMessageReplyMovement(input: {
  readonly role: OrchestrationMessage["role"];
  readonly translationX: number;
  readonly translationY: number;
  readonly elapsedMs: number;
  readonly touchCount: number;
}): "wait" | "activate" | "fail" {
  "worklet";
  if (
    input.touchCount !== 1 ||
    input.elapsedMs >= MESSAGE_REPLY_SELECTION_DELAY_MS ||
    (Math.abs(input.translationY) >= MESSAGE_REPLY_VERTICAL_TOLERANCE &&
      !hasMessageReplyHorizontalIntent(input.translationX, input.translationY))
  )
    return "fail";
  if (Math.abs(input.translationX) < MESSAGE_REPLY_INTENT_DISTANCE) return "wait";
  return isMessageReplySwipeDirection(input.translationX, input.role) &&
    hasMessageReplyHorizontalIntent(input.translationX, input.translationY)
    ? "activate"
    : "fail";
}

export function messageReplyTranslation(translationX: number, role: OrchestrationMessage["role"]) {
  "worklet";
  if (!isMessageReplySwipeDirection(translationX, role)) return 0;
  return Math.max(
    -MESSAGE_REPLY_MAX_TRANSLATION,
    Math.min(MESSAGE_REPLY_MAX_TRANSLATION, translationX),
  );
}

export function acceptsMessageReplyGesture(
  translationX: number,
  translationY: number,
  completed: boolean,
  role: OrchestrationMessage["role"],
) {
  "worklet";
  return completed && shouldTriggerMessageReply(translationX, translationY, role);
}
