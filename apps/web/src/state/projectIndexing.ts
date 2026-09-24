import {
  projectIndexScopeKey,
  type ProjectIndexClientApi,
} from "@t3tools/client-runtime/project-indexing";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  type EnvironmentId,
  type ProjectIndexScopeInput,
  type ProjectIndexStreamEvent,
} from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const scheduler = createAtomCommandScheduler();
const concurrency = {
  mode: "serial" as const,
  key: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: ProjectIndexScopeInput;
  }) => projectIndexScopeKey(target.input, target.environmentId),
};

export const projectIndexEnvironment = {
  getSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:settings",
    tag: WS_METHODS.projectIndexGetSettings,
  }),
  getStatus: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:status",
    tag: WS_METHODS.projectIndexGetStatus,
  }),
  query: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:query",
    tag: WS_METHODS.projectIndexQuery,
  }),
  checkModel: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:check-model",
    tag: WS_METHODS.projectIndexCheckModel,
  }),
  updateSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:update-settings",
    tag: WS_METHODS.projectIndexUpdateSettings,
    scheduler,
    concurrency,
  }),
  start: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:start",
    tag: WS_METHODS.projectIndexStart,
    scheduler,
    concurrency,
  }),
  control: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:control",
    tag: WS_METHODS.projectIndexControl,
    scheduler,
    concurrency,
  }),
  review: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "web:project-index:review",
    tag: WS_METHODS.projectIndexReview,
    scheduler,
    concurrency: {
      mode: "serial",
      key: (target) =>
        JSON.stringify(["review", projectIndexScopeKey(target.input, target.environmentId)]),
    },
  }),
  events: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "web:project-index:events",
    tag: WS_METHODS.projectIndexSubscribe,
    idleTtlMs: 0,
  }),
  activity: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "web:project-index:activity",
    tag: WS_METHODS.projectIndexSubscribeActivity,
    idleTtlMs: 0,
  }),
};

async function runProjectIndexRequest<Input, Value, Error>(
  environmentId: EnvironmentId,
  command: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: Input },
    Value,
    Error
  >,
  input: Input,
): Promise<Value> {
  const result = await runAtomCommand(
    appAtomRegistry,
    command,
    { environmentId, input },
    { reportFailure: false },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

const environmentApis = new Map<EnvironmentId, ProjectIndexClientApi>();

export function bindProjectIndexApi(environmentId: EnvironmentId): ProjectIndexClientApi {
  const existing = environmentApis.get(environmentId);
  if (existing) return existing;
  const api: ProjectIndexClientApi = {
    getSettings: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.getSettings, input),
    getStatus: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.getStatus, input),
    query: (input) => runProjectIndexRequest(environmentId, projectIndexEnvironment.query, input),
    checkModel: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.checkModel, input),
    updateSettings: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.updateSettings, input),
    start: (input) => runProjectIndexRequest(environmentId, projectIndexEnvironment.start, input),
    control: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.control, input),
    review: (input) => runProjectIndexRequest(environmentId, projectIndexEnvironment.review, input),
    subscribe: (input, listener) => {
      let previousEvent: ProjectIndexStreamEvent | undefined;
      return appAtomRegistry.subscribe(
        projectIndexEnvironment.events({ environmentId, input }),
        (result) => {
          if (result._tag !== "Success" || result.value === previousEvent) return;
          previousEvent = result.value;
          listener(result.value);
        },
        { immediate: true },
      );
    },
  };
  environmentApis.set(environmentId, api);
  return api;
}
