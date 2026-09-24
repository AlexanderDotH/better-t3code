import {
  EMPTY_PROJECT_INDEX_CLIENT_STATE,
  applyProjectIndexStreamEvent,
  projectIndexScopeKey,
  type ProjectIndexClientApi,
  type ProjectIndexClientState,
} from "@t3tools/client-runtime/project-indexing";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
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
import * as Stream from "effect/Stream";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";

const mutationScheduler = createAtomCommandScheduler();
const EMPTY_STREAM_STATE: ProjectIndexClientState & {
  readonly lastEvent: ProjectIndexStreamEvent | null;
} = {
  ...EMPTY_PROJECT_INDEX_CLIENT_STATE,
  lastEvent: null,
};
const mutationConcurrency = {
  mode: "serial" as const,
  key: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: ProjectIndexScopeInput;
  }) => projectIndexScopeKey(target.input, target.environmentId),
};

export const projectIndexEnvironment = {
  getSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:get-settings",
    tag: WS_METHODS.projectIndexGetSettings,
  }),
  getStatus: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:get-status",
    tag: WS_METHODS.projectIndexGetStatus,
  }),
  status: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "mobile:project-index:status",
    tag: WS_METHODS.projectIndexGetStatus,
    staleTimeMs: 0,
    idleTtlMs: 0,
  }),
  events: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "mobile:project-index:events",
    tag: WS_METHODS.projectIndexSubscribe,
    idleTtlMs: 0,
    transform: (stream) =>
      stream.pipe(
        Stream.scan(EMPTY_STREAM_STATE, (current, event) => ({
          ...applyProjectIndexStreamEvent(current, event),
          lastEvent: event,
        })),
      ),
  }),
  requestQuery: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:request-query",
    tag: WS_METHODS.projectIndexQuery,
  }),
  requestModelCheck: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:request-model-check",
    tag: WS_METHODS.projectIndexCheckModel,
  }),
  updateSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:update-settings",
    tag: WS_METHODS.projectIndexUpdateSettings,
    scheduler: mutationScheduler,
    concurrency: mutationConcurrency,
  }),
  start: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:start",
    tag: WS_METHODS.projectIndexStart,
    scheduler: mutationScheduler,
    concurrency: mutationConcurrency,
  }),
  control: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:control",
    tag: WS_METHODS.projectIndexControl,
    scheduler: mutationScheduler,
    concurrency: mutationConcurrency,
  }),
  review: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:project-index:review",
    tag: WS_METHODS.projectIndexReview,
    scheduler: mutationScheduler,
    concurrency: {
      mode: "serial",
      key: (target) => JSON.stringify(["review", mutationConcurrency.key(target)]),
    },
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

export function bindProjectIndexApi(environmentId: EnvironmentId): ProjectIndexClientApi {
  return {
    getSettings: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.getSettings, input),
    getStatus: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.getStatus, input),
    updateSettings: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.updateSettings, input),
    start: (input) => runProjectIndexRequest(environmentId, projectIndexEnvironment.start, input),
    control: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.control, input),
    query: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.requestQuery, input),
    checkModel: (input) =>
      runProjectIndexRequest(environmentId, projectIndexEnvironment.requestModelCheck, input),
    review: (input) => runProjectIndexRequest(environmentId, projectIndexEnvironment.review, input),
    subscribe: (input, listener) => {
      let lastEvent: ProjectIndexStreamEvent | undefined;
      return appAtomRegistry.subscribe(
        projectIndexEnvironment.events({ environmentId, input }),
        (result) => {
          if (
            result._tag !== "Success" ||
            result.value.lastEvent === null ||
            result.value.lastEvent === lastEvent
          )
            return;
          lastEvent = result.value.lastEvent;
          listener(lastEvent);
        },
        { immediate: true },
      );
    },
  };
}
