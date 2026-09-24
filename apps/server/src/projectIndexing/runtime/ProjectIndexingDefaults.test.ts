// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, type ProjectIndexDefaults } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { openExistingKnowledgeKvStore } from "../persistence/KnowledgeStoreKv.ts";
import { resolveKnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import type { ProjectIndexingBridgeShape } from "./ProjectIndexingBridge.ts";
import { encodeProjectIndexJson } from "./ProjectIndexingErrors.ts";
import { liveProjectIndexExtraction } from "./ProjectIndexingExtraction.ts";
import { makeProjectIndexingRuntime } from "./ProjectIndexingRuntime.ts";

const projectId = ProjectId.make("static-defaults");
const firstModel = { instanceId: ProviderInstanceId.make("defaults-provider"), model: "first" };
const secondModel = { ...firstModel, model: "second" };

const makeHarness = Effect.fn("StaticDefaultsTest.makeHarness")(function* (
  initialDefaults: ProjectIndexDefaults,
) {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const directory = await NodeFSP.mkdtemp(
        NodePath.join(NodeOS.tmpdir(), "t3-static-defaults-"),
      );
      await NodeFSP.writeFile(
        NodePath.join(directory, "source.ts"),
        "export function fixture() { return 1; }\n",
      );
      return directory;
    }),
    (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
  const workspace = yield* resolveKnowledgeWorkspace(root);
  const resolved = {
    workspaceRoot: workspace.workspaceRoot,
    scope: {
      scopeId: "scope:" + workspace.workspaceId,
      workspaceFingerprint: workspace.workspaceId,
      projectId,
    },
  };
  const currentDefaults = yield* Ref.make(initialDefaults);
  const changes = yield* PubSub.unbounded<ProjectIndexDefaults>();
  let modelCalls = 0;
  let watched = 0;
  let gate: {
    readonly entered: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  } | null = null;
  const bridge: ProjectIndexingBridgeShape = {
    resolveScope: () => Effect.succeed(resolved),
    listScopes: () => Effect.succeed([resolved]),
    capabilities: () =>
      Effect.sync(() => {
        modelCalls++;
        return { contextWindowTokens: 128_000, maxOutputTokens: 4_096 };
      }),
    generate: () =>
      Effect.sync(() => {
        modelCalls++;
        return { text: "{}" };
      }),
    admit: () =>
      Effect.sync(() => {
        modelCalls++;
        return { release: Effect.void };
      }),
    readDiff: () => Effect.succeed({ diff: "", files: [] }),
    reconcileWatchers: (scopes) =>
      Effect.sync(() => {
        watched = scopes.length;
      }),
  };
  const runtime = yield* makeProjectIndexingRuntime({
    bridge,
    defaults: {
      get: Ref.get(currentDefaults),
      subscribe: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
    },
    extraction: {
      ...liveProjectIndexExtraction,
      resolveBatches: () => Stream.empty,
      resolve: () => Effect.succeed({}),
      extract: (workspaceRoot, file) =>
        Effect.gen(function* () {
          const currentGate = gate;
          if (file.path === "source.ts" && currentGate !== null) {
            yield* Deferred.succeed(currentGate.entered, undefined);
            yield* Deferred.await(currentGate.release);
          }
          return yield* liveProjectIndexExtraction.extract(workspaceRoot, file);
        }),
    },
  });
  const applyDefaults = Effect.fn("StaticDefaultsTest.applyDefaults")(function* (
    next: ProjectIndexDefaults,
  ) {
    const subscription = yield* runtime.subscribe({ projectId });
    const handled = yield* subscription.pipe(
      Stream.filter(
        (event) =>
          event.type === "status" &&
          encodeProjectIndexJson(event.status.defaults) === encodeProjectIndexJson(next),
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* Ref.set(currentDefaults, next);
    yield* PubSub.publish(changes, next);
    yield* Fiber.join(handled);
  });
  return {
    root,
    runtime,
    modelCalls: () => modelCalls,
    watched: () => watched,
    applyDefaults,
    holdExtraction: Effect.gen(function* () {
      gate = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      return gate;
    }),
  };
});

it.live(
  "inherits a review model without requiring it for indexing or changing the saved selection",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ enabled: true, modelSelection: firstModel });
        yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
        yield* harness.runtime.start({ projectId });
        const completed = yield* harness.runtime.drain({ projectId });
        assert.isTrue(completed.state === "ready" || completed.state === "partial");
        assert.isNull(completed.settings.modelSelection);
        assert.isNull(completed.job?.modelSelection);
        assert.strictEqual(harness.modelCalls(), 0);
        assert.strictEqual(harness.watched(), 1);

        yield* harness.applyDefaults({ enabled: true, modelSelection: secondModel });
        const afterModelChange = yield* harness.runtime.getStatus({ projectId });
        assert.strictEqual(afterModelChange.revision, completed.revision);
        assert.isNull(afterModelChange.settings.modelSelection);
        assert.strictEqual(afterModelChange.defaults?.modelSelection?.model, "second");
        assert.strictEqual(harness.modelCalls(), 0);
      }),
    ),
);

it.live("global disable pauses active static indexing and resume works after re-enable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ enabled: true, modelSelection: null });
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      const gate = yield* harness.holdExtraction;
      yield* harness.runtime.start({ projectId });
      yield* Deferred.await(gate.entered);
      yield* harness.applyDefaults({ enabled: false, modelSelection: null });
      const disabled = yield* harness.runtime.getStatus({ projectId });
      assert.strictEqual(disabled.state, "disabled");
      assert.strictEqual(harness.watched(), 0);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: harness.root });
      assert.isNotNull(reader);
      assert.strictEqual((yield* reader!.getState()).status, "paused");
      assert.isNull((yield* reader!.getState()).publishedRevision);

      yield* harness.applyDefaults({ enabled: true, modelSelection: null });
      assert.strictEqual((yield* harness.runtime.getStatus({ projectId })).state, "paused");
      yield* harness.runtime.control({ projectId, action: "resume" });
      yield* Deferred.succeed(gate.release, undefined);
      const completed = yield* harness.runtime.drain({ projectId });
      assert.isTrue(completed.state === "ready" || completed.state === "partial");
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("review remains opt-in and requires a model even when indexing is ready", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ enabled: true, modelSelection: null });
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      yield* harness.runtime.start({ projectId });
      yield* harness.runtime.drain({ projectId });
      assert.strictEqual(
        (yield* harness.runtime.review({ projectId }).pipe(Effect.flip)).code,
        "disabled",
      );
      yield* harness.runtime.updateSettings({
        projectId,
        patch: { reviewEnabled: true, modelSelection: null },
      });
      assert.strictEqual(
        (yield* harness.runtime.review({ projectId }).pipe(Effect.flip)).code,
        "model-required",
      );
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);
