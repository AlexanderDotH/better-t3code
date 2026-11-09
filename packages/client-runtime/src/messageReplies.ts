import type {
  MessageId,
  MessageReplyReference,
  OrchestrationV2MessageReply,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";

type MessageReplyRole = "user" | "assistant" | "system" | "reasoning";

export const MESSAGE_REPLY_SWIPE_THRESHOLD = 16;
export const MESSAGE_REPLY_SELECTION_DELAY_MS = 250;
const MESSAGE_REPLY_INTENT_THRESHOLD = 8;
const MESSAGE_REPLY_HORIZONTAL_RATIO = 1.25;
const MESSAGE_REPLY_PREVIEW_LENGTH = 120;
const MESSAGE_REPLY_DECISION_DISTANCE = 12;
const TEXT_REPLY_INTENT_DISTANCE = MESSAGE_REPLY_SWIPE_THRESHOLD;
const TEXT_REPLY_MIN_SPEED = 0.3;
const TEXT_REPLY_MIN_SAMPLE_MS = 40;
const TEXT_REPLY_VERTICAL_TOLERANCE = 8;
const TEXT_REPLY_VERTICAL_RATIO = 0.25;
const TEXT_REPLY_MIN_STRAIGHTNESS = 0.85;

type MessageReplyPreviewSource = {
  readonly text: string;
  readonly attachments?: ReadonlyArray<{ readonly name: string }> | undefined;
};

type MessageReplySource = MessageReplyPreviewSource & {
  readonly id: MessageId;
  readonly replyTopicId?: SubagentId | undefined;
  readonly role: MessageReplyRole;
};

export function hasMessageReplyHorizontalIntent(deltaX: number, deltaY: number): boolean {
  "worklet";
  return (
    Number.isFinite(deltaX) &&
    Number.isFinite(deltaY) &&
    Math.abs(deltaX) >= MESSAGE_REPLY_INTENT_THRESHOLD &&
    Math.abs(deltaX) > Math.abs(deltaY) * MESSAGE_REPLY_HORIZONTAL_RATIO
  );
}

export function isMessageReplySwipeDirection(deltaX: number, role: MessageReplyRole): boolean {
  "worklet";
  return (role === "user" && deltaX < 0) || (role === "assistant" && deltaX > 0);
}

/**
 * Fine pointers over selectable text need a quick, straight stroke before
 * taking ownership from native selection. Ambiguous motion remains native.
 */
export function classifyMessageReplyPointerIntent(input: {
  readonly role: MessageReplyRole;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly elapsedMs: number;
  readonly pathLength: number;
  readonly canSelectText: boolean;
  readonly selectionActive: boolean;
}): "wait" | "reply" | "cancel" {
  const { deltaX, deltaY, elapsedMs, pathLength } = input;
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(pathLength) ||
    elapsedMs < 0 ||
    elapsedMs >= MESSAGE_REPLY_SELECTION_DELAY_MS
  )
    return "cancel";
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < MESSAGE_REPLY_DECISION_DISTANCE) return "wait";
  if (!isMessageReplySwipeDirection(deltaX, input.role)) return "cancel";
  if (!hasMessageReplyHorizontalIntent(deltaX, deltaY))
    return Math.abs(deltaY) >= Math.abs(deltaX) ? "cancel" : "wait";
  if (!input.canSelectText) return input.selectionActive ? "cancel" : "reply";

  const distance = Math.abs(deltaX);
  const speed = distance / Math.max(elapsedMs, 1);
  if (
    Math.abs(deltaY) >
      Math.max(TEXT_REPLY_VERTICAL_TOLERANCE, distance * TEXT_REPLY_VERTICAL_RATIO) ||
    distance / Math.max(pathLength, distance) < TEXT_REPLY_MIN_STRAIGHTNESS ||
    (elapsedMs >= TEXT_REPLY_MIN_SAMPLE_MS && speed < TEXT_REPLY_MIN_SPEED)
  )
    return "cancel";
  if (distance < TEXT_REPLY_INTENT_DISTANCE) return "wait";
  return speed >= TEXT_REPLY_MIN_SPEED ? "reply" : "cancel";
}

