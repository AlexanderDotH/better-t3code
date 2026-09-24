// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it } from "@effect/vitest";

import {
  openExistingKnowledgeKvStore,
  openKnowledgeKvStore,
} from "../persistence/KnowledgeStoreKv.ts";
import { resolveKnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import type { ProjectIndexingBridgeShape } from "../runtime/ProjectIndexingBridge.ts";
import { liveProjectIndexExtraction } from "../runtime/ProjectIndexingExtraction.ts";
import { decodeProjectIndexGenerationMetadata } from "../runtime/ProjectIndexingMetadata.ts";
import { makeProjectIndexingRuntime } from "../runtime/ProjectIndexingRuntime.ts";
import {
  extractSyntheticIndexFixture,
  publishSyntheticIndexFixture,
} from "./SyntheticIndexFixture.ts";

const projectId = ProjectId.make("runtime-acceptance-project");

const makeRuntimeHarness = Effect.fn("ProjectIndexRuntimeAcceptance.makeHarness")(function* (
  root: string,
  options: { readonly beforeExtract?: Effect.Effect<void> } = {},
) {
  const workspace = yield* resolveKnowledgeWorkspace(root);
  const resolved = {
    workspaceRoot: workspace.workspaceRoot,
    scope: {
      scopeId: `scope:${workspace.workspaceId}`,
      workspaceFingerprint: workspace.workspaceId,
      projectId,
    },
  };
  const requests: string[] = [];
  const extractions: string[] = [];
  const bridge: ProjectIndexingBridgeShape = {
    resolveScope: () => Effect.succeed(resolved),
    listScopes: () => Effect.succeed([resolved]),
    capabilities: () => Effect.die("Static indexing requested model capabilities"),
    generate: (request) =>
      Effect.sync(() => {
        requests.push(request.purpose);
        throw new Error("Static indexing generated model output");
      }),
    admit: () => Effect.die("Static indexing requested provider admission"),
    readDiff: () => Effect.die("This acceptance test did not request AI review"),
    reconcileWatchers: () => Effect.void,
  };
  const runtime = yield* makeProjectIndexingRuntime({
    bridge,
    extraction: {
      ...liveProjectIndexExtraction,
      extract: (workspaceRoot, file) =>
        Effect.gen(function* () {
          extractions.push(file.path);
          if (options.beforeExtract) yield* options.beforeExtract;
          return yield* liveProjectIndexExtraction.extract(workspaceRoot, file);
        }),
    },
  });
  const query = (text: string, maxTokens = 6000) =>
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
        return yield* queryProjectContext({
          ...resolved,
          reader,
          input: { operation: "task", text, maxTokens },
        });
      }),
    );
  return { runtime, query, requests, extractions, resolved };
});

const withFixture = <A, E, R>(
  sources: Readonly<Record<string, string>>,
  use: (root: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-static-index-"))),
    (root) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Promise.all(
            Object.entries(sources).map(async ([filePath, content]) => {
              const absolutePath = NodePath.join(root, filePath);
              await NodeFSP.mkdir(NodePath.dirname(absolutePath), { recursive: true });
              await NodeFSP.writeFile(absolutePath, content);
            }),
          ),
        );
        return yield* use(root);
      }),
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );

it.live("starts, refreshes, rebuilds, resumes, and queries with no model selection or calls", () =>
  withFixture(
    {
      "src/helper.ts": "export function increment(value: number) { return value + 1; }\n",
      "src/entry.ts":
        'import { increment } from "./helper";\nexport function result() { return increment(2); }\n',
      "AGENTS.md": "Keep numeric results numeric.\n",
    },
    (root) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeRuntimeHarness(root);
          expect((yield* harness.runtime.getStatus({ projectId })).state).toBe("disabled");
          const subscription = yield* harness.runtime.subscribe({ projectId });
          expect(yield* Stream.runCollect(subscription.pipe(Stream.take(1)))).toHaveLength(1);
          expect((yield* harness.query("result")).entities).toEqual([]);
          yield* harness.runtime.updateSettings({
            projectId,
            patch: { enabled: true, modelSelection: null },
          });
          yield* harness.runtime.start({ projectId });
          const initial = yield* harness.runtime.drain({ projectId });
          expect(["ready", "partial"]).toContain(initial.state);
          expect(initial.coverage.indexedFiles).toBeGreaterThanOrEqual(2);
          expect(initial.settings.modelSelection).toBeNull();
          const context = yield* harness.query("result");
          expect(context.entities.some((entity) => entity.name === "result")).toBe(true);
          expect(context.rules.some((rule) => rule.source === "explicit")).toBe(true);
          expect(context.estimatedTokens).toBeLessThanOrEqual(6000);
          expect(harness.requests).toEqual([]);
          const store = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
          if (store === null) throw new Error("Expected a published static index");
          for (const text of ["resu", "src/entry.ts"]) {
            const search = yield* queryProjectContext({
              ...harness.resolved,
              reader: store,
              input: { operation: "search", text, maxTokens: 6_000 },
            });
            expect(search.entities.some((entity) => entity.name === "result")).toBe(true);
          }
          const overview = yield* queryProjectContext({
            ...harness.resolved,
            reader: store,
            input: { operation: "overview", maxTokens: 12_000 },
          });
          const visible = new Set(overview.entities.map((entity) => entity.id));
          expect(
            overview.callsites.some(
              (callsite) =>
                callsite.callerEntityId &&
                visible.has(callsite.callerEntityId) &&
                callsite.targetEntityIds.some((id) => visible.has(id)),
            ),
          ).toBe(true);
          const metadataJson = yield* store.getGenerationMetadata(initial.revision);
          if (metadataJson === null) throw new Error("Expected revision metadata");
          expect((yield* decodeProjectIndexGenerationMetadata(metadataJson)).knowledgeFormat).toBe(
            "static-v1",
          );
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(root, "src/helper.ts"),
              "export function increment(value: number) { return value + 2; }\n",
            ),
          );
          yield* harness.runtime.invalidate({
            scope: { projectId },
            paths: ["src/helper.ts"],
            reason: "source",
          });
          const refreshed = yield* harness.runtime.drain({ projectId });
          expect(["ready", "partial"]).toContain(refreshed.state);
          expect(refreshed.revision).toBeGreaterThan(initial.revision);
          expect(harness.requests).toEqual([]);
          yield* harness.runtime.start({ projectId, rebuild: true });
          const rebuilt = yield* harness.runtime.drain({ projectId });
          expect(["ready", "partial"]).toContain(rebuilt.state);
          expect(rebuilt.revision).toBeGreaterThan(refreshed.revision);
          yield* harness.runtime.control({ projectId, action: "pause" });
          expect(["ready", "partial"]).toContain(
            (yield* harness.runtime.getStatus({ projectId })).state,
          );
          yield* harness.runtime.control({ projectId, action: "resume" });
          expect(["ready", "partial"]).toContain(
            (yield* harness.runtime.drain({ projectId })).state,
          );
          expect(harness.requests).toEqual([]);
          const cleared = yield* harness.runtime.control({ projectId, action: "clear" });
          expect(cleared.settings.enabled).toBe(false);
          expect((yield* harness.query("result").pipe(Effect.flip)).code).toBe("disabled");
        }),
      ),
  ),
);

it.live(
  "publishes symbols, imports, packages, and confirmed calls across multiple inventory pages",
  () => {
    const callerCount = 257;
    return withFixture(
      {
        "package.json": '{"name":"index-acceptance","private":true}',
        "tsconfig.json": '{"compilerOptions":{"strict":true},"include":["src"]}',
        "AGENTS.md": "Keep numeric results numeric.\n",
        "src/helper.ts": "export function increment(value: number) { return value + 1; }\n",
        ...Object.fromEntries(
          Array.from({ length: callerCount }, (_, index) => [
            `src/entry-${index}.ts`,
            `import { increment } from "./helper";\nexport function result${index}() { return increment(${index}); }\n`,
          ]),
        ),
      },
      (root) =>
        Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* makeRuntimeHarness(root);
            yield* harness.runtime.updateSettings({ projectId, patch: { enabled: true } });
            yield* harness.runtime.start({ projectId });
            const completed = yield* harness.runtime.drain({ projectId });
            expect(completed.state).toBe("ready");
            expect(completed.coverage.indexedFiles).toBe(callerCount + 4);
            expect(completed.coverage.totalEntities).toBeGreaterThan(callerCount * 2);
            expect(completed.coverage.totalImports).toBe(callerCount);
            expect(completed.coverage.resolvedImports).toBe(callerCount);
            expect(completed.coverage.resolvedCallsites).toBe(callerCount);
            expect(completed.job?.units.pending).toBe(0);
            const context = yield* harness.query("result256");
            const caller = context.entities.find((entity) => entity.name === "result256");
            expect(caller).toBeDefined();
            expect(context.rules.some((rule) => rule.source === "explicit")).toBe(true);
            const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
            if (!reader || !caller) throw new Error("Expected published source facts");
            expect((yield* reader.listRecords({ kind: "modules", limit: 10 })).items).toHaveLength(
              1,
            );
            const callees = yield* queryProjectContext({
              ...harness.resolved,
              reader,
              input: { operation: "callees", entityId: caller.id },
            });
            expect(callees.callsites.some((call) => call.resolution === "resolved")).toBe(true);
            expect(callees.entities.some((entity) => entity.name === "increment")).toBe(true);
            expect(harness.requests).toEqual([]);
          }),
        ),
    );
  },
);

