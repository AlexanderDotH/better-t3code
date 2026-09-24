// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import {
  openExistingKnowledgeKvStore,
  openKnowledgeKvStore,
} from "../persistence/KnowledgeStoreKv.ts";
import { resolveKnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import type { ProjectIndexingBridgeShape } from "./ProjectIndexingBridge.ts";
import { encodeProjectIndexJson } from "./ProjectIndexingErrors.ts";
import { liveProjectIndexExtraction } from "./ProjectIndexingExtraction.ts";
import { initialProjectIndexGenerationMetadata } from "./ProjectIndexingMetadata.ts";
import { makeProjectIndexingRuntime } from "./ProjectIndexingRuntime.ts";

const projectId = ProjectId.make("static-runtime");
const reviewModel = {
  instanceId: ProviderInstanceId.make("review-provider"),
  model: "review-only",
};
const source = "export function fixture() { return 1; }\n";
const sourceHash = NodeCrypto.createHash("sha256").update(source).digest("hex");

const temporaryWorkspace = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-static-runtime-"));
    await NodeFSP.writeFile(NodePath.join(root, "source.ts"), source);
    return root;
  }),
  (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
);

const makeHarness = Effect.fn("StaticRuntimeTest.makeHarness")(function* (root: string) {
  const workspace = yield* resolveKnowledgeWorkspace(root);
  const resolved = {
    workspaceRoot: workspace.workspaceRoot,
    scope: {
      scopeId: "scope:" + workspace.workspaceId,
      workspaceFingerprint: workspace.workspaceId,
      projectId,
    },
  };
  let modelCalls = 0;
  let watched = 0;
  const extractedFiles: string[] = [];
  const resolvedFiles: string[] = [];
  let gate: {
    readonly entered: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
    readonly afterExtraction: boolean;
  } | null = null;
  let watcher: (() => Effect.Effect<void, Error>) | null = null;
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
    reconcileWatchers: (scopes, onChange) =>
      Effect.sync(() => {
        watched = scopes.length;
        watcher = () => onChange(scopes);
      }),
  };
  const runtime = yield* makeProjectIndexingRuntime({
    bridge,
    extraction: {
      scan: liveProjectIndexExtraction.scan,
      readSource: liveProjectIndexExtraction.readSource,
      resolve: ({ files }) =>
        Effect.sync(() => {
          resolvedFiles.push(...files.map((file) => file.path));
          return {};
        }),
      extract: (workspaceRoot, file) =>
        Effect.gen(function* () {
          extractedFiles.push(file.path);
          const currentGate = gate;
          if (file.path === "source.ts" && currentGate !== null && !currentGate.afterExtraction) {
            yield* Deferred.succeed(currentGate.entered, undefined);
            yield* Deferred.await(currentGate.release);
          }
          const batch = yield* liveProjectIndexExtraction.extract(workspaceRoot, file);
          if (file.path === "source.ts" && currentGate?.afterExtraction) {
            yield* Deferred.succeed(currentGate.entered, undefined);
            yield* Deferred.await(currentGate.release);
          }
          return batch;
        }),
    },
  });
  return {
    runtime,
    resolved,
    extractedFiles,
    resolvedFiles,
    modelCalls: () => modelCalls,
    watched: () => watched,
    fireWatcher: () => (watcher === null ? Effect.void : watcher()),
    holdExtraction: Effect.gen(function* () {
      gate = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
        afterExtraction: false,
      };
      return gate;
    }),
    holdExtractedResult: Effect.gen(function* () {
      gate = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
        afterExtraction: true,
      };
      return gate;
    }),
  };
});

