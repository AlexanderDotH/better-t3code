import type {
  McpRuntimeActionInput,
  McpRuntimeError,
  McpRuntimeServer,
  McpRuntimeServerDetailsInput,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type { ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import type { RuntimeEntry } from "./McpRuntimeContextState.ts";
import { runtimeContextKey } from "./McpRuntimeContextState.ts";
import {
  makeMcpRuntimeError,
  MAX_RUNTIME_INVENTORY_DETAILS,
  mcpRuntimeErrorDetail,
  sanitizeMcpRuntimeResource,
  sanitizeMcpRuntimeResourceTemplate,
  sanitizeMcpRuntimeTool,
} from "./McpRuntimeProjection.ts";
import { sanitizeMcpRuntimeText } from "./McpRuntimeSanitizer.ts";

export interface McpRuntimeActionCoordinatorDependencies {
  readonly requireEntry: (
    input: McpRuntimeSnapshotInput,
    requireActive: boolean,
  ) => Effect.Effect<RuntimeEntry, McpRuntimeError>;
  readonly adapterFor: (
    providerInstanceId: McpRuntimeSnapshotInput["providerInstanceId"],
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, McpRuntimeError>;
  readonly refresh: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly upsertServer: (
    input: McpRuntimeSnapshotInput,
    server: McpRuntimeServer,
  ) => Effect.Effect<McpRuntimeServer, McpRuntimeError>;
}

export const makeMcpRuntimeActionCoordinator = Effect.fn("makeMcpRuntimeActionCoordinator")(
  function* (dependencies: McpRuntimeActionCoordinatorDependencies) {
    const actionMutexes = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());

    const withActionLock = <A, E, R>(
      input: McpRuntimeActionInput,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const key = `${runtimeContextKey(input)}\u0000${input.providerKey}`;
        const candidate = yield* Semaphore.make(1);
        const mutex = yield* Ref.modify(actionMutexes, (current) => {
          const existing = current.get(key);
          if (existing) return [existing, current] as const;
          const next = new Map(current);
          next.set(key, candidate);
          return [candidate, next] as const;
        });
        return yield* mutex.withPermits(1)(effect);
      });

    const getServerDetails = (input: McpRuntimeServerDetailsInput) =>
      Effect.gen(function* () {
        const current = yield* dependencies.requireEntry(input, true);
        const server = current.servers.get(input.providerKey);
        if (server === undefined) {
          return yield* makeMcpRuntimeError(
            "server-not-found",
            `MCP server '${input.providerKey}' is not present in this runtime.`,
          );
        }
        const adapter = yield* dependencies.adapterFor(input.providerInstanceId);
        const readDetails = adapter.mcpRuntime?.getServerDetails;
        if (readDetails === undefined) {
          return { server, tools: [], resources: [], templates: [] };
        }
        const details = yield* readDetails(input).pipe(
          Effect.mapError((error) =>
            makeMcpRuntimeError(
              "provider-error",
              `Could not read MCP inventory: ${mcpRuntimeErrorDetail(error)}`,
            ),
          ),
        );
        const safeServer = yield* dependencies.upsertServer(input, details.server);
        return {
          server: safeServer,
          tools: details.tools.slice(0, MAX_RUNTIME_INVENTORY_DETAILS).map(sanitizeMcpRuntimeTool),
          resources: details.resources
            .slice(0, MAX_RUNTIME_INVENTORY_DETAILS)
            .map(sanitizeMcpRuntimeResource),
          templates: details.templates
            .slice(0, MAX_RUNTIME_INVENTORY_DETAILS)
            .map(sanitizeMcpRuntimeResourceTemplate),
        };
      });

    const runAction = (input: McpRuntimeActionInput) =>
      withActionLock(
        input,
        Effect.gen(function* () {
          const current = yield* dependencies.requireEntry(input, true);
          const server = current.servers.get(input.providerKey);
          if (server === undefined) {
            return yield* makeMcpRuntimeError(
              "server-not-found",
              `MCP server '${input.providerKey}' is not present in this runtime.`,
            );
          }
          if (!server.availableActions.includes(input.action)) {
            return yield* makeMcpRuntimeError(
              input.action === "authorize" ? "authorization-unavailable" : "action-unsupported",
              `MCP action '${input.action}' is not supported for '${input.providerKey}'.`,
            );
          }
          const adapter = yield* dependencies.adapterFor(input.providerInstanceId);
          if (input.action === "refresh") {
            yield* dependencies.refresh(input);
            return { accepted: true, action: input.action, providerKey: input.providerKey };
          }
          const execute = adapter.mcpRuntime?.runAction;
          if (execute === undefined) {
            return yield* makeMcpRuntimeError(
              "action-unsupported",
              `Provider '${adapter.provider}' does not expose MCP runtime actions.`,
            );
          }
          const result = yield* execute(input).pipe(
            Effect.mapError((error) =>
              makeMcpRuntimeError(
                "provider-error",
                `MCP action failed: ${mcpRuntimeErrorDetail(error)}`,
              ),
            ),
          );
          if (result.accepted) yield* dependencies.refresh(input);
          return {
            accepted: result.accepted,
            action: input.action,
            providerKey: input.providerKey,
            ...(result.authorizationUrl === undefined
              ? {}
              : { authorizationUrl: result.authorizationUrl }),
            ...(result.message === undefined
              ? {}
              : { message: sanitizeMcpRuntimeText(result.message) }),
          };
        }),
      );

    return { getServerDetails, runAction };
  },
);
