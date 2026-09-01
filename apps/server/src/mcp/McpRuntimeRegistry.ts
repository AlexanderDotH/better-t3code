import {
  type McpLiveApplyResult,
  type McpRuntimeActionInput,
  type McpRuntimeActionResult,
  type McpRuntimeContextChangesInput,
  type McpRuntimeContextsInput,
  type McpRuntimeContextsResult,
  McpRuntimeError,
  type McpRuntimeServerDetailsInput,
  type McpRuntimeServerDetailsResult,
  type McpRuntimeSnapshot,
  type McpRuntimeSnapshotInput,
  type McpServerDefinition,
  type McpSetProviderEnabledInput,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import type { ProviderMcpSupportMode } from "../provider/Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../provider/Services/ProviderAdapterRegistry.ts";
import { makeMcpRuntimeActionCoordinator } from "./McpRuntimeActionCoordinator.ts";
import { makeMcpRuntimeConfigurationCoordinator } from "./McpRuntimeConfigurationCoordinator.ts";
import type { McpRuntimeConfigurationReconcileInput } from "./McpRuntimeConfigurationTypes.ts";
import { runtimeContextKey as contextKey } from "./McpRuntimeContextState.ts";
import {
  makeMcpRuntimeError as runtimeError,
  mcpRuntimeErrorDetail as errorDetail,
} from "./McpRuntimeProjection.ts";
import { makeMcpRuntimeRefreshCoordinator } from "./McpRuntimeRefreshCoordinator.ts";
import {
  makeMcpRuntimeStateStore,
  type McpRuntimeContextSubscription,
  type McpRuntimeSubscription,
} from "./McpRuntimeStateStore.ts";

export type { McpRuntimeConfigurationReconcileInput } from "./McpRuntimeConfigurationTypes.ts";
export type {
  McpRuntimeContextSubscription,
  McpRuntimeSubscription,
} from "./McpRuntimeStateStore.ts";

export interface McpRuntimeRegistryShape {
  readonly registerSession: (session: ProviderSession) => Effect.Effect<void>;
  readonly endSession: (input: McpRuntimeSnapshotInput) => Effect.Effect<void>;
  readonly listContexts: (
    input: McpRuntimeContextsInput,
  ) => Effect.Effect<McpRuntimeContextsResult>;
  readonly subscribeContexts: (
    input: McpRuntimeContextChangesInput,
  ) => Effect.Effect<McpRuntimeContextSubscription, never, Scope.Scope>;
  readonly providerCapability: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderMcpSupportMode>;
  readonly snapshot: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly refresh: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly subscribe: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSubscription, McpRuntimeError, Scope.Scope>;
  readonly getServerDetails: (
    input: McpRuntimeServerDetailsInput,
  ) => Effect.Effect<McpRuntimeServerDetailsResult, McpRuntimeError>;
  readonly runAction: (
    input: McpRuntimeActionInput,
  ) => Effect.Effect<McpRuntimeActionResult, McpRuntimeError>;
  readonly applyConfiguration: (
    input: McpSetProviderEnabledInput,
    server?: McpServerDefinition,
  ) => Effect.Effect<ReadonlyArray<McpLiveApplyResult>>;
  readonly reconcileConfiguration: (
    input: McpRuntimeConfigurationReconcileInput,
  ) => Effect.Effect<ReadonlyArray<McpLiveApplyResult>>;
  readonly observeProviderEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}

export class McpRuntimeRegistry extends Context.Service<
  McpRuntimeRegistry,
  McpRuntimeRegistryShape
>()("t3/mcp/McpRuntimeRegistry") {}

export const makeMcpRuntimeRegistry = Effect.fn("makeMcpRuntimeRegistry")(function* () {
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistry;
  const stateStore = yield* makeMcpRuntimeStateStore();

  const adapterFor = (providerInstanceId: ProviderInstanceId) =>
    adapters
      .getByInstance(providerInstanceId)
      .pipe(
        Effect.mapError((error) =>
          runtimeError("provider-error", `Provider adapter is unavailable: ${errorDetail(error)}`),
        ),
      );

  const { refresh, refreshAfterProviderEvent } = yield* makeMcpRuntimeRefreshCoordinator({
    contextKey,
    requireEntry: stateStore.requireEntry,
    adapterFor,
    replaceServers: stateStore.replaceServers,
    markStale: stateStore.markStale,
  });

  const { getServerDetails, runAction } = yield* makeMcpRuntimeActionCoordinator({
    requireEntry: stateStore.requireEntry,
    adapterFor,
    refresh,
    upsertServer: stateStore.upsertServer,
  });

  const { applyConfiguration, reconcileConfiguration } =
    yield* makeMcpRuntimeConfigurationCoordinator({
      state: stateStore.state,
      adapterFor,
      refresh,
      markConfigurationDrift: stateStore.markConfigurationDrift,
      markConfigurationSetDrift: stateStore.markConfigurationSetDrift,
    });

  const providerCapability: McpRuntimeRegistryShape["providerCapability"] = (providerInstanceId) =>
    adapters.getByInstance(providerInstanceId).pipe(
      Effect.map((adapter) => adapter.capabilities.mcp),
      Effect.orElseSucceed(() => "unsupported" as const),
    );

  const subscribe: McpRuntimeRegistryShape["subscribe"] = (input) =>
    stateStore.subscribe(input, refresh(input));

  const observeProviderEvent: McpRuntimeRegistryShape["observeProviderEvent"] = (event) => {
    if (event.providerInstanceId === undefined || event.runtimeSessionId === undefined) {
      return Effect.void;
    }
    const target = {
      providerInstanceId: event.providerInstanceId,
      threadId: event.threadId,
      runtimeSessionId: event.runtimeSessionId,
    };
    if (event.type === "session.exited") {
      return stateStore.endSession(target);
    }
    if (event.type !== "mcp.status.updated" && event.type !== "mcp.oauth.completed") {
      return Effect.void;
    }
    return refreshAfterProviderEvent(target);
  };

  return {
    registerSession: stateStore.registerSession,
    endSession: stateStore.endSession,
    listContexts: stateStore.listContexts,
    subscribeContexts: stateStore.subscribeContexts,
    providerCapability,
    snapshot: stateStore.snapshot,
    refresh,
    subscribe,
    getServerDetails,
    runAction,
    applyConfiguration,
    reconcileConfiguration,
    observeProviderEvent,
  } satisfies McpRuntimeRegistryShape;
});

export const McpRuntimeRegistryLive = Layer.effect(McpRuntimeRegistry, makeMcpRuntimeRegistry());