it.live("hides a legacy AI revision before a static rebuild replaces it", () =>
  withFixture({ "src/legacy.ts": "export function legacySymbol() { return 1; }\n" }, (root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const batch = yield* Effect.promise(() =>
          extractSyntheticIndexFixture(root, [
            { path: "src/legacy.ts", content: "export function legacySymbol() { return 1; }\n" },
          ]),
        );
        const legacyEntity = batch.entities?.find((entity) => entity.name === "legacySymbol");
        if (legacyEntity === undefined) throw new Error("Expected fixture symbol");
        const store = yield* openKnowledgeKvStore({ workspaceRoot: root });
        yield* publishSyntheticIndexFixture(
          store,
          {
            ...batch,
            behaviors: [
              {
                id: "legacy-ai-behavior",
                entityIds: [legacyEntity.id],
                summary: "Model-authored behavior that must not reach context",
                inputs: [],
                outputs: [],
                sideEffects: [],
                errorPaths: [],
                invariants: [],
                provenance: "llm",
                freshness: "current",
                evidenceIds: ["legacy-ai-evidence"],
                analysis: {
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("legacy-provider"),
                    model: "legacy-model",
                  },
                  sourceRevision: 1,
                  analyzedAt: DateTime.formatIso(yield* DateTime.now),
                  unitId: "legacy-ai-unit",
                },
              },
            ],
            evidence: [
              {
                id: "legacy-ai-evidence",
                filePath: "src/legacy.ts",
                sourceHash: legacyEntity.sourceHash,
                range: legacyEntity.range,
                excerpt: "export function legacySymbol() { return 1; }",
                provenance: "llm",
              },
            ],
          },
          "legacy-ai-revision",
          "legacy-ai",
        );
        const harness = yield* makeRuntimeHarness(root);
        const before = yield* harness.query("legacySymbol");
        expect(before.entities.every((entity) => entity.provenance !== "llm")).toBe(true);
        expect(before.behaviors).toEqual([]);
        yield* harness.runtime.recover;
        const rebuilt = yield* harness.runtime.drain({ projectId });
        expect(["ready", "partial"]).toContain(rebuilt.state);
        expect(rebuilt.revision).toBeGreaterThan(1);
        expect(
          (yield* harness.query("legacySymbol")).entities.some(
            (entity) => entity.name === "legacySymbol",
          ),
        ).toBe(true);
        expect(harness.requests).toEqual([]);
      }),
    ),
  ),
);

it.live("keeps the published revision while a replacement is cancelled", () =>
  withFixture({ "src/value.ts": "export function currentValue() { return 1; }\n" }, (root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let blockExtraction = false;
        const harness = yield* makeRuntimeHarness(root, {
          beforeExtract: Effect.suspend(() =>
            blockExtraction
              ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
              : Effect.void,
          ),
        });
        yield* harness.runtime.updateSettings({
          projectId,
          patch: { enabled: true, modelSelection: null },
        });
        yield* harness.runtime.start({ projectId });
        const first = yield* harness.runtime.drain({ projectId });
        blockExtraction = true;
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(root, "src/value.ts"),
            "export function nextValue() { return 2; }\n",
          ),
        );
        yield* harness.runtime.invalidate({
          scope: { projectId },
          paths: ["src/value.ts"],
          reason: "source",
        });
        yield* Deferred.await(entered);
        const reader = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
        if (reader === null) throw new Error("Expected a published index");
        expect((yield* reader.getState()).publishedRevision).toBe(first.revision);
        const cancelled = yield* harness.runtime.control({ projectId, action: "cancel" });
        expect(cancelled.state).toBe("cancelled");
        expect((yield* reader.getState()).publishedRevision).toBe(first.revision);
        expect(harness.requests).toEqual([]);
        yield* Deferred.succeed(release, undefined);
      }),
    ),
  ),
);

it.live("resumes a paused static generation without a provider", () =>
  withFixture({ "src/paused.ts": "export function resumedSymbol() { return 1; }\n" }, (root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const harness = yield* makeRuntimeHarness(root, {
          beforeExtract: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        });
        yield* harness.runtime.updateSettings({
          projectId,
          patch: { enabled: true, modelSelection: null },
        });
        yield* harness.runtime.start({ projectId });
        yield* Deferred.await(entered);
        const paused = yield* harness.runtime.control({ projectId, action: "pause" });
        expect(paused.state).toBe("paused");
        yield* Deferred.succeed(release, undefined);
        yield* harness.runtime.control({ projectId, action: "resume" });
        const resumed = yield* harness.runtime.drain({ projectId });
        expect(["ready", "partial"]).toContain(resumed.state);
        expect(
          (yield* harness.query("resumedSymbol")).entities.some(
            (entity) => entity.name === "resumedSymbol",
          ),
        ).toBe(true);
        expect(harness.requests).toEqual([]);
      }),
    ),
  ),
);