it.live(
  "ignores unchanged watcher events and refreshes only changed files and their dependents",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryWorkspace;
        yield* Effect.promise(() =>
          Promise.all([
            NodeFSP.writeFile(
              NodePath.join(root, "consumer.ts"),
              'import { fixture } from "./source";\nexport const result = fixture();\n',
            ),
            NodeFSP.writeFile(
              NodePath.join(root, "unrelated.ts"),
              "export const untouched = true;\n",
            ),
          ]),
        );
        const harness = yield* makeHarness(root);
        yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
        yield* harness.runtime.start({ projectId });
        const initial = yield* harness.runtime.drain({ projectId });
        assert.sameMembers(harness.extractedFiles, ["source.ts", "consumer.ts", "unrelated.ts"]);
        harness.extractedFiles.length = 0;
        harness.resolvedFiles.length = 0;
        for (let i = 0; i < 3; i++) {
          yield* harness.fireWatcher();
          assert.strictEqual(
            (yield* harness.runtime.drain({ projectId })).revision,
            initial.revision,
          );
        }
        assert.deepStrictEqual(harness.extractedFiles, []);
        assert.deepStrictEqual(harness.resolvedFiles, []);
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(root, "source.ts"),
            "export function fixture() { return 2; }\n",
          ),
        );
        yield* harness.fireWatcher();
        const refreshed = yield* harness.runtime.drain({ projectId });
        assert.isAbove(refreshed.revision, initial.revision);
        assert.sameMembers(harness.extractedFiles, ["source.ts", "consumer.ts"]);
        assert.sameMembers(harness.resolvedFiles, ["source.ts", "consumer.ts"]);
        harness.extractedFiles.length = 0;
        harness.resolvedFiles.length = 0;
        yield* Effect.promise(() => NodeFSP.unlink(NodePath.join(root, "source.ts")));
        yield* harness.fireWatcher();
        const deleted = yield* harness.runtime.drain({ projectId });
        assert.sameMembers(harness.extractedFiles, ["consumer.ts"]);
        assert.sameMembers(harness.resolvedFiles, ["consumer.ts"]);
        const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
        assert.isNotNull(reader);
        assert.isNull(yield* reader!.getRecord("files", "source.ts", deleted.revision));
        const imports = yield* reader!.listRecords({ kind: "imports", revision: deleted.revision });
        assert.isFalse(imports.items.some((item) => item.resolution === "workspace"));
        yield* harness.fireWatcher();
        assert.strictEqual(
          (yield* harness.runtime.drain({ projectId })).revision,
          deleted.revision,
        );
      }),
    ),
);

it.live("coalesces watcher events during indexing without restarting or losing later changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      const gate = yield* harness.holdExtraction;
      const started = yield* harness.runtime.start({ projectId });
      yield* Deferred.await(gate.entered);
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "added.ts"), "export const added = true;\n"),
      );
      for (let i = 0; i < 5; i++) yield* harness.fireWatcher();
      assert.strictEqual(
        (yield* harness.runtime.getStatus({ projectId })).revision,
        started.revision,
      );
      yield* Deferred.succeed(gate.release, undefined);
      const completed = yield* harness.runtime.drain({ projectId });
      assert.strictEqual(completed.revision, started.revision + 1);
      assert.sameMembers(harness.extractedFiles, ["source.ts", "added.ts"]);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.strictEqual(
        (yield* reader!.getRecord("files", "added.ts", completed.revision))?.status,
        "indexed",
      );
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("reuses unchanged files when the branch changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "untouched.ts"), "export const untouched = 1;\n"),
      );
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      yield* harness.runtime.start({ projectId });
      const initial = yield* harness.runtime.drain({ projectId });
      harness.extractedFiles.length = 0;
      yield* harness.runtime.invalidate({ scope: { projectId }, reason: "branch" });
      assert.strictEqual((yield* harness.runtime.drain({ projectId })).revision, initial.revision);
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "source.ts"), "export const onNewBranch = 1;\n"),
      );
      yield* harness.runtime.invalidate({ scope: { projectId }, reason: "branch" });
      const updated = yield* harness.runtime.drain({ projectId });
      assert.isAbove(updated.revision, initial.revision);
      assert.deepStrictEqual(harness.extractedFiles, ["source.ts"]);
    }),
  ),
);

