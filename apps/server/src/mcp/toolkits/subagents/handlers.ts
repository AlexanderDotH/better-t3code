import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { GeneralSubagentCoordinator } from "../../../subagents/GeneralSubagentCoordinator.ts";
import type {
  GeneralSubagentCancelInput,
  GeneralSubagentError,
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

export const GeneralSubagentToolkitHandlersLive = GeneralSubagentToolkit.toLayer({
  subagent_models: invokeGeneralSubagentModels,
  subagent_spawn: invokeGeneralSubagentSpawn,
  subagent_wait: invokeGeneralSubagentWait,
  subagent_cancel: invokeGeneralSubagentCancel,
});
