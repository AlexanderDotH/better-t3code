import type {
  McpLiveApplyResult,
  McpRuntimeError,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
  McpServerDefinition,
  McpSetProviderEnabledInput,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type { ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import {
  isServerAssignedToProvider,
  isServerInRuntimeScope,
  isSingleConfigurationChangeReflected,
  resolveConfigurationTransition,
  runtimeTarget,
  unconfirmedConfiguration,
} from "./McpRuntimeConfigurationPolicy.ts";
import type { McpRuntimeConfigurationReconcileInput } from "./McpRuntimeConfigurationTypes.ts";
import type { RuntimeEntry } from "./McpRuntimeContextState.ts";
import { mcpRuntimeErrorDetail } from "./McpRuntimeProjection.ts";

export interface McpRuntimeConfigurationCoordinatorDependencies {
  readonly state: Ref.Ref<ReadonlyMap<string, RuntimeEntry>>;
  readonly adapterFor: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, McpRuntimeError>;
  readonly refresh: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly markConfigurationDrift: (
    target: McpRuntimeSnapshotInput,
    input: McpSetProviderEnabledInput,
    definition?: McpServerDefinition,
  ) => Effect.Effect<void>;
  readonly markConfigurationSetDrift: (
    target: McpRuntimeSnapshotInput,
    enableDefinitions: ReadonlyArray<McpServerDefinition>,
    disableDefinitions: ReadonlyArray<McpServerDefinition>,
  ) => Effect.Effect<void>;
}

export const makeMcpRuntimeConfigurationCoordinator = Effect.fn(
  "makeMcpRuntimeConfigurationCoordinator",
)(function* (dependencies: McpRuntimeConfigurationCoordinatorDependencies) {
  const configurationGenerations = yield* Ref.make<ReadonlyMap<ProviderInstanceId, number>>(
    new Map(),
  );
  const configurationMutex = yield* Semaphore.make(1);

  const applyConfiguration = (input: McpSetProviderEnabledInput, server?: McpServerDefinition) =>
    Effect.gen(function* () {
      const providerInstanceId = input.providerInstanceId;
      const entries = Array.from((yield* Ref.get(dependencies.state)).values()).filter(
        (entry) =>
          entry.context.providerInstanceId === providerInstanceId &&
          entry.context.state === "active" &&
          isServerInRuntimeScope(server, entry),
      );
      const adapterResult = yield* Effect.exit(dependencies.adapterFor(providerInstanceId));
      if (adapterResult._tag === "Failure") {
        return yield* Effect.forEach(entries, (entry) => {
          const target = runtimeTarget(entry);
          return dependencies.markConfigurationDrift(target, input, server).pipe(
            Effect.as({
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              outcome: "failed" as const,
              message: mcpRuntimeErrorDetail(Cause.squash(adapterResult.cause)),
            } satisfies McpLiveApplyResult),
          );
        });
      }
      const adapter = adapterResult.value;
      const apply = adapter.mcpRuntime?.applyConfiguration;
      if (apply === undefined) {
        const outcome: McpLiveApplyResult["outcome"] =
          adapter.capabilities.mcp === "unsupported" ? "unsupported" : "pending-next-session";
        return yield* Effect.forEach(entries, (entry) => {
          const target = runtimeTarget(entry);
          const markDrift =
            outcome === "pending-next-session"
              ? dependencies.markConfigurationDrift(target, input, server)
              : Effect.void;
          return markDrift.pipe(
            Effect.as({
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              outcome,
            } satisfies McpLiveApplyResult),
          );
        });
      }
      return yield* Effect.forEach(entries, (entry) => {
        const target = runtimeTarget(entry);
        return apply(target).pipe(
          Effect.flatMap((adapterOutcome) =>
            Effect.gen(function* () {
              const outcome: McpLiveApplyResult["outcome"] = adapterOutcome ?? "applied";
              if (outcome !== "applied") {
                if (outcome === "pending-next-session") {
                  yield* dependencies.markConfigurationDrift(target, input, server);
                }
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }
              const refreshed = yield* Effect.exit(dependencies.refresh(target));
              if (refreshed._tag === "Failure") {
                yield* dependencies.markConfigurationDrift(target, input, server);
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session",
                  message: "The provider did not confirm the live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }
              if (
                !isSingleConfigurationChangeReflected({
                  snapshot: refreshed.value,
                  change: input,
                  ...(server === undefined ? {} : { definition: server }),
                })
              ) {
                yield* dependencies.markConfigurationDrift(target, input, server);
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session",
                  message: "The provider will use this MCP assignment in the next session.",
                } satisfies McpLiveApplyResult;
              }
              return {
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "applied",
              } satisfies McpLiveApplyResult;
            }),
          ),
          Effect.catch((error: ProviderAdapterError) =>
            dependencies.markConfigurationDrift(target, input, server).pipe(
              Effect.as({
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "failed" as const,
                message: mcpRuntimeErrorDetail(error),
              } satisfies McpLiveApplyResult),
            ),
          ),
        );
      });
    });

  const reconcileConfiguration = (input: McpRuntimeConfigurationReconcileInput) =>
    Effect.gen(function* () {
      const accepted = yield* Ref.modify(configurationGenerations, (current) => {
        const latest = current.get(input.providerInstanceId) ?? -1;
        if (input.generation < latest) return [false, current] as const;
        const next = new Map(current);
        next.set(input.providerInstanceId, input.generation);
        return [true, next] as const;
      });
      if (!accepted) return [];
      return yield* configurationMutex.withPermits(1)(
        Effect.gen(function* () {
          const isCurrentGeneration = Effect.map(
            Ref.get(configurationGenerations),
            (generations) => generations.get(input.providerInstanceId) === input.generation,
          );
          if (!(yield* isCurrentGeneration)) return [];
          const entries = Array.from((yield* Ref.get(dependencies.state)).values()).filter(
            (entry) =>
              entry.context.providerInstanceId === input.providerInstanceId &&
              entry.context.state === "active" &&
              [...input.previousServers, ...input.desiredServers].some(
                (server) =>
                  isServerAssignedToProvider(server, input.providerInstanceId) &&
                  isServerInRuntimeScope(server, entry),
              ),
          );
          const adapterResult = yield* Effect.exit(
            dependencies.adapterFor(input.providerInstanceId),
          );
          if (adapterResult._tag === "Failure") {
            if (!(yield* isCurrentGeneration)) return [];
            return yield* Effect.forEach(entries, (entry) => {
              const target = runtimeTarget(entry);
              const transition = resolveConfigurationTransition(input, entry);
              return dependencies
                .markConfigurationSetDrift(target, transition.enable, transition.disable)
                .pipe(
                  Effect.as({
                    providerInstanceId: input.providerInstanceId,
                    threadId: target.threadId,
                    runtimeSessionId: target.runtimeSessionId,
                    outcome: "failed" as const,
                    message: mcpRuntimeErrorDetail(Cause.squash(adapterResult.cause)),
                  } satisfies McpLiveApplyResult),
                );
            });
          }
          const adapter = adapterResult.value;
          const apply = adapter.mcpRuntime?.applyConfiguration;
          return yield* Effect.forEach(entries, (entry) =>
            Effect.gen(function* () {
              const target = runtimeTarget(entry);
              const transition = resolveConfigurationTransition(input, entry);
              if (apply === undefined) {
                const outcome: McpLiveApplyResult["outcome"] =
                  adapter.capabilities.mcp === "unsupported"
                    ? "unsupported"
                    : "pending-next-session";
                if (outcome === "pending-next-session") {
                  yield* dependencies.markConfigurationSetDrift(
                    target,
                    transition.enable,
                    transition.disable,
                  );
                }
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }
              const applied = yield* Effect.exit(apply(target));
              if (!(yield* isCurrentGeneration)) return undefined;
              if (applied._tag === "Failure") {
                yield* dependencies.markConfigurationSetDrift(
                  target,
                  transition.enable,
                  transition.disable,
                );
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "failed" as const,
                  message: mcpRuntimeErrorDetail(Cause.squash(applied.cause)),
                } satisfies McpLiveApplyResult;
              }
              const outcome = applied.value ?? "applied";
              if (outcome !== "applied") {
                if (outcome === "pending-next-session") {
                  yield* dependencies.markConfigurationSetDrift(
                    target,
                    transition.enable,
                    transition.disable,
                  );
                }
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }
              const refreshed = yield* Effect.exit(dependencies.refresh(target));
              if (!(yield* isCurrentGeneration)) return undefined;
              if (refreshed._tag === "Failure") {
                yield* dependencies.markConfigurationSetDrift(
                  target,
                  transition.enable,
                  transition.disable,
                );
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session" as const,
                  message: "The provider did not confirm the complete live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }
              const unconfirmed = unconfirmedConfiguration({
                snapshot: refreshed.value,
                transition,
              });
              if (unconfirmed.missing.length > 0 || unconfirmed.unexpected.length > 0) {
                yield* dependencies.markConfigurationSetDrift(
                  target,
                  unconfirmed.missing,
                  unconfirmed.unexpected,
                );
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session" as const,
                  message: "The provider did not confirm the complete live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }
              return {
                providerInstanceId: input.providerInstanceId,
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "applied" as const,
              } satisfies McpLiveApplyResult;
            }),
          ).pipe(Effect.map((results) => results.filter((result) => result !== undefined)));
        }),
      );
    });

  return { applyConfiguration, reconcileConfiguration };
});
