import type {
  McpLiveApplyResult,
  McpProviderCapability,
  McpServerDefinition,
  McpServerId,
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Ref from "effect/Ref";

export interface McpConfigurationReconcileInput {
  readonly generation: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly previousServers: ReadonlyArray<McpServerDefinition>;
  readonly desiredServers: ReadonlyArray<McpServerDefinition>;
}

export interface McpConfigurationReconcilerShape {
  readonly reconcileCurrent: Effect.Effect<ReadonlyArray<McpLiveApplyResult>, ServerSettingsError>;
  readonly providerCapability: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<McpProviderCapability>;
}

export class McpConfigurationReconciler extends Context.Service<
  McpConfigurationReconciler,
  McpConfigurationReconcilerShape
>()("t3/mcp/McpConfigurationReconciler") {}

interface ReconcilerState {
  readonly settings: ServerSettings;
  readonly generation: number;
  readonly active:
    | {
        readonly generation: number;
        readonly completion: Deferred.Deferred<ReadonlyArray<McpLiveApplyResult>>;
      }
    | undefined;
  readonly latestResults: ReadonlyArray<McpLiveApplyResult>;
}

type ReconcileDecision =
  | {
      readonly type: "complete";
      readonly results: ReadonlyArray<McpLiveApplyResult>;
    }
  | {
      readonly type: "await";
      readonly completion: Deferred.Deferred<ReadonlyArray<McpLiveApplyResult>>;
    }
  | {
      readonly type: "run";
      readonly previous: ServerSettings;
      readonly desired: ServerSettings;
      readonly generation: number;
      readonly completion: Deferred.Deferred<ReadonlyArray<McpLiveApplyResult>>;
    };

function configuredProviderInstanceIds(
  settings: ServerSettings,
): ReadonlyArray<ProviderInstanceId> {
  return [
    ...new Set(
      [...Object.keys(settings.providers), ...Object.keys(settings.providerInstances)].map(
        (instanceId) => instanceId as ProviderInstanceId,
      ),
    ),
  ].sort();
}

function routedProviderInstanceIds(
  server: McpServerDefinition,
  settings: ServerSettings,
): ReadonlyArray<ProviderInstanceId> {
  return server.providerRouting.mode === "all"
    ? configuredProviderInstanceIds(settings)
    : server.providerRouting.instanceIds;
}

function changedServerIds(
  previous: ReadonlyArray<McpServerDefinition>,
  desired: ReadonlyArray<McpServerDefinition>,
): ReadonlyArray<McpServerId> {
  const previousById = new Map(previous.map((server) => [server.id, server]));
  const desiredById = new Map(desired.map((server) => [server.id, server]));
  return [...new Set([...previousById.keys(), ...desiredById.keys()])].filter(
    (id) => !Equal.equals(previousById.get(id), desiredById.get(id)),
  );
}

export function affectedMcpProviderInstanceIds(
  previous: ServerSettings,
  desired: ServerSettings,
): ReadonlyArray<ProviderInstanceId> {
  const previousById = new Map(previous.mcp.servers.map((server) => [server.id, server]));
  const desiredById = new Map(desired.mcp.servers.map((server) => [server.id, server]));
  const affected = new Set<ProviderInstanceId>();

  for (const id of changedServerIds(previous.mcp.servers, desired.mcp.servers)) {
    const before = previousById.get(id);
    const after = desiredById.get(id);
    if (before !== undefined) {
      for (const providerInstanceId of routedProviderInstanceIds(before, previous)) {
        affected.add(providerInstanceId);
      }
    }
    if (after !== undefined) {
      for (const providerInstanceId of routedProviderInstanceIds(after, desired)) {
        affected.add(providerInstanceId);
      }
    }
  }

  return [...affected].sort();
}

export function makeMcpConfigurationReconcilerCore(input: {
  readonly initialSettings: ServerSettings;
  readonly readSettings: Effect.Effect<ServerSettings, ServerSettingsError>;
  readonly reconcileConfiguration: (
    input: McpConfigurationReconcileInput,
  ) => Effect.Effect<ReadonlyArray<McpLiveApplyResult>>;
  readonly providerCapability?:
    | ((providerInstanceId: ProviderInstanceId) => Effect.Effect<McpProviderCapability>)
    | undefined;
}): Effect.Effect<McpConfigurationReconcilerShape> {
  return Effect.gen(function* () {
    const state = yield* Ref.make<ReconcilerState>({
      settings: input.initialSettings,
      generation: 0,
      active: undefined,
      latestResults: [],
    });

    const reconcileCurrent = Effect.gen(function* () {
      const desired = yield* input.readSettings;
      const completion = yield* Deferred.make<ReadonlyArray<McpLiveApplyResult>>();
      const decision = yield* Ref.modify(
        state,
        (current): readonly [ReconcileDecision, ReconcilerState] => {
          if (Equal.equals(current.settings.mcp.servers, desired.mcp.servers)) {
            if (current.active !== undefined) {
              return [{ type: "await", completion: current.active.completion }, current] as const;
            }
            return [{ type: "complete", results: current.latestResults }, current] as const;
          }

          const generation = current.generation + 1;
          return [
            {
              type: "run",
              previous: current.settings,
              desired,
              generation,
              completion,
            },
            {
              settings: desired,
              generation,
              active: { generation, completion },
              latestResults: current.latestResults,
            },
          ] as const;
        },
      );

      if (decision.type === "complete") {
        return decision.results;
      }
      if (decision.type === "await") {
        return yield* Deferred.await(decision.completion);
      }

      const providerInstanceIds = affectedMcpProviderInstanceIds(
        decision.previous,
        decision.desired,
      );
      const results = (yield* Effect.forEach(
        providerInstanceIds,
        (providerInstanceId) =>
          input
            .reconcileConfiguration({
              generation: decision.generation,
              providerInstanceId,
              previousServers: decision.previous.mcp.servers,
              desiredServers: decision.desired.mcp.servers,
            })
            .pipe(
              Effect.map((providerResults) =>
                providerResults.map((result) => ({
                  ...result,
                  providerInstanceId: result.providerInstanceId ?? providerInstanceId,
                })),
              ),
            ),
        { concurrency: "unbounded" },
      )).flat();

      yield* Deferred.succeed(decision.completion, results);
      yield* Ref.update(state, (current) =>
        current.active?.generation === decision.generation
          ? { ...current, active: undefined, latestResults: results }
          : current,
      );
      return results;
    });

    return {
      reconcileCurrent,
      providerCapability:
        input.providerCapability ?? (() => Effect.succeed("unsupported" as const)),
    } satisfies McpConfigurationReconcilerShape;
  });
}
