import type {
  OrchestrationThread,
  ProviderDriverKind,
  ThreadReplyStartRequestedPayload,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";

import type { MessageReplySummary } from "./MessageReplyState.ts";

export function makeMessageReplySummary(options: {
  readonly thread: Pick<OrchestrationThread, "modelSelection" | "runtimeMode" | "interactionMode">;
  readonly workspacePath: string;
  readonly input: ThreadReplyStartRequestedPayload;
  readonly providerDriver: ProviderDriverKind | null;
}): MessageReplySummary {
  const { thread, workspacePath, input, providerDriver } = options;
  const selection = thread.modelSelection;
  return {
    id: input.replyTopicId,
    origin: "t3-managed",
    messageReply: {
      rootMessageId: input.replyTo.messageId,
      replyTo: input.replyTo,
      modelSelection: selection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      workspacePath,
    },
    providerInstanceId: selection.instanceId,
    providerDriver,
    providerThreadId: `reply:${input.replyTopicId}`,
    parentId: null,
    path: `reply/${input.replyTopicId}`,
    name: "Reply",
    nickname: null,
    role: "Reply",
    task: input.message.text.trim().slice(0, 200) || "Reply to message",
    model: selection.model,
    reasoningEffort:
      getModelSelectionStringOptionValue(selection, "reasoningEffort") ??
      getModelSelectionStringOptionValue(selection, "effort") ??
      null,
    depth: 1,
    status: "starting",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: input.createdAt,
    updatedAt: input.createdAt,
    completedAt: null,
  };
}