for (const scenario of ["changed", "unchanged", "manual"] as const) {
  it.live(`reconciles saved indexes on recovery: ${scenario}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryWorkspace;
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, "untouched.ts"), "export const untouched = 1;\n"),
        );
        const initial = yield* Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* makeHarness(root);
            yield* harness.runtime.updateSettings({
              projectId,
              patch: { enabled: true, autoRefresh: scenario !== "manual" },
            });
            yield* harness.runtime.start({ projectId });
            return yield* harness.runtime.drain({ projectId });
          }),
        );
        if (scenario !== "unchanged")
          yield* Effect.promise(() =>
            NodeFSP.writeFile(NodePath.join(root, "source.ts"), "export const whileClosed = 1;\n"),
          );
        const recovered = yield* makeHarness(root);
        yield* recovered.runtime.recover;
        const completed = yield* recovered.runtime.drain({ projectId });
        assert.deepStrictEqual(
          recovered.extractedFiles,
          scenario === "changed" ? ["source.ts"] : [],
        );
        if (scenario === "changed") assert.isAbove(completed.revision, initial.revision);
        else assert.strictEqual(completed.revision, initial.revision);
      }),
    ),
  );
}

for (const notifyWatcher of [false, true]) {
  it.live(
    `recovers a source edit during extraction with watcher notification ${notifyWatcher}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* temporaryWorkspace;
          const harness = yield* makeHarness(root);
          yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
          const gate = yield* harness.holdExtractedResult;
          const started = yield* harness.runtime.start({ projectId });
          yield* Deferred.await(gate.entered);
          const updatedSource = "export function updatedFixture() { return 2; }\n";
          yield* Effect.promise(() =>
            NodeFSP.writeFile(NodePath.join(root, "source.ts"), updatedSource),
          );
          if (notifyWatcher) for (let i = 0; i < 3; i++) yield* harness.fireWatcher();
          yield* Deferred.succeed(gate.release, undefined);
          const completed = yield* harness.runtime.drain({ projectId });
          assert.strictEqual(completed.state, "ready");
          assert.strictEqual(completed.revision, started.revision + 1);
          assert.isUndefined(completed.lastError);
          assert.deepStrictEqual(harness.extractedFiles, ["source.ts", "source.ts"]);
          const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
          assert.isNotNull(reader);
          assert.strictEqual(
            (yield* reader!.getRecord("files", "source.ts", completed.revision))?.contentHash,
            NodeCrypto.createHash("sha256").update(updatedSource).digest("hex"),
          );
          const entities = yield* reader!.listRecords({
            kind: "entities",
            revision: completed.revision,
          });
          assert.isTrue(entities.items.some((entity) => entity.name === "updatedFixture"));
          assert.isFalse(entities.items.some((entity) => entity.name === "fixture"));
        }),
      ),
  );
}

it.live("publishes unaffected files when a source changes with automatic refresh disabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "unrelated.ts"), "export const untouched = true;\n"),
      );
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({
        projectId,
        patch: { enabled: true, autoRefresh: false },
      });
      const gate = yield* harness.holdExtractedResult;
      const started = yield* harness.runtime.start({ projectId });
      yield* Deferred.await(gate.entered);
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "source.ts"), "export const changed = true;\n"),
      );
      yield* harness.fireWatcher();
      yield* Deferred.succeed(gate.release, undefined);
      const completed = yield* harness.runtime.drain({ projectId });
      assert.strictEqual(completed.state, "partial");
      assert.strictEqual(completed.revision, started.revision);
      assert.strictEqual(completed.coverage.indexedFiles, 1);
      assert.strictEqual(completed.job?.units.failed, 0);
      assert.isTrue(completed.gaps.some((gap) => gap.kind === "stale-source"));
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      const entities = yield* reader!.listRecords({
        kind: "entities",
        revision: completed.revision,
      });
      assert.isTrue(entities.items.some((entity) => entity.name === "untouched"));
      assert.isFalse(entities.items.some((entity) => entity.name === "fixture"));
      yield* harness.runtime.start({ projectId });
      assert.strictEqual((yield* harness.runtime.drain({ projectId })).state, "ready");
    }),
  ),
);

it.live("recovers a file deleted after extraction without publishing its old symbols", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      const gate = yield* harness.holdExtractedResult;
      const started = yield* harness.runtime.start({ projectId });
      yield* Deferred.await(gate.entered);
      yield* Effect.promise(() => NodeFSP.unlink(NodePath.join(root, "source.ts")));
      yield* Deferred.succeed(gate.release, undefined);
      const completed = yield* harness.runtime.drain({ projectId });
      assert.strictEqual(completed.state, "ready");
      assert.strictEqual(completed.revision, started.revision + 1);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.isNull(yield* reader!.getRecord("files", "source.ts", completed.revision));
      assert.deepStrictEqual(
        (yield* reader!.listRecords({ kind: "entities", revision: completed.revision })).items,
        [],
      );
    }),
  ),
);

it.live("keeps unsafe source replacements as failures and preserves published knowledge", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      yield* harness.runtime.start({ projectId });
      const initial = yield* harness.runtime.drain({ projectId });
      const gate = yield* harness.holdExtractedResult;
      yield* harness.runtime.start({ projectId, rebuild: true });
      yield* Deferred.await(gate.entered);
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(NodePath.join(root, "target.ts"), source);
        await NodeFSP.unlink(NodePath.join(root, "source.ts"));
        await NodeFSP.symlink("target.ts", NodePath.join(root, "source.ts"));
      });
      yield* harness.fireWatcher();
      yield* Deferred.succeed(gate.release, undefined);
      const failed = yield* harness.runtime.drain({ projectId });
      assert.strictEqual(failed.state, "failed");
      assert.strictEqual(failed.revision, initial.revision + 1);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.strictEqual((yield* reader!.getState()).publishedRevision, initial.revision);
    }),
  ),
);

