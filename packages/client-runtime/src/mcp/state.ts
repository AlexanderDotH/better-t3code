import {
  WS_METHODS,
  type EnvironmentId,
  type McpRuntimeContextSnapshot,
  type McpRuntimeServerDetailsInput,
  type McpRuntimeSnapshot,
  type McpRuntimeSnapshotInput,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "../state/runtime.ts";
import { applyMcpRuntimeContextChange } from "./contextProjection.ts";
import { mcpRuntimeServerDetailsKey } from "./keys.ts";
import { applyMcpRuntimeChange } from "./runtimeProjection.ts";

const DEFAULT_LIVE_IDLE_TTL_MS = 15_000;
const DEFAULT_DETAILS_IDLE_TTL_MS = 30_000;

export interface McpEnvironmentAtomOptions {
  readonly liveIdleTtlMs?: number;
  readonly detailsIdleTtlMs?: number;
}

const configurationMutationScheduler = createAtomCommandScheduler();
const runtimeActionScheduler = createAtomCommandScheduler();
const configurationMutationConcurrency = {
  mode: "serial" as const,
  key: (target: { readonly environmentId: EnvironmentId }) => target.environmentId,
};
const runtimeActionConcurrency = {
  mode: "serial" as const,
  key: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: McpRuntimeServerDetailsInput;
  }) => mcpRuntimeServerDetailsKey({ environmentId: target.environmentId, ...target.input }),
};

function runtimeInput(input: McpRuntimeSnapshotInput): McpRuntimeSnapshotInput {
  return {
    providerInstanceId: input.providerInstanceId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
  };
}

function detailsInput(input: McpRuntimeServerDetailsInput): McpRuntimeServerDetailsInput {
  return { ...runtimeInput(input), providerKey: input.providerKey };
}

export function createMcpEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: McpEnvironmentAtomOptions = {},
) {
  const liveIdleTtlMs = options.liveIdleTtlMs ?? DEFAULT_LIVE_IDLE_TTL_MS;
  const detailsIdleTtlMs = options.detailsIdleTtlMs ?? DEFAULT_DETAILS_IDLE_TTL_MS;
  const runtimeServerDetailsQuery = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:mcp:runtime-server-details-query",
    tag: WS_METHODS.mcpRuntimeServerDetails,
    staleTimeMs: 0,
    idleTtlMs: detailsIdleTtlMs,
  });
  const sessionAccess = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:mcp:session-access",
    tag: WS_METHODS.serverProbe,
    staleTimeMs: 30_000,
    idleTtlMs: liveIdleTtlMs,
  });
  const runtimeContextProjection = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "environment-data:mcp:runtime-context-projection",
    idleTtlMs: liveIdleTtlMs,
    subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.mcpRuntimeContextChanges>) =>
      subscribe(WS_METHODS.mcpRuntimeContextChanges, input).pipe(
        Stream.mapAccum(
          () => null as McpRuntimeContextSnapshot | null,
          (current, change) => {
            const next = applyMcpRuntimeContextChange(current, change, input.providerInstanceId);
            return [next, next === null ? [] : [next]] as const;
          },
        ),
      ),
  });
  const runtimeProjection = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "environment-data:mcp:runtime-projection",
    idleTtlMs: liveIdleTtlMs,
    subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.mcpRuntimeChanges>) =>
      subscribe(WS_METHODS.mcpRuntimeChanges, input).pipe(
        Stream.mapAccum(
          () => null as McpRuntimeSnapshot | null,
          (current, change) => {
            const next = applyMcpRuntimeChange(current, change, input);
            return [next, next === null ? [] : [next]] as const;
          },
        ),
      ),
  });

  return {
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:list",
      tag: WS_METHODS.mcpList,
    }),
    discoverImportSources: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:discover-import-sources",
      tag: WS_METHODS.mcpDiscoverImportSources,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:create",
      tag: WS_METHODS.mcpCreate,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:update",
      tag: WS_METHODS.mcpUpdate,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:delete",
      tag: WS_METHODS.mcpDelete,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:set-enabled",
      tag: WS_METHODS.mcpSetEnabled,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    setProviderEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:set-provider-enabled",
      tag: WS_METHODS.mcpSetProviderEnabled,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    importCursorJson: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:import-cursor-json",
      tag: WS_METHODS.mcpImportCursorJson,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    importSources: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:import-sources",
      tag: WS_METHODS.mcpImportSources,
      scheduler: configurationMutationScheduler,
      concurrency: configurationMutationConcurrency,
    }),
    exportCursorJson: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:export-cursor-json",
      tag: WS_METHODS.mcpExportCursorJson,
    }),
    providerStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:provider-status",
      tag: WS_METHODS.mcpProviderStatus,
    }),
    sessionAccess,
    runtimeContexts: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:runtime-contexts",
      tag: WS_METHODS.mcpRuntimeContexts,
    }),
    runtimeContextChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mcp:runtime-context-changes",
      tag: WS_METHODS.mcpRuntimeContextChanges,
      idleTtlMs: liveIdleTtlMs,
    }),
    runtimeContextProjection: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: EnvironmentRpcInput<typeof WS_METHODS.mcpRuntimeContextChanges>;
    }) =>
      runtimeContextProjection({
        environmentId: target.environmentId,
        input: { providerInstanceId: target.input.providerInstanceId },
      }),
    runtimeSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:runtime-snapshot",
      tag: WS_METHODS.mcpRuntimeSnapshot,
    }),
    runtimeChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mcp:runtime-changes",
      tag: WS_METHODS.mcpRuntimeChanges,
      idleTtlMs: liveIdleTtlMs,
    }),
    runtimeProjection: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: EnvironmentRpcInput<typeof WS_METHODS.mcpRuntimeChanges>;
    }) =>
      runtimeProjection({
        environmentId: target.environmentId,
        input: runtimeInput(target.input),
      }),
    runtimeServerDetails: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:runtime-server-details",
      tag: WS_METHODS.mcpRuntimeServerDetails,
    }),
    runtimeServerDetailsQuery: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: McpRuntimeServerDetailsInput;
    }) =>
      runtimeServerDetailsQuery({
        environmentId: target.environmentId,
        input: detailsInput(target.input),
      }),
    runtimeAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mcp:runtime-action",
      tag: WS_METHODS.mcpRuntimeAction,
      scheduler: runtimeActionScheduler,
      concurrency: runtimeActionConcurrency,
    }),
  };
}
