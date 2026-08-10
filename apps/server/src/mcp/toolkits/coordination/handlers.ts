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

export const invokeProjectAgentClaim = (input: ProjectAgentClaimSetInput) =>
  invoke((coordinator, threadId) => coordinator.claim(threadId, input));

export const invokeProjectAgentSend = (input: ProjectAgentMessageSendInput) =>
  invoke((coordinator, threadId) => coordinator.send(threadId, input));

export const invokeProjectAgentInbox = (input: ProjectAgentInboxInput) =>
  invoke((coordinator, threadId) => coordinator.inbox(threadId, input));

export const CoordinationToolkitHandlersLive = CoordinationToolkit.toLayer({
  project_agent_list: invokeProjectAgentList,
  project_agent_claim: invokeProjectAgentClaim,
  project_agent_send: invokeProjectAgentSend,
  project_agent_inbox: invokeProjectAgentInbox,
});
