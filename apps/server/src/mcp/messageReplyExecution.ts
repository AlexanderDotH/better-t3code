import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

export const resolveMessageReplyExecution = Effect.fn("mcp.resolveMessageReplyExecution")(
  function* (invocation: McpInvocationScope) {
    const context = invocation.messageReply;
    if (!context || !invocation.ownerThreadId || invocation.ownerThreadId === invocation.threadId) {
      return Option.none();
    }
    const provider = yield* ProviderService;
    const current = yield* provider.isAbortTargetCurrent({
      threadId: invocation.ownerThreadId,
      runtimeSessionId: context.runtimeSessionId,
      providerInstanceId: invocation.providerInstanceId,
      turnId: null,
    });
    if (!current) return Option.none();

    const projections = yield* ProjectionSnapshotQuery;
    const summary = yield* projections.getSubagentSummaryById(
      invocation.threadId,
      context.replyTopicId,
    );
    if (Option.isNone(summary)) return Option.none();
    const topic = summary.value;
    const inherited = topic.messageReply;
    if (
      !inherited ||
      (topic.status !== "starting" && topic.status !== "running" && topic.status !== "waiting") ||
      topic.latestTurn?.state !== "running" ||
      inherited.modelSelection.instanceId !== invocation.providerInstanceId ||
      inherited.runtimeMode !== context.runtimeMode ||
      inherited.interactionMode !== context.interactionMode ||
      inherited.workspacePath !== context.workspacePath
    ) {
      return Option.none();
    }
    return Option.some({
      ...context,
      turnId: topic.latestTurn.turnId,
      providerInstanceId: invocation.providerInstanceId,
    });
  },
);
