import * as McpToolAccess from "../../McpToolAccess.ts";
import type {
  ProjectAgentClaimSetInput,
  ProjectAgentInboxInput,
  ProjectAgentMessageSendInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectAgentCoordinator from "../../../projectAgent/ProjectAgentCoordinator.ts";
import { CoordinationToolkit } from "./tools.ts";

const invoke = Effect.fn("CoordinationToolkit.invoke")(function* <A>(
  operation: (
    coordinator: ProjectAgentCoordinator.ProjectAgentCoordinatorShape,
    threadId: import("@t3tools/contracts").ThreadId,
  ) => Effect.Effect<A, import("@t3tools/contracts").ProjectAgentCoordinationError>,
) {
  const invocation = yield* McpInvocationContext.requireCoordinationMcpCapability();
  const coordinator = yield* ProjectAgentCoordinator.ProjectAgentCoordinator;
  return yield* operation(coordinator, invocation.threadId);
});

export const invokeProjectAgentList = () =>
  invoke((coordinator, threadId) => coordinator.list(threadId));

const invokeProjectAgentClaim = (input: ProjectAgentClaimSetInput) =>
  invoke((coordinator, threadId) => coordinator.claim(threadId, input));

const invokeProjectAgentSend = (input: ProjectAgentMessageSendInput) =>
  invoke((coordinator, threadId) => coordinator.send(threadId, input));

const invokeProjectAgentInbox = (input: ProjectAgentInboxInput) =>
  invoke((coordinator, threadId) => coordinator.inbox(threadId, input));

export const CoordinationToolkitHandlersLive = McpToolAccess.toLayer(CoordinationToolkit, {
  project_agent_list: McpToolAccess.readsAsCaller(invokeProjectAgentList),
  project_agent_claim: McpToolAccess.actsAsCaller(invokeProjectAgentClaim),
  project_agent_send: McpToolAccess.actsAsCaller(invokeProjectAgentSend),
  project_agent_inbox: McpToolAccess.readsAsCaller(invokeProjectAgentInbox),
});
