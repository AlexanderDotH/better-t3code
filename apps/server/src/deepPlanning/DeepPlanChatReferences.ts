import {
  DeepPlanError,
  isDeepPlanRun,
  isListedThreadLineage,
  linkOriginIsFenced,
  OrchestratorMcpFailure,
  type DeepPlanSourceRef,
  type OrchestrationV2LinkOrigin,
  type OrchestratorMcpThreadReadInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import { isLiveCallerShell, unavailable } from "../mcp/threadAccess.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";

export class DeepPlanChatReferences extends Context.Service<
  DeepPlanChatReferences,
  {
    readonly assertReadable: (
      chats: ReadonlyArray<DeepPlanSourceRef>,
      origin?: OrchestrationV2LinkOrigin,
    ) => Effect.Effect<void, DeepPlanError>;
  }
>()("t3/deepPlanning/DeepPlanChatReferences") {}

const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const engine = yield* Orchestrator.OrchestratorV2;
  const peers = yield* PeerForwarding.PeerForwarding;
  const assertReadable: DeepPlanChatReferences["Service"]["assertReadable"] = Effect.fn(
    "DeepPlanChatReferences.assertReadable",
  )(function* (chats, origin) {
    const environmentId = yield* environment.getEnvironmentId;
    yield* Effect.forEach(
      chats,
      (chat) => {
        if (chat.environmentId !== environmentId) {
          if (origin !== undefined && linkOriginIsFenced(origin)) {
            return Effect.fail(
              new DeepPlanError({
                code: "target-unavailable",
                message:
                  "This planning thread was started through a restricted link and cannot access chats in other environments.",
              }),
            );
          }
          return peers.assertReadableThread(chat).pipe(
            Effect.mapError(
              (error) =>
                new DeepPlanError({
                  code: "target-unavailable",
                  message: `Could not open selected chat ${chat.threadId} in environment ${chat.environmentId}. ${error.message}`,
                }),
            ),
          );
        }
        const unavailable = new DeepPlanError({
          code: "target-unavailable",
          message: `Selected chat ${chat.threadId} is unavailable in its project.`,
        });
        return engine.getThreadShell(chat.threadId).pipe(
          Effect.mapError(() => unavailable),
          Effect.flatMap((thread) =>
            thread?.deletedAt === null && thread.projectId === chat.projectId
              ? Effect.void
              : Effect.fail(unavailable),
          ),
        );
      },
      { concurrency: 4, discard: true },
    );
  });
  return DeepPlanChatReferences.of({ assertReadable });
});

export const layer = Layer.effect(DeepPlanChatReferences, make);

export const assertDeepPlanChatRead = Effect.fn("DeepPlanChatReferences.assertRead")(function* (
  scope: McpInvocationScope,
  input: OrchestratorMcpThreadReadInput,
) {
  const explorer = scope.capabilities.has("deep-plan-chat-read");
  const planning = scope.deepPlan?.phase === "planning";
  if (!explorer && !planning) return;

  const denied = new OrchestratorMcpFailure({
    code: "capability_denied",
    message: "Deep Plan can read only the available chats selected for this run.",
  });
  if (scope.thread === undefined) return yield* denied;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const caller = yield* threads
    .getThreadShell(scope.thread.threadId)
    .pipe(Effect.mapError(unavailable));
  if (
    caller === null ||
    caller.deletedAt !== null ||
    !isLiveCallerShell(caller, scope.thread.providerInstanceId)
  )
    return yield* denied;

  const runId = explorer ? caller.fetchWorker?.deepPlanRunId : scope.deepPlan?.runId;
  const ownerThreadId = explorer ? caller.lineage.parentThreadId : caller.id;
  if (
    runId === undefined ||
    ownerThreadId === null ||
    (explorer && caller.lineage.relationshipToParent !== "subagent") ||
    (!explorer && scope.deepPlan?.runThreadId !== ownerThreadId)
  )
    return yield* denied;

  const owner =
    ownerThreadId === caller.id
      ? caller
      : yield* threads.getThreadShell(ownerThreadId).pipe(Effect.mapError(unavailable));
  const run = owner?.deepPlan;
  if (
    owner === null ||
    owner.deletedAt !== null ||
    owner.archivedAt !== null ||
    owner.activeRunId === null ||
    !isDeepPlanRun(run) ||
    run.id !== runId ||
    run.threadId !== owner.id ||
    (run.phase !== "planning" && run.phase !== "awaitingApproval" && run.phase !== "paused")
  )
    return yield* denied;

  const environmentId = input.environmentId ?? scope.environmentId;
  const reference = run.chats.find(
    (ref) => ref.environmentId === environmentId && ref.threadId === input.threadId,
  );
  if (environmentId !== scope.environmentId) {
    if (reference !== undefined) return;
    return yield* denied;
  }

  if (!explorer && input.threadId === owner.id) return;
  const target = yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(unavailable));
  if (
    target?.deletedAt === null &&
    (target.projectId === reference?.projectId ||
      (run.includeProjectChats &&
        target.projectId === owner.projectId &&
        isListedThreadLineage(target.lineage)))
  )
    return;
  return yield* denied;
});