const seedLegacyGeneration = Effect.fn("StaticRuntimeTest.seedLegacyGeneration")(function* (
  root: string,
  paused: boolean,
) {
  const store = yield* openKnowledgeKvStore({ workspaceRoot: root });
  const current = yield* store.getState();
  yield* store.setSettings({ ...current.settings, enabled: true, modelSelection: null });
  const lease = yield* store.acquireLease("legacy-fixture");
  const generation = yield* store.beginGeneration({
    lease,
    expectedRevision: current.revision,
    idempotencyKey: "legacy-fixture",
  });
  const metadata = initialProjectIndexGenerationMetadata({
    kind: "initial",
    manual: true,
    startedAt: "2026-09-20T00:00:00.000Z",
  });
  const { knowledgeFormat: _format, ...legacyMetadata } = metadata;
  yield* store.setGenerationMetadata({
    lease,
    revision: generation.revision,
    metadataJson: encodeProjectIndexJson(legacyMetadata),
  });
  if (paused) {
    yield* store.enqueueJobs({
      lease,
      revision: generation.revision,
      jobs: [
        {
          id: "semantic:source.ts",
          idempotencyKey: "semantic:source.ts",
          kind: "semantic",
          filePath: "source.ts",
          contentHash: sourceHash,
          inputJson: "{}",
        },
      ],
    });
    yield* store.pauseGeneration(generation.revision);
  } else {
    yield* store.applyBatch({
      lease,
      revision: generation.revision,
      batch: {
        files: [
          {
            path: "source.ts",
            contentHash: sourceHash,
            language: "typescript",
            bytes: Buffer.byteLength(source),
            classification: "source",
            status: "indexed",
            configDependencies: [],
          },
        ],
        modules: [
          {
            id: "legacy:module",
            name: "Generated description",
            summary: "An old model summary.",
            entityIds: [],
            filePaths: ["source.ts"],
            dependsOnModuleIds: [],
            provenance: "llm",
            freshness: "current",
            evidenceIds: ["legacy:evidence"],
            analysis: {
              modelSelection: reviewModel,
              sourceRevision: generation.revision,
              analyzedAt: "2026-09-20T00:00:00.000Z",
              unitId: "legacy:unit",
            },
          },
        ],
        evidence: [
          {
            id: "legacy:evidence",
            filePath: "source.ts",
            sourceHash,
            range: {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 7,
              startOffset: 0,
              endOffset: 6,
            },
            excerpt: "export",
            provenance: "parser",
          },
        ],
      },
    });
    yield* store.publishGeneration({ lease, revision: generation.revision });
  }
  yield* store.releaseLease(lease);
  return generation.revision;
});

it.live(
  "indexes without a model and never calls model services during start, rebuild, or watch refresh",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryWorkspace;
        const harness = yield* makeHarness(root);
        yield* harness.runtime.updateSettings({
          projectId,
          patch: { enabled: true, modelSelection: null },
        });
        yield* harness.runtime.start({ projectId });
        const initial = yield* harness.runtime.drain({ projectId });
        assert.isTrue(initial.state === "ready" || initial.state === "partial");
        assert.isNull(initial.job?.modelSelection);
        const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
        assert.isNotNull(reader);
        const firstState = yield* reader!.getState();
        assert.strictEqual(firstState.publishedRevision, initial.revision);
        assert.include(
          yield* reader!.getGenerationMetadata(initial.revision),
          '"knowledgeFormat":"static-v1"',
        );
        yield* queryProjectContext({
          scope: harness.resolved.scope,
          workspaceRoot: root,
          reader: reader!,
          input: { operation: "search", text: "fixture", maxTokens: 6_000, limit: 10 },
        });

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(root, "source.ts"),
            "export function fixture() { return 2; }\n",
          ),
        );
        yield* harness.fireWatcher();
        const refreshed = yield* harness.runtime.drain({ projectId });
        assert.isAbove(refreshed.revision, initial.revision);
        yield* harness.runtime.start({ projectId, rebuild: true });
        const rebuilt = yield* harness.runtime.drain({ projectId });
        assert.isAbove(rebuilt.revision, refreshed.revision);
        assert.strictEqual(harness.modelCalls(), 0);
      }),
    ),
);

