import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  McpServerId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpLiveApplyResult,
  type McpServerDefinition,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  affectedMcpProviderInstanceIds,
  makeMcpConfigurationReconcilerCore,
  type McpConfigurationReconcileInput,
} from "./McpConfigurationReconciler.ts";
import { makeMcpConfigurationReconcilerLayer } from "./McpConfigurationReconcilerLive.ts";

const providerA = ProviderInstanceId.make("codex_work");
const providerB = ProviderInstanceId.make("codex_personal");

function server(input: {
  readonly id: string;
  readonly enabled?: boolean;
  readonly providerInstanceIds?: ReadonlyArray<typeof providerA>;
  readonly projectCwd?: string;
}): McpServerDefinition {
  return {
    id: McpServerId.make(input.id),
    name: input.id,
    enabled: input.enabled ?? true,
    providerRouting:
      input.providerInstanceIds === undefined
        ? { mode: "all" }
        : { mode: "selected", instanceIds: input.providerInstanceIds },
    scope: input.projectCwd === undefined ? "global" : "project",
    ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
    transport: "http",
    url: `https://${input.id}.example.com/mcp`,
    headers: {},
  };
}

function settings(servers: ReadonlyArray<McpServerDefinition>): ServerSettings {
  return {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [providerA]: { driver: "codex", enabled: true, config: {} },
      [providerB]: { driver: "codex", enabled: true, config: {} },
    },
    mcp: { servers },
  };
}

describe("McpConfigurationReconciler", () => {
  it("targets the provider union for create, update, delete, assignment, master toggle, and import", () => {
    const empty = settings([]);
    const global = server({ id: "global" });
    const selectedA = server({ id: "selected", providerInstanceIds: [providerA] });
    const selectedB = server({ id: "selected", providerInstanceIds: [providerB] });

    expect(affectedMcpProviderInstanceIds(empty, settings([global]))).toEqual(
      expect.arrayContaining([providerA, providerB]),
    );
    expect(affectedMcpProviderInstanceIds(settings([selectedA]), settings([selectedB]))).toEqual([
      providerB,
      providerA,
    ]);
    expect(affectedMcpProviderInstanceIds(settings([selectedA]), empty)).toEqual([providerA]);
    expect(
      affectedMcpProviderInstanceIds(
        settings([selectedA]),
        settings([{ ...selectedA, enabled: false }]),
      ),
    ).toEqual([providerA]);
    expect(
      affectedMcpProviderInstanceIds(
        empty,
        settings([
          server({ id: "import_a", providerInstanceIds: [providerA] }),
          server({ id: "import_b", providerInstanceIds: [providerB] }),
        ]),
      ),
    ).toEqual([providerB, providerA]);
  });

  it.effect(
    "reconciles each affected provider once with the complete previous and desired catalogs",
    () =>
      Effect.gen(function* () {
        const previous = settings([
          server({ id: "old_project", providerInstanceIds: [providerA], projectCwd: "/old" }),
        ]);
        const desired = settings([
          server({ id: "new_project", providerInstanceIds: [providerB], projectCwd: "/new" }),
          server({ id: "shared" }),
        ]);
        const current = yield* Ref.make(previous);
        const calls: McpConfigurationReconcileInput[] = [];
        const reconciler = yield* makeMcpConfigurationReconcilerCore({
          initialSettings: previous,
          readSettings: Ref.get(current),
          reconcileConfiguration: (input) => {
            calls.push(input);
            return Effect.succeed([]);
          },
        });

        yield* Ref.set(current, desired);
        yield* reconciler.reconcileCurrent;

        expect(calls.map((call) => call.providerInstanceId)).toEqual(
          expect.arrayContaining([providerA, providerB]),
        );
        expect(calls).toHaveLength(
          new Set([...Object.keys(desired.providers), ...Object.keys(desired.providerInstances)])
            .size,
        );
        expect(new Set(calls.map((call) => call.generation))).toEqual(new Set([1]));
        for (const call of calls) {
          expect(call.previousServers.map((candidate) => candidate.id)).toEqual(["old_project"]);
          expect(call.desiredServers.map((candidate) => candidate.id)).toEqual([
            "new_project",
            "shared",
          ]);
        }
      }),
  );

  it.effect("lets a newer generation start while an older live apply is still pending", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initial = settings([]);
        const first = settings([server({ id: "first", providerInstanceIds: [providerA] })]);
        const second = settings([server({ id: "second", providerInstanceIds: [providerA] })]);
        const current = yield* Ref.make(initial);
        const firstRelease = yield* Deferred.make<void>();
        const calls: McpConfigurationReconcileInput[] = [];
        const reconciler = yield* makeMcpConfigurationReconcilerCore({
          initialSettings: initial,
          readSettings: Ref.get(current),
          reconcileConfiguration: (input) => {
            calls.push(input);
            return input.generation === 1
              ? Deferred.await(firstRelease).pipe(Effect.as([]))
              : Effect.succeed([]);
          },
        });

        yield* Ref.set(current, first);
        const firstFiber = yield* reconciler.reconcileCurrent.pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Ref.set(current, second);
        yield* reconciler.reconcileCurrent;

        expect(calls.map((call) => call.generation)).toEqual([1, 2]);
        yield* Deferred.succeed(firstRelease, undefined);
        yield* Fiber.join(firstFiber);
      }),
    ),
  );

  it.effect("preserves provider-specific applied, pending, unsupported, and failed results", () =>
    Effect.gen(function* () {
      const initial = settings([]);
      const desired = settings([server({ id: "global" })]);
      const current = yield* Ref.make(initial);
      const outcomes: ReadonlyArray<McpLiveApplyResult["outcome"]> = [
        "applied",
        "pending-next-session",
        "unsupported",
        "failed",
      ];
      let callIndex = 0;
      const reconciler = yield* makeMcpConfigurationReconcilerCore({
        initialSettings: initial,
        readSettings: Ref.get(current),
        reconcileConfiguration: (_input) => {
          const outcome = outcomes[callIndex % outcomes.length]!;
          callIndex += 1;
          return Effect.succeed([
            {
              threadId: ThreadId.make(`thread-${callIndex}`),
              runtimeSessionId: RuntimeSessionId.make(`runtime-${callIndex}`),
              outcome,
            },
          ]);
        },
      });

      yield* Ref.set(current, desired);
      const results = yield* reconciler.reconcileCurrent;

      expect(new Set(results.map((result) => result.outcome))).toEqual(new Set(outcomes));
      expect(results.every((result) => result.providerInstanceId !== undefined)).toBe(true);
    }),
  );

  it.effect("reconciles catalog changes made outside the MCP config engine", () =>
    Effect.gen(function* () {
      const applied = yield* Deferred.make<McpConfigurationReconcileInput>();
      const settingsLayer = ServerSettingsService.layerTest();
      const reconcilerLayer = makeMcpConfigurationReconcilerLayer({
        reconcileConfiguration: (input) => Deferred.succeed(applied, input).pipe(Effect.as([])),
        providerCapability: () => Effect.succeed("nativeConfig"),
      }).pipe(Layer.provideMerge(settingsLayer));

      const observed = yield* Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        yield* serverSettings.updateSettings({
          mcp: { servers: [server({ id: "external_change" })] },
        });
        return yield* Deferred.await(applied);
      }).pipe(Effect.provide(reconcilerLayer), Effect.scoped);

      expect(observed.generation).toBe(1);
      expect(observed.desiredServers.map((candidate) => candidate.id)).toEqual(["external_change"]);
    }),
  );
});
