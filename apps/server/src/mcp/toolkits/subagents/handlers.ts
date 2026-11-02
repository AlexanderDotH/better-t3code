import * as McpToolAccess from "../../McpToolAccess.ts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { GeneralSubagentCoordinator } from "../../../subagents/GeneralSubagentCoordinator.ts";
import type {
  GeneralSubagentCancelInput,
  GeneralSubagentError,
  GeneralSubagentFollowUpInput,
  GeneralSubagentInterruptInput,
  GeneralSubagentSendMessageInput,
  GeneralSubagentSpawnInput,
  GeneralSubagentWaitInput,
} from "../../../subagents/GeneralSubagentProtocol.ts";
import { GeneralSubagentToolkit } from "./tools.ts";

const invoke = Effect.fn("GeneralSubagentToolkit.invoke")(function* <A>(
  operation: (
    coordinator: GeneralSubagentCoordinator["Service"],
    caller: {
      readonly parentThreadId: import("@t3tools/contracts").ThreadId;
      readonly callerProviderInstanceId: import("@t3tools/contracts").ProviderInstanceId;
    },
  ) => Effect.Effect<A, GeneralSubagentError>,
) {
  const invocation = McpInvocationContext.workspaceThreadScope(
    yield* McpInvocationContext.requireThreadScope(
      yield* McpInvocationContext.McpInvocationContext,
      "Subagents",
    ),
  );
  const coordinator = yield* GeneralSubagentCoordinator;
  return yield* operation(coordinator, {
    parentThreadId: invocation.threadId,
    callerProviderInstanceId: invocation.providerInstanceId,
  });
});

const invokeGeneralSubagentModels = () =>
  invoke((coordinator, caller) => coordinator.listModels(caller));

export const invokeGeneralSubagentSpawn = (input: GeneralSubagentSpawnInput) =>
  invoke((coordinator, caller) => coordinator.spawn({ ...caller, ...input }));

const invokeGeneralSubagentWait = (input: GeneralSubagentWaitInput) =>
  invoke((coordinator, caller) => coordinator.wait({ ...caller, ...input }));

const invokeGeneralSubagentCancel = (input: GeneralSubagentCancelInput) =>
  invoke((coordinator, caller) => coordinator.cancel({ ...caller, ...input }));

const invokeGeneralSubagentList = () =>
  invoke((coordinator, caller) => coordinator.listAgents(caller));

const invokeGeneralSubagentSpawnAgent = (input: GeneralSubagentSpawnInput) =>
  invoke((coordinator, caller) => coordinator.spawnAgent({ ...caller, ...input }));

const invokeGeneralSubagentSendMessage = (input: GeneralSubagentSendMessageInput) =>
  invoke((coordinator, caller) => coordinator.sendMessage({ ...caller, ...input }));

export const invokeGeneralSubagentFollowUp = (input: GeneralSubagentFollowUpInput) =>
  invoke((coordinator, caller) => coordinator.followUp({ ...caller, ...input }));

const invokeGeneralSubagentWaitAgent = (input: GeneralSubagentWaitInput) =>
  invoke((coordinator, caller) => coordinator.waitAgent({ ...caller, ...input }));

const invokeGeneralSubagentInterrupt = (input: GeneralSubagentInterruptInput) =>
  invoke((coordinator, caller) => coordinator.interruptAgent({ ...caller, ...input }));

export const GeneralSubagentToolkitHandlersLive = McpToolAccess.toLayer(GeneralSubagentToolkit, {
  subagent_models: McpToolAccess.readsAsCaller(invokeGeneralSubagentModels),
  subagent_spawn: McpToolAccess.actsAsCaller(invokeGeneralSubagentSpawn),
  subagent_wait: McpToolAccess.actsAsCaller(invokeGeneralSubagentWait),
  subagent_cancel: McpToolAccess.actsAsCaller(invokeGeneralSubagentCancel),
  list_agents: McpToolAccess.actsAsCaller(invokeGeneralSubagentList),
  spawn_agent: McpToolAccess.actsAsCaller(invokeGeneralSubagentSpawnAgent),
  send_message: McpToolAccess.actsAsCaller(invokeGeneralSubagentSendMessage),
  followup_task: McpToolAccess.actsAsCaller(invokeGeneralSubagentFollowUp),
  wait_agent: McpToolAccess.actsAsCaller(invokeGeneralSubagentWaitAgent),
  interrupt_agent: McpToolAccess.actsAsCaller(invokeGeneralSubagentInterrupt),
});