export function shouldTriggerMessageReply(
  deltaX: number,
  deltaY: number,
  role: MessageReplyRole,
): boolean {
  "worklet";
  return (
    isMessageReplySwipeDirection(deltaX, role) &&
    Math.abs(deltaX) >= MESSAGE_REPLY_SWIPE_THRESHOLD &&
    hasMessageReplyHorizontalIntent(deltaX, deltaY)
  );
}

function attachmentNames(message: MessageReplyPreviewSource): string {
  return (
    message.attachments
      ?.map(({ name }) => name.trim())
      .filter(Boolean)
      .join(", ") ?? ""
  );
}

export function createMessageReplyReference(
  message: MessageReplySource,
  authorLabel?: string,
): MessageReplyReference | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }
  const label = authorLabel?.trim();
  return Object.freeze({
    messageId: message.id,
    ...(message.replyTopicId === undefined ? {} : { replyTopicId: message.replyTopicId }),
    role: message.role,
    text: message.text.trim() ? message.text : attachmentNames(message),
    ...(label ? { authorLabel: label } : {}),
  });
}

function markdownPreviewText(text: string): string {
  return text
    .replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:[^\n]*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~/g, "$1$2$3")
    .replace(/(^|\W)[*_]([^\s*_](?:[^*_]*?[^\s*_])?)[*_](?=\W|$)/g, "$1$2")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+.!>~-])/g, "$1")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => {
      switch (entity) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return " ";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function getMessageReplyPreview(
  message: MessageReplyPreviewSource,
  options: { readonly maxLength?: number; readonly attachmentLabel?: string } = {},
): string {
  const text =
    markdownPreviewText(message.text) ||
    attachmentNames(message) ||
    options.attachmentLabel ||
    "Attachment";
  const maxLength =
    options.maxLength === undefined || !Number.isFinite(options.maxLength)
      ? MESSAGE_REPLY_PREVIEW_LENGTH
      : Math.max(0, Math.floor(options.maxLength));
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  if (maxLength === 0) return "";
  return (
    characters
      .slice(0, maxLength - 1)
      .join("")
      .trimEnd() + "…"
  );
}

type MessageReplyTopic = Pick<OrchestrationV2MessageReply, "replyTopicId" | "sourceThreadId">;

/** Replying inside a topic, or to one of its messages, continues that topic. */
export function resolveMessageReplyTarget(input: {
  readonly reference: MessageReplyReference;
  readonly currentReply: MessageReplyTopic | null | undefined;
  readonly createTopicId: () => SubagentId;
}): { readonly replyTo: MessageReplyReference; readonly replyTopicId: SubagentId } {
  const existingTopicId = input.reference.replyTopicId ?? input.currentReply?.replyTopicId;
  return existingTopicId === undefined
    ? { replyTo: input.reference, replyTopicId: input.createTopicId() }
    : {
        replyTo: { ...input.reference, replyTopicId: existingTopicId },
        replyTopicId: existingTopicId,
      };
}

export type MessageReplyDispatch =
  | { readonly kind: "start"; readonly sourceThreadId: ThreadId }
  | { readonly kind: "continue"; readonly threadId: ThreadId }
  | { readonly kind: "unavailable" };

/** A topic continues on its existing reply thread; only a new topic starts one from the source. */
export function resolveMessageReplyDispatch(input: {
  readonly threadId: ThreadId;
  readonly currentReply: MessageReplyTopic | null | undefined;
  readonly replyTo: MessageReplyReference;
  readonly replyTopicId: SubagentId;
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly messageReply?: MessageReplyTopic | undefined;
  }>;
}): MessageReplyDispatch {
  const sourceThreadId = input.currentReply?.sourceThreadId ?? input.threadId;
  if (input.replyTo.replyTopicId !== input.replyTopicId) return { kind: "start", sourceThreadId };
  if (input.currentReply?.replyTopicId === input.replyTopicId)
    return { kind: "continue", threadId: input.threadId };
  const topicThread = input.threads.find(
    (thread) =>
      thread.messageReply?.replyTopicId === input.replyTopicId &&
      thread.messageReply.sourceThreadId === sourceThreadId,
  );
  return topicThread ? { kind: "continue", threadId: topicThread.id } : { kind: "unavailable" };
}
