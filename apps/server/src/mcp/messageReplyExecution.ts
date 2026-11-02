import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { TurnId } from "@t3tools/contracts";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

export const resolveMessageReplyExecution = Effect.fn("mcp.resolveMessageReplyExecution")(
  function* (invocation: McpInvocationScope) {
    const context = invocation.messageReply;
    if (context === undefined || invocation.thread === undefined) return Option.none();
    const threads = yield* OrchestratorV2;
    const child = yield* threads.getThreadShell(invocation.thread.threadId);
    if (
      child === null ||
      child.activeRunId === null ||
      child.providerInstanceId !== invocation.thread.providerInstanceId ||
      child.lineage.relationshipToParent !== "subagent" ||
      child.lineage.parentThreadId !== invocation.workspaceContextThreadId ||
      child.runtimeMode !== context.runtimeMode ||
      child.interactionMode !== context.interactionMode
    )
      return Option.none();
    return Option.some({
      ...context,
      turnId: TurnId.make(child.activeRunId),
      providerInstanceId: invocation.thread.providerInstanceId,
    });
  },
);
