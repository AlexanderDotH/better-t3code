import {
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";

import type { McpInvocationScope, McpMessageReplyContext } from "../McpInvocationContext.ts";

export const replyTopicId = SubagentId.make("mcp-reply-topic");
export const replyTurnId = TurnId.make("mcp-reply-turn");
export const replyProviderInstanceId = ProviderInstanceId.make("codex");
export const replyOwnerThreadId = ThreadId.make("reply:topic:runtime");
export const replyCreatedAt = "2026-10-13T10:00:00.000Z";
export const replyContext: McpMessageReplyContext = {
  replyTopicId,
  runtimeSessionId: RuntimeSessionId.make("reply-runtime"),
  runtimeMode: "full-access",
  interactionMode: "default",
  workspacePath: "/workspace/original",
};

export function makeReplyInvocation(parentThreadId: ThreadId): McpInvocationScope {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: parentThreadId,
    ownerThreadId: replyOwnerThreadId,
    providerSessionId: "mcp-reply-session",
    providerInstanceId: replyProviderInstanceId,
    capabilities: new Set(["workspace", "workspace-write", "coordination"]),
    messageReply: replyContext,
    issuedAt: 1,
  };
}

export function makeReplySummary(
  context: McpMessageReplyContext = replyContext,
): OrchestrationSubagentSummary {
  return {
    id: context.replyTopicId,
    origin: "t3-managed",
    providerInstanceId: replyProviderInstanceId,
    providerDriver: ProviderDriverKind.make("codex"),
    providerThreadId: "native-reply",
    parentId: null,
    path: null,
    name: "Reply topic",
    nickname: null,
    role: null,
    task: null,
    model: "gpt-6",
    reasoningEffort: "high",
    depth: 1,
    status: "running",
    statusMessage: null,
    latestProgress: null,
    latestTurn: {
      turnId: replyTurnId,
      state: "running",
      requestedAt: replyCreatedAt,
      startedAt: replyCreatedAt,
      completedAt: null,
      assistantMessageId: null,
    },
    startedAt: replyCreatedAt,
    updatedAt: replyCreatedAt,
    completedAt: null,
    messageReply: {
      rootMessageId: MessageId.make("quoted-message"),
      replyTo: { messageId: MessageId.make("quoted-message"), role: "assistant", text: "Quote" },
      modelSelection: { instanceId: replyProviderInstanceId, model: "gpt-6" },
      runtimeMode: context.runtimeMode,
      interactionMode: context.interactionMode,
      workspacePath: context.workspacePath,
    },
  };
}
