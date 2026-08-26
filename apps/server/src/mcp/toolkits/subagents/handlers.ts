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
      readonly parentThreadId: McpInvocationContext.McpInvocationScope["threadId"];
      readonly callerProviderInstanceId: McpInvocationContext.McpInvocationScope["providerInstanceId"];
    },
  ) => Effect.Effect<A, GeneralSubagentError>,
) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const coordinator = yield* GeneralSubagentCoordinator;
  return yield* operation(coordinator, {
    parentThreadId: invocation.threadId,
    callerProviderInstanceId: invocation.providerInstanceId,
  });
});

export const invokeGeneralSubagentModels = () =>
  invoke((coordinator, caller) => coordinator.listModels(caller));

export const invokeGeneralSubagentSpawn = (input: GeneralSubagentSpawnInput) =>
  invoke((coordinator, caller) => coordinator.spawn({ ...caller, ...input }));

export const invokeGeneralSubagentWait = (input: GeneralSubagentWaitInput) =>
  invoke((coordinator, caller) => coordinator.wait({ ...caller, ...input }));

export const invokeGeneralSubagentCancel = (input: GeneralSubagentCancelInput) =>
  invoke((coordinator, caller) => coordinator.cancel({ ...caller, ...input }));

export const invokeGeneralSubagentList = () =>
  invoke((coordinator, caller) => coordinator.listAgents(caller));

export const invokeGeneralSubagentSpawnAgent = (input: GeneralSubagentSpawnInput) =>
  invoke((coordinator, caller) => coordinator.spawnAgent({ ...caller, ...input }));

export const invokeGeneralSubagentSendMessage = (input: GeneralSubagentSendMessageInput) =>
  invoke((coordinator, caller) => coordinator.sendMessage({ ...caller, ...input }));

export const invokeGeneralSubagentFollowUp = (input: GeneralSubagentFollowUpInput) =>
  invoke((coordinator, caller) => coordinator.followUp({ ...caller, ...input }));

export const invokeGeneralSubagentWaitAgent = (input: GeneralSubagentWaitInput) =>
  invoke((coordinator, caller) => coordinator.waitAgent({ ...caller, ...input }));

export const invokeGeneralSubagentInterrupt = (input: GeneralSubagentInterruptInput) =>
  invoke((coordinator, caller) => coordinator.interruptAgent({ ...caller, ...input }));

export const GeneralSubagentToolkitHandlersLive = GeneralSubagentToolkit.toLayer({
  subagent_models: invokeGeneralSubagentModels,
  subagent_spawn: invokeGeneralSubagentSpawn,
  subagent_wait: invokeGeneralSubagentWait,
  subagent_cancel: invokeGeneralSubagentCancel,
  list_agents: invokeGeneralSubagentList,
  spawn_agent: invokeGeneralSubagentSpawnAgent,
  send_message: invokeGeneralSubagentSendMessage,
  followup_task: invokeGeneralSubagentFollowUp,
  wait_agent: invokeGeneralSubagentWaitAgent,
  interrupt_agent: invokeGeneralSubagentInterrupt,
});
