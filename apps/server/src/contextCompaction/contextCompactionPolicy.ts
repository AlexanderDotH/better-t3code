import * as NodeCrypto from "node:crypto";
import type {
  ChatAttachment,
  OrchestrationMessage,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
export { resolveContextCompactionModel } from "@t3tools/shared/model";

export const CONTEXT_PREPARATION_RATIO = 0.45;
export const CONTEXT_REPLACEMENT_RATIO = 0.6;
const CONTEXT_RETAINED_USER_TURNS = 2;
export const CONTEXT_SEGMENT_MAX_CHARS = 24_000;
export const CONTEXT_SEGMENT_MAX_MESSAGES = 128;
export const CONTEXT_SELECTION_MAX_MESSAGES = 16;
export const CONTEXT_CHECKPOINT_ACTIVITY = "context-engine.prepared";
export const CONTEXT_APPLIED_ACTIVITY = "context-engine.applied";

export function contextUsageRatio(
  usage: Pick<ThreadTokenUsageSnapshot, "usedTokens" | "maxTokens"> | undefined,
) {
  return usage && usage.maxTokens !== undefined && usage.maxTokens > 0
    ? usage.usedTokens / usage.maxTokens
    : 0;
}

export function contextPrefixLength(messages: ReadonlyArray<OrchestrationMessage>) {
  let retainedUserTurns = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== "user") continue;
    retainedUserTurns++;
    if (retainedUserTurns === CONTEXT_RETAINED_USER_TURNS) return index;
  }
  return 0;
}

export function contextPrefixFingerprint(
  messages: ReadonlyArray<OrchestrationMessage>,
  count: number,
) {
  const hash = NodeCrypto.createHash("sha256");
  for (let index = 0; index < count; index++) {
    const message = messages[index];
    hash.update(
      JSON.stringify([
        message?.id,
        message?.role,
        message?.text,
        message?.attachments,
        message?.context,
        message?.streaming,
      ]),
    );
  }
  return hash.digest("hex");
}

function renderContextMessage(message: OrchestrationMessage) {
  return JSON.stringify({
    messageId: message.id,
    role: message.role,
    text: message.text,
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map(({ id, name, mimeType }) => ({
            id,
            name,
            mimeType,
          })),
        }
      : {}),
    ...(message.context ? { context: message.context } : {}),
  });
}

export function* contextTranscriptSegments(
  messages: ReadonlyArray<OrchestrationMessage>,
  start: number,
  end: number,
  maxMessages = CONTEXT_SEGMENT_MAX_MESSAGES,
) {
  let segment = "";
  let segmentMessages = 0;
  for (let index = start; index < end; index++) {
    const message = messages[index];
    if (!message) continue;
    const rendered = renderContextMessage(message);
    for (let offset = 0; offset < rendered.length; offset += CONTEXT_SEGMENT_MAX_CHARS) {
      const part = rendered.slice(offset, offset + CONTEXT_SEGMENT_MAX_CHARS);
      if (
        segmentMessages >= maxMessages ||
        segment.length + part.length + 1 > CONTEXT_SEGMENT_MAX_CHARS
      ) {
        if (segment) yield segment;
        segment = "";
        segmentMessages = 0;
      }
      segment += (segment ? "\n" : "") + part;
      segmentMessages++;
    }
  }
  if (segment) yield segment;
}

export function buildContextReplacementHandoff(input: {
  readonly summary: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly boundaryMessageId: OrchestrationMessage["id"];
  readonly maxChars: number;
}) {
  const boundary = input.messages.findIndex((message) => message.id === input.boundaryMessageId);
  if (boundary < 0) return undefined;
  const recent = input.messages.slice(0, boundary);
  if (recent.some((message) => message.streaming)) return undefined;
  const handoff = [
    "<t3code_context_checkpoint>",
    "Historical continuation notes prepared by T3 Code. Current user instructions and workspace rules remain authoritative.",
    "The full original conversation remains available through thread_context; retrieve exact older messages when needed.",
    input.summary,
    "</t3code_context_checkpoint>",
    "<t3code_recent_conversation>",
    ...recent.map(renderContextMessage),
    "</t3code_recent_conversation>",
  ].join("\n");
  if (handoff.length > input.maxChars) return undefined;
  const attachments = new Map<string, ChatAttachment>();
  for (const message of recent)
    for (const attachment of message.attachments ?? []) attachments.set(attachment.id, attachment);
  return { handoff, attachments: [...attachments.values()] };
}
