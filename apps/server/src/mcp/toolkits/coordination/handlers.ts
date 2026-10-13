import type {
  ProjectAgentClaimSetInput,
  ProjectAgentInboxInput,
  ProjectAgentMessageSendInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ProjectAgentCoordinationUnavailableError } from "@t3tools/contracts";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { resolveMessageReplyExecution } from "../../messageReplyExecution.ts";
import * as ProjectAgentCoordinator from "../../../projectAgent/ProjectAgentCoordinator.ts";
import { CoordinationToolkit } from "./tools.ts";

const invoke = Effect.fn("CoordinationToolkit.invoke")(function* <A>(
  operation: (
    coordinator: ProjectAgentCoordinator.ProjectAgentCoordinatorShape,
    threadId: import("@t3tools/contracts").ThreadId,
    reply?: ProjectAgentCoordinator.ProjectAgentReplyExecution,
  ) => Effect.Effect<A, import("@t3tools/contracts").ProjectAgentCoordinationError>,
) {
  const invocation = yield* McpInvocationContext.requireCoordinationMcpCapability();
  const coordinator = yield* ProjectAgentCoordinator.ProjectAgentCoordinator;
  if (invocation.messageReply === undefined)
    return yield* operation(coordinator, invocation.threadId);
  const execution = yield* resolveMessageReplyExecution(invocation).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectAgentCoordinationUnavailableError({
          reason: "projection_unavailable",
          cause,
        }),
    ),
  );
  if (Option.isNone(execution)) {
    return yield* new ProjectAgentCoordinationUnavailableError({ reason: "thread_unavailable" });
  }
  return yield* operation(coordinator, invocation.threadId, execution.value);
});

export const invokeProjectAgentList = () =>
  invoke((coordinator, threadId, reply) => coordinator.list(threadId, reply));

const invokeProjectAgentClaim = (input: ProjectAgentClaimSetInput) =>
  invoke((coordinator, threadId, reply) => coordinator.claim(threadId, input, reply));

const invokeProjectAgentSend = (input: ProjectAgentMessageSendInput) =>
  invoke((coordinator, threadId, reply) => coordinator.send(threadId, input, reply));

const invokeProjectAgentInbox = (input: ProjectAgentInboxInput) =>
  invoke((coordinator, threadId, reply) => coordinator.inbox(threadId, input, reply));

export const CoordinationToolkitHandlersLive = CoordinationToolkit.toLayer({
  project_agent_list: invokeProjectAgentList,
  project_agent_claim: invokeProjectAgentClaim,
  project_agent_send: invokeProjectAgentSend,
  project_agent_inbox: invokeProjectAgentInbox,
});