it.live("review model changes do not interrupt or restart a static generation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      const gate = yield* harness.holdExtraction;
      const queued = yield* harness.runtime.start({ projectId });
      yield* Deferred.await(gate.entered);
      yield* harness.runtime.updateSettings({
        projectId,
        patch: { modelSelection: reviewModel },
      });
      assert.strictEqual(
        (yield* harness.runtime.getStatus({ projectId })).revision,
        queued.revision,
      );
      yield* Deferred.succeed(gate.release, undefined);
      const completed = yield* harness.runtime.drain({ projectId });
      assert.strictEqual(completed.revision, queued.revision);
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("pause keeps the published revision and resume completes the pending static refresh", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      yield* harness.runtime.start({ projectId });
      const initial = yield* harness.runtime.drain({ projectId });
      const gate = yield* harness.holdExtraction;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(root, "source.ts"),
          "export function fixture() { return 3; }\n",
        ),
      );
      yield* harness.runtime.invalidate({ scope: { projectId }, reason: "source" });
      yield* Deferred.await(gate.entered);
      yield* harness.runtime.control({ projectId, action: "pause" });
      assert.strictEqual(harness.watched(), 0);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.strictEqual((yield* reader!.getState()).publishedRevision, initial.revision);
      const resumedSource = "export function fixture() { return 5; }\n";
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "source.ts"), resumedSource),
      );
      yield* harness.runtime.control({ projectId, action: "resume" });
      yield* Deferred.succeed(gate.release, undefined);
      const resumed = yield* harness.runtime.drain({ projectId });
      assert.isAbove(resumed.revision, initial.revision);
      const refreshedReader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(refreshedReader);
      assert.strictEqual((yield* refreshedReader!.getState()).publishedRevision, resumed.revision);
      assert.strictEqual(
        (yield* refreshedReader!.getRecord("files", "source.ts", resumed.revision))?.contentHash,
        NodeCrypto.createHash("sha256").update(resumedSource).digest("hex"),
      );
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("cancel discards an unfinished generation without replacing published knowledge", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const harness = yield* makeHarness(root);
      yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
      yield* harness.runtime.start({ projectId });
      const initial = yield* harness.runtime.drain({ projectId });
      const gate = yield* harness.holdExtraction;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(root, "source.ts"),
          "export function fixture() { return 4; }\n",
        ),
      );
      yield* harness.runtime.invalidate({ scope: { projectId }, reason: "source" });
      yield* Deferred.await(gate.entered);
      yield* harness.runtime.control({ projectId, action: "cancel" });
      yield* Deferred.succeed(gate.release, undefined);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.strictEqual((yield* reader!.getState()).publishedRevision, initial.revision);
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("rebuilds a published legacy generation without copying its model facts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const legacyRevision = yield* seedLegacyGeneration(root, false);
      const harness = yield* makeHarness(root);
      const hidden = yield* harness.runtime.getStatus({ projectId });
      assert.strictEqual(hidden.state, "idle");
      assert.isNull(hidden.job);
      yield* harness.runtime.recover;
      const rebuilt = yield* harness.runtime.drain({ projectId });
      assert.isAbove(rebuilt.revision, legacyRevision);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.isNull(yield* reader!.getRecord("modules", "legacy:module", rebuilt.revision));
      assert.isAbove(
        (yield* reader!.listRecords({ kind: "entities", revision: rebuilt.revision })).items.length,
        0,
      );
      assert.strictEqual((yield* reader!.getState()).publishedRevision, rebuilt.revision);
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("replaces paused legacy model jobs on resume", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const legacyRevision = yield* seedLegacyGeneration(root, true);
      const harness = yield* makeHarness(root);
      yield* harness.runtime.recover;
      assert.strictEqual((yield* harness.runtime.getStatus({ projectId })).state, "paused");
      yield* harness.runtime.control({ projectId, action: "resume" });
      const completed = yield* harness.runtime.drain({ projectId });
      assert.isAbove(completed.revision, legacyRevision);
      const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
      assert.isNotNull(reader);
      assert.deepStrictEqual(
        (yield* reader!.listJobs({ revision: completed.revision, kind: "semantic" })).items,
        [],
      );
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);

it.live("does not reuse a legacy idempotency key for an explicit static rebuild", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryWorkspace;
      const legacyRevision = yield* seedLegacyGeneration(root, true);
      const harness = yield* makeHarness(root);
      yield* harness.runtime.start({
        projectId,
        rebuild: true,
        idempotencyKey: "legacy-fixture",
      });
      const rebuilt = yield* harness.runtime.drain({ projectId });
      assert.isAbove(rebuilt.revision, legacyRevision);
      assert.strictEqual(harness.modelCalls(), 0);
    }),
  ),
);
