import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEEP_PLAN_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  type DeepPlanRun,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { continueDeepPlanForTurn } from "@t3tools/client-runtime/deep-planning";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { uuidv4 } from "../lib/uuid";

export const deepPlanningEnvironment = {
  dispatchCommand: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:dispatch-command",
    tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
  }),
  catalogSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:catalog-sources",
    tag: DEEP_PLAN_WS_METHODS.catalogSources,
  }),
  getRun: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:get-run",
    tag: DEEP_PLAN_WS_METHODS.getRun,
  }),
  exportSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:export-sources",
    tag: DEEP_PLAN_WS_METHODS.exportSources,
  }),
  readExportChunk: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:read-export-chunk",
    tag: DEEP_PLAN_WS_METHODS.readExportChunk,
  }),
  initializeSources: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:initialize-sources",
    tag: DEEP_PLAN_WS_METHODS.initializeSources,
  }),
  importSourceChunk: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:deep-plan:import-source-chunk",
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

export function getMobileDeepPlanningApi(environmentId: EnvironmentId) {
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

export async function resumeMobileDeepPlan(
  environmentId: EnvironmentId,
  run: DeepPlanRun,
  options: {
    readonly projectId: ProjectId;
    readonly automatic?: boolean;
    readonly threadId?: ThreadId;
    readonly idleGuard?: Parameters<typeof continueDeepPlanForTurn>[0]["idleGuard"];
    readonly fallbackModelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly providers?: ReadonlyArray<ServerProvider>;
  },
): Promise<void> {
  await continueDeepPlanForTurn({
    ...options,
    environmentId,
    run,
    apiForEnvironment: getMobileDeepPlanningApi,
    createId: uuidv4,
  });
}
