import {
  EnvironmentId,
  ProviderInstanceId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import type { McpInvocationScope, McpMessageReplyContext } from "../McpInvocationContext.ts";

export const replyTopicId = SubagentId.make("mcp-reply-topic");
export const replyTurnId = TurnId.make("mcp-reply-turn");
const replyProviderInstanceId = ProviderInstanceId.make("codex");
const replyOwnerThreadId = ThreadId.make("reply:topic:runtime");
const replyContext: McpMessageReplyContext = {
  replyTopicId,
  runtimeSessionId: RuntimeSessionId.make("reply-runtime"),
  runtimeMode: "full-access",
  interactionMode: "default",
  workspacePath: "/workspace/original",
};

export function makeReplyInvocation(parentThreadId: ThreadId): McpInvocationScope {
  return {
    environmentId: EnvironmentId.make("environment"),
    workspaceContextThreadId: parentThreadId,
    requestNamespace: "mcp-reply-session",
    client: undefined,
    thread: {
      threadId: replyOwnerThreadId,
      providerInstanceId: replyProviderInstanceId,
      providerSessionId: "mcp-reply-session",
    },
    ownerThreadId: replyOwnerThreadId,
    capabilities: new Set(["workspace", "workspace-write", "coordination"]),
    messageReply: replyContext,
    issuedAt: 1,
  };
}
