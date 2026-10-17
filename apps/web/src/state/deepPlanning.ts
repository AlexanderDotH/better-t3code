import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  DEEP_PLAN_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  type DeepPlanRun,
  type EnvironmentId,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import { approveDeepPlanImplementation } from "@t3tools/client-runtime/deep-planning";
import { AsyncResult } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { randomUUID } from "../lib/utils";

const deepPlanningEnvironment = {
  catalogSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:catalog-sources",
    tag: DEEP_PLAN_WS_METHODS.catalogSources,
  }),
  dispatchCommand: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:dispatch",
    tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
  }),
  getRun: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:get-run",
    tag: DEEP_PLAN_WS_METHODS.getRun,
  }),
  exportSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:export-sources",
    tag: DEEP_PLAN_WS_METHODS.exportSources,
  }),
  readExportChunk: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:read-export-chunk",
    tag: DEEP_PLAN_WS_METHODS.readExportChunk,
  }),
  initializeSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:initialize-sources",
    tag: DEEP_PLAN_WS_METHODS.initializeSources,
  }),
  importSourceChunk: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:deep-plan:import-source-chunk",
    tag: DEEP_PLAN_WS_METHODS.importSourceChunk,
  }),
};

function environmentCommand<Input, Output, Error>(
  environmentId: EnvironmentId,
  command: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: Input },
    Output,
    Error
  >,
) {
  return async (input: Input): Promise<Output> => {
    const result = await runAtomCommand(
      appAtomRegistry,
      command,
      { environmentId, input },
      { reportFailure: false },
    );
    if (AsyncResult.isSuccess(result)) return result.value;
    throw squashAtomCommandFailure(result);
  };
}

export function getWebDeepPlanningApi(environmentId: EnvironmentId) {
  return {
    dispatchCommand: environmentCommand(environmentId, deepPlanningEnvironment.dispatchCommand),
    catalogSources: environmentCommand(environmentId, deepPlanningEnvironment.catalogSources),
    getRun: environmentCommand(environmentId, deepPlanningEnvironment.getRun),
    exportSources: environmentCommand(environmentId, deepPlanningEnvironment.exportSources),
    readExportChunk: environmentCommand(environmentId, deepPlanningEnvironment.readExportChunk),
    initializeSources: environmentCommand(environmentId, deepPlanningEnvironment.initializeSources),
    importSourceChunk: environmentCommand(environmentId, deepPlanningEnvironment.importSourceChunk),
  };
}

export async function approveWebDeepPlan(input: {
  environmentId: EnvironmentId;
  run: DeepPlanRun;
  implementationThreadId: ThreadId;
  implementation: ModelSelection;
  requestedParallelism: number;
}): Promise<DeepPlanRun> {
  const api = getWebDeepPlanningApi(input.environmentId);
  return approveDeepPlanImplementation({
    ...input,
    commandId: CommandId.make(randomUUID()),
    operationId: randomUUID(),
    createdAt: new Date().toISOString(),
    getRun: api.getRun,
    dispatchCommand: api.dispatchCommand,
  });
}
