// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, expect, it } from "@effect/vitest";
import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  ProjectId,
  ProjectIndexQueryResultV1,
  type ProjectCallsiteV1,
  type ProjectContextInput,
  type ProjectEntityV1,
  type ProjectIndexScopeV1,
  type ProjectSourceFileV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";

import { layerTest as serverSettingsLayerTest } from "../../serverSettings.ts";
import type {
  KnowledgeBatch,
  KnowledgeRecordKind,
  KnowledgeRecordMap,
  KnowledgeRecordQuery,
} from "../persistence/KnowledgeStoreTypes.ts";
import {
  openExistingKnowledgeKvStore,
  openKnowledgeKvStore,
} from "../persistence/KnowledgeStoreKv.ts";
import { KnowledgePrivacyError } from "../privacy/WorkspacePrivacy.ts";
import {
  formatProjectIndexTurnContext,
  prepareProjectIndexTurnContext,
} from "../integration/ProjectIndexTurnContext.ts";
import { ProjectIndexingBridge } from "../runtime/ProjectIndexingBridge.ts";
import {
  layer as QueryLayerBase,
  ProjectContextQuery,
  queryProjectContext,
} from "./ProjectContextQuery.ts";
import type { ProjectContextPosition } from "./ProjectContextCursor.ts";
import { makeProjectContextRetrieval } from "./ProjectContextRetrieval.ts";
import { projectContextImpact } from "./ProjectContextTraversal.ts";
import type { ProjectContextReader } from "./ProjectContextSources.ts";
import { readProjectIndexGraphOverview } from "./ProjectIndexGraphOverview.ts";

const QueryLayer = QueryLayerBase.pipe(
  Layer.provide(serverSettingsLayerTest({ projectIndexingEnabled: true })),
);

const scope: ProjectIndexScopeV1 = {
  scopeId: "test-scope",
  projectId: ProjectId.make("test-project"),
  workspaceFingerprint: "test-workspace",
};
const range = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 25 };
const temporaryDirectories: string[] = [];
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeUnknownJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const isQueryResult = Schema.is(ProjectIndexQueryResultV1);
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

function entity(id: string, filePath = `src/${id}.ts`): ProjectEntityV1 {
  return {
    id,
    filePath,
    kind: "function",
    name: id,
    qualifiedName: id,
    signature: `${id}(): Result<ExactError>`,
    language: "typescript",
    range,
    sourceHash: `hash:${filePath}`,
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

function call(id: string, caller: string, target: string): ProjectCallsiteV1 {
  const filePath = `src/${caller}.ts`;
  return {
    id,
    callerEntityId: caller,
    filePath,
    range,
    expression: `${target}()`,
    dispatch: "direct",
    resolution: "resolved",
    targetEntityIds: [target],
    sourceHash: `hash:${filePath}`,
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

function recordId(record: KnowledgeRecordMap[KnowledgeRecordKind]): string {
  return "id" in record ? record.id : record.path;
}

function makeReader(
  batch: KnowledgeBatch = {},
  options?: {
    readonly revision?: number;
    readonly workspaceId?: string;
    readonly published?: boolean;
    readonly enabled?: boolean;
    readonly autoRefresh?: boolean;
  },
) {
  const requests: Array<{ readonly kind: string; readonly limit?: number | undefined }> = [];
  const revision = options?.revision ?? 1;
  const indexed: KnowledgeBatch = {
    ...batch,
    files: batch.files ?? [
      ...new Map(
        (batch.entities ?? []).map((entity) => [
          entity.filePath,
          {
            path: entity.filePath,
            contentHash: entity.sourceHash,
            language: entity.language,
            bytes: 1,
            classification: "source",
            status: "indexed",
            configDependencies: [],
          } satisfies ProjectSourceFileV1,
        ]),
      ).values(),
    ],
  };
  const paths = (record: KnowledgeRecordMap[KnowledgeRecordKind]): ReadonlyArray<string> => {
    if ("importText" in record)
      return [record.filePath, ...(record.targetPath ? [record.targetPath] : [])];
    if ("filePath" in record && record.filePath) return [record.filePath];
    if ("path" in record) return [record.path];
    if ("filePaths" in record) return record.filePaths;
    const ids =
      "entityIds" in record
        ? record.entityIds
        : "appliesToEntityIds" in record
          ? record.appliesToEntityIds
          : "entryEntityIds" in record
            ? record.entryEntityIds
            : [];
    return (batch.entities ?? [])
      .filter((record) => ids.includes(record.id))
      .map((record) => record.filePath);
  };
  const reader: ProjectContextReader = {
    isStaticRevision: () => Effect.succeed(true),
    getCoverage: () => Effect.succeed(EMPTY_PROJECT_INDEX_COVERAGE),
    getState: () =>
      Effect.succeed({
        workspaceId: options?.workspaceId ?? scope.workspaceFingerprint,
        revision,
        publishedRevision: options?.published === false ? null : revision,
        activeRevision: null,
        status: "completed",
        settings: {
          ...DEFAULT_PROJECT_INDEX_SETTINGS,
          enabled: options?.enabled ?? true,
          autoRefresh: options?.autoRefresh ?? true,
        },
        coverage: EMPTY_PROJECT_INDEX_COVERAGE,
        updatedAt: 0,
      }),
    getRecord: <Kind extends KnowledgeRecordKind>(kind: Kind, id: string) =>
      Effect.succeed((indexed[kind] ?? []).find((record) => recordId(record) === id) ?? null),
    getRecordDependencyPaths: (query) => {
      requests.push({ kind: "dependencies", limit: query.limit });
      const record = (indexed[query.kind] ?? []).find((record) => recordId(record) === query.id);
      const all = (
        record
          ? [
              ...new Set([
                ...paths(record),
                ...("configDependencies" in record ? record.configDependencies : []),
              ]),
            ]
          : []
      )
        .sort()
        .filter((path) => !query.afterPath || path > query.afterPath);
      const items = all.slice(0, query.limit ?? 200);
      return Effect.succeed({
        items,
        revision,
        nextCursor: items.length < all.length ? items.at(-1)! : null,
      });
    },
    listRecords: <Kind extends KnowledgeRecordKind>(query: KnowledgeRecordQuery<Kind>) => {
      requests.push(query);
      const all = (indexed[query.kind] ?? [])
        .filter((record) => {
          if (query.afterId && recordId(record) <= query.afterId) return false;
          if (query.ids && !query.ids.includes(recordId(record))) return false;
          if (
            query.query &&
            !JSON.stringify(record).toLowerCase().includes(query.query.toLowerCase())
          )
            return false;
          if (query.filePath && !paths(record).includes(query.filePath)) return false;
          if (
            query.sourceFilePath &&
            !("filePath" in record && record.filePath === query.sourceFilePath)
          )
            return false;
          if (
            query.filePathPrefixes?.length &&
            !paths(record).some((file) =>
              query.filePathPrefixes?.some(
                (prefix) => file === prefix || file.startsWith(`${prefix}/`),
              ),
            )
          )
            return false;
          if (query.entityIds) {
            const ids =
              "entityIds" in record
                ? record.entityIds
                : "appliesToEntityIds" in record
                  ? record.appliesToEntityIds
                  : "entryEntityIds" in record
                    ? record.entryEntityIds
                    : [];
            if (!ids.some((id) => query.entityIds?.includes(id))) return false;
          }
          return true;
        })
        .sort((left, right) => (recordId(left) < recordId(right) ? -1 : 1));
      const items = all.slice(0, query.limit ?? 200);
      return Effect.succeed({
        items,
        revision,
        nextCursor: items.length < all.length ? recordId(items.at(-1)!) : null,
      });
    },
    searchRecords: (query) => {
      requests.push({ kind: "search", limit: query.limit });
      const terms = (query.query.match(/[\p{L}\p{N}_$./-]+/gu) ?? [])
        .flatMap((word) => [
          word,
          ...word.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2").split(/[._$/-]+|\s+/u),
        ])
        .map((word) => word.toLowerCase())
        .filter((word) => word.length > 1 && !["fix", "find", "the", "for"].includes(word));
      const hits = query.kinds
        .flatMap((kind) =>
          (indexed[kind] ?? []).map((record) => {
            const path =
              "filePath" in record ? record.filePath : "path" in record ? record.path : "";
            const name =
              "name" in record ? record.name : "specifier" in record ? record.specifier : "";
            const haystack =
              `${path} ${name} ${"signature" in record ? record.signature : ""}`.toLowerCase();
            const rank =
              query.query.toLowerCase() === path.toLowerCase() ||
              query.query.toLowerCase() === name.toLowerCase()
                ? 0
                : terms.some((term) => haystack.includes(term))
                  ? 1
                  : Number.POSITIVE_INFINITY;
            return { kind, record, rank, id: recordId(record) };
          }),
        )
        .filter(
          (hit) =>
            Number.isFinite(hit.rank) &&
            (query.filePathPrefixes === undefined ||
              paths(hit.record).some((path) =>
                query.filePathPrefixes?.some(
                  (prefix) => path === prefix || path.startsWith(`${prefix}/`),
                ),
              )),
        )
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.kind.localeCompare(right.kind) ||
            left.id.localeCompare(right.id),
        )
        .filter((hit) =>
          query.after === undefined
            ? true
            : hit.rank > query.after.rank ||
              (hit.rank === query.after.rank &&
                (hit.kind > query.after.kind ||
                  (hit.kind === query.after.kind && hit.id > query.after.id))),
        );
      const items = hits.slice(0, query.limit ?? 200);
      const last = items.at(-1);
      return Effect.succeed({
        revision,
        items: items.map(({ kind, record, rank }) => ({ kind, record, rank })),
        nextCursor:
          items.length < hits.length && last
            ? { rank: last.rank, kind: last.kind, id: last.id }
            : null,
      });
    },
    listCalls: (query) => {
      requests.push({ kind: "callsites", limit: query.limit });
      const all = (batch.callsites ?? [])
        .filter(
          (record) =>
            (!query.afterId || record.id > query.afterId) &&
            ((query.direction !== "callees" &&
              record.targetEntityIds.some((id) => query.entityIds.includes(id))) ||
              (query.direction !== "callers" &&
                record.callerEntityId !== undefined &&
                query.entityIds.includes(record.callerEntityId))),
        )
        .sort((left, right) => (left.id < right.id ? -1 : 1));
      const items = all.slice(0, query.limit ?? 200);
      return Effect.succeed({
        items,
        revision,
        nextCursor: items.length < all.length ? items.at(-1)!.id : null,
      });
    },
  };
  return { reader, requests };
}

function query(
  input: ProjectContextInput,
  reader: ProjectContextReader | null,
  selectedScope = scope,
) {
  return queryProjectContext({
    scope: selectedScope,
    workspaceRoot: "/trusted/worktree",
    input,
    reader,
    readHash: (_root, filePath) => Effect.succeed(`hash:${filePath}`),
  });
}

it.effect("maps all 5,000 indexed files independently of the symbol context budget", () =>
  Effect.gen(function* () {
    const files = Array.from({ length: 5_000 }, (_, index): ProjectSourceFileV1 => ({
      path: index < 4_000 ? "apps/web/file" + index + ".ts" : "packages/core/file" + index + ".ts",
      contentHash: "hash",
      language: "typescript",
      bytes: 1,
      classification: "source",
      status: "indexed",
      configDependencies: [],
    }));
    const imported = {
      id: "import",
      filePath: files[0]!.path,
      sourceHash: "hash",
      range,
      importText: 'import "core"',
      specifier: "core",
      resolution: "workspace" as const,
      targetPath: files[4_000]!.path,
      provenance: "parser" as const,
      freshness: "current" as const,
      evidenceIds: [],
    };
    const { reader } = makeReader({
      files: [
        ...files,
        { ...files[0]!, path: ".env", status: "indexed" },
        { ...files[0]!, path: "old.ts", status: "stale" },
      ],
      imports: [imported, { ...imported, id: "stale", sourceHash: "old" }],
    });
    const result = yield* queryProjectContext({
      reader,
      scope,
      workspaceRoot: "/workspace",
      input: { operation: "overview", maxTokens: 24_000 },
      readHash: () => Effect.succeed("hash"),
    });
    expect(result.graph).toEqual({
      basis: "published-index",
      rootPath: "",
      indexedFiles: 5_000,
      omittedFiles: 0,
      truncated: false,
      nodes: [
        { path: "apps", kind: "directory", fileCount: 4_000 },
        { path: "packages", kind: "directory", fileCount: 1_000 },
      ],
      edges: [{ source: "apps", target: "packages", imports: 1 }],
    });
    expect(isQueryResult(result)).toBe(true);
    expect(Buffer.byteLength(encodeJson(result))).toBeLessThanOrEqual(24_000);
    const folder = yield* readProjectIndexGraphOverview(reader, 1, ["packages/core"], 12_000);
    expect(folder.indexedFiles).toBe(1_000);
    expect(folder.nodes).toHaveLength(64);
    expect(folder.omittedFiles).toBe(936);
    expect(
      folder.nodes.every((node) => node.kind === "file" && node.path.startsWith("packages/core/")),
    ).toBe(true);
    expect(folder.edges).toEqual([]);
    const exactFile = yield* readProjectIndexGraphOverview(reader, 1, [files[0]!.path], 12_000);
    expect(exactFile.nodes).toEqual([{ path: files[0]!.path, kind: "file", fileCount: 1 }]);
    const bounded = yield* readProjectIndexGraphOverview(reader, 1, ["packages/core"], 1_000);
    expect(Buffer.byteLength(encodeJson(bounded))).toBeLessThanOrEqual(1_000);
    expect(
      bounded.omittedFiles + bounded.nodes.reduce((sum, node) => sum + node.fileCount, 0),
    ).toBe(1_000);
  }),
);

it.effect(
  "live query resolves the effective worktree without creating storage or invoking a provider",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-context-readonly-")),
      );
      temporaryDirectories.push(directory);
      const bridge = Layer.mock(ProjectIndexingBridge)({
        resolveScope: (input) => {
          expect(input.projectId).toBe(scope.projectId);
          return Effect.succeed({ scope, workspaceRoot: directory });
        },
      });
      const result = yield* Effect.gen(function* () {
        const context = yield* ProjectContextQuery;
        return yield* context.query({ projectId: scope.projectId, operation: "overview" });
      }).pipe(Effect.provide(QueryLayer.pipe(Layer.provide(bridge))));
      expect(result.summary).toContain("No published project index");
      expect(yield* Effect.promise(() => NodeFSP.readdir(directory))).toEqual([]);
    }),
);

it.effect(
  "keeps source-bearing query failures out of automatic traces while returning a generic error",
  () =>
    Effect.gen(function* () {
      const spans: string[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          spans.push(options.name);
          return new Tracer.NativeSpan(options);
        },
      });
      const bridge = Layer.mock(ProjectIndexingBridge)({
        resolveScope: () =>
          Effect.fail(
            new KnowledgePrivacyError({
              code: "source-unavailable",
              detail: "source-bearing private detail",
            }),
          ).pipe(Effect.withSpan("private-source-resolution")),
      });
      yield* Effect.gen(function* () {
        const context = yield* ProjectContextQuery;
        yield* Effect.void.pipe(Effect.withSpan("trace-control"));
        const error = yield* context
          .query({ projectId: scope.projectId, operation: "overview" })
          .pipe(Effect.flip);
        expect(error).toMatchObject({ code: "scope-mismatch" });
        expect(error.message).not.toContain("private detail");
      }).pipe(
        Effect.provide(QueryLayer.pipe(Layer.provide(bridge))),
        Effect.withTracer(tracer),
        Effect.provideService(References.TracerEnabled, true),
      );
      expect(spans).toContain("trace-control");
      expect(spans).not.toContain("private-source-resolution");
      expect(spans).not.toContain("ProjectContextQuery.query");
    }),
);

it.effect("returns a read-only source fallback when no index is published", () =>
  Effect.gen(function* () {
    const result = yield* query({ operation: "overview" }, null);
    expect(result.revision).toBe(0);
    expect(result.summary).toContain("workspace_find");
    expect(result.summary).toContain("AGENTS");
    expect(result.gaps[0]?.kind).toBe("incomplete-analysis");
    expect(result.verification).toBeUndefined();
    expect(isQueryResult(result)).toBe(true);
  }),
);

it.effect(
  "reports actual unique hash checks for returned context without claiming test execution",
  () =>
    Effect.gen(function* () {
      const first = entity("sharedFirst", "src/shared.ts");
      const second = entity("sharedSecond", "src/shared.ts");
      const omitted = entity("sharedUnavailable", "src/other.ts");
      const { reader } = makeReader({ entities: [first, second, omitted] });
      const readPaths: string[] = [];
      const result = yield* queryProjectContext({
        scope,
        workspaceRoot: "/trusted/worktree",
        reader,
        input: { operation: "search", text: "shared" },
        readHash: (_root, filePath) => {
          readPaths.push(filePath);
          return filePath === omitted.filePath
            ? Effect.fail(
                new KnowledgePrivacyError({
                  code: "source-unavailable",
                  detail: "Source verification is unavailable.",
                }),
              )
            : Effect.succeed(`hash:${filePath}`);
        },
      });
      expect(readPaths.sort()).toEqual(["src/other.ts", "src/shared.ts"]);
      expect(result.entities.map((record) => record.id)).toEqual([first.id, second.id]);
      expect(result.verification).toEqual({
        context: "provided",
        checks: "not-run",
        sourceHashes: {
          state: "complete",
          matchedFiles: 1,
          changedFiles: 0,
          missingFiles: 0,
          unverifiedFiles: 0,
        },
      });
      expect(result.summary).toContain("did not run tests, checks, or a code review");
    }),
);

it.effect(
  "includes a matched source file's recorded configuration without claiming it is a rule",
  () =>
    Effect.gen(function* () {
      const source = entity("process");
      const { signature: _signature, ...configurationBase } = entity("config", "tsconfig.json");
      const configuration: ProjectEntityV1 = {
        ...configurationBase,
        kind: "file",
        name: "tsconfig.json",
        qualifiedName: "tsconfig.json",
        language: "json",
      };
      const files: ProjectSourceFileV1[] = [
        {
          path: source.filePath,
          contentHash: source.sourceHash,
          language: source.language,
          bytes: 25,
          classification: "source",
          status: "indexed",
          configDependencies: [configuration.filePath],
        },
        {
          path: configuration.filePath,
          contentHash: configuration.sourceHash,
          language: "json",
          bytes: 25,
          classification: "configuration",
          status: "indexed",
          configDependencies: [],
        },
      ];
      const { reader } = makeReader({ files, entities: [source, configuration] });
      const result = yield* queryProjectContext({
        scope,
        workspaceRoot: "/trusted/worktree",
        reader,
        input: { operation: "task", text: "process" },
        readHash: (_root, filePath) => Effect.succeed(`hash:${filePath}`),
      });
      expect(result.entities.map((record) => record.id)).toContain(configuration.id);
      expect(result.rules).toEqual([]);
    }),
);

it.effect(
  "rejects disabled retained knowledge before reading records, coverage or source hashes",
  () =>
    Effect.gen(function* () {
      const { reader } = makeReader({ entities: [entity("retained")] }, { enabled: false });
      const disabled: ProjectContextReader = {
        ...reader,
        getCoverage: () => Effect.die("Disabled indexing must not read coverage."),
        getRecord: () => Effect.die("Disabled indexing must not read a record."),
        getRecordDependencyPaths: () => Effect.die("Disabled indexing must not read dependencies."),
        listRecords: () => Effect.die("Disabled indexing must not search records."),
        listCalls: () => Effect.die("Disabled indexing must not read calls."),
      };
      const failure = yield* queryProjectContext({
        scope,
        workspaceRoot: "/trusted/worktree",
        reader: disabled,
        input: { operation: "task", text: "retained", includeStale: true },
        readHash: () => Effect.die("Disabled indexing must not read source files."),
      }).pipe(Effect.flip);
      expect(failure).toMatchObject({ code: "disabled", retryable: false });
      expect(yield* reader.getRecord("entities", "retained", 1)).not.toBeNull();
    }),
);

it.effect("never reads retained AI records from a legacy published revision", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({
      entities: [entity("legacy")],
      modules: [
        {
          id: "legacy-summary",
          name: "Legacy summary",
          summary: "AI-generated project description",
          entityIds: ["legacy"],
          filePaths: ["src/legacy.ts"],
          dependsOnModuleIds: [],
          provenance: "llm",
          freshness: "current",
          evidenceIds: [],
        },
      ],
    });
    const legacy: ProjectContextReader = {
      ...reader,
      isStaticRevision: () => Effect.succeed(false),
      getCoverage: () => Effect.die("Legacy revision must not read coverage"),
      getRecord: () => Effect.die("Legacy revision must not read records"),
      listRecords: () => Effect.die("Legacy revision must not list records"),
      searchRecords: () => Effect.die("Legacy revision must not search records"),
    };
    const result = yield* query({ operation: "task", text: "legacy", includeStale: true }, legacy);
    expect(result.entities).toEqual([]);
    expect(result.modules).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.gaps.map((gap) => gap.id)).toContain("static-rebuild-required");
    expect(formatProjectIndexTurnContext(result)).toBeUndefined();
  }),
);

it.effect(
  "discards an answer when indexing is disabled, cleared or replaced during its reads",
  () =>
    Effect.gen(function* () {
      for (const action of ["disabled", "cleared", "rebuilt"] as const) {
        const { reader } = makeReader({ entities: [entity("retained")] });
        let stateReads = 0;
        const changing: ProjectContextReader = {
          ...reader,
          getState: () =>
            reader.getState().pipe(
              Effect.map((state) => {
                stateReads += 1;
                if (stateReads === 1) return state;
                return action === "disabled"
                  ? { ...state, settings: { ...state.settings, enabled: false } }
                  : { ...state, revision: 2, publishedRevision: action === "cleared" ? null : 2 };
              }),
            ),
        };
        expect(
          yield* query({ operation: "search", text: "retained" }, changing).pipe(Effect.flip),
        ).toMatchObject({ code: action === "disabled" ? "disabled" : "stale-revision" });
      }
    }),
);

it.effect("reads a published store through the real service without changing its database", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-context-published-")),
    );
    temporaryDirectories.push(directory);
    const text = "export function decodeRequest() {}\n";
    const hash = NodeCrypto.createHash("sha256").update(text).digest("hex");
    yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(directory, "source.ts"), text));
    const resolvedScope = yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openKnowledgeKvStore({ workspaceRoot: directory });
        yield* store.setSettings({ ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: true });
        const lease = yield* store.acquireLease("context-test");
        const generation = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "test-publication",
        });
        const guard = { lease, revision: generation.revision };
        yield* store.applyBatch({
          ...guard,
          batch: {
            files: [
              {
                path: "source.ts",
                contentHash: hash,
                language: "typescript",
                bytes: Buffer.byteLength(text),
                classification: "source",
                status: "indexed",
                configDependencies: [],
              },
            ],
            entities: [{ ...entity("decodeRequest", "source.ts"), sourceHash: hash }],
          },
        });
        yield* store.setGenerationMetadata({
          ...guard,
          metadataJson: encodeJson({ knowledgeFormat: "static-v1" }),
        });
        yield* store.publishGeneration(guard);
        yield* store.releaseLease(lease);
        return { ...scope, workspaceFingerprint: store.workspace.workspaceId };
      }),
    );
    const readKvState = Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openExistingKnowledgeKvStore({ workspaceRoot: directory });
        expect(store).not.toBeNull();
        return yield* store!.getState();
      }),
    );
    const before = yield* readKvState;
    const bridge = Layer.mock(ProjectIndexingBridge)({
      resolveScope: () => Effect.succeed({ scope: resolvedScope, workspaceRoot: directory }),
    });
    const result = yield* Effect.gen(function* () {
      const context = yield* ProjectContextQuery;
      return yield* context.query({
        projectId: scope.projectId,
        operation: "entity",
        entityId: "decodeRequest",
      });
    }).pipe(Effect.provide(QueryLayer.pipe(Layer.provide(bridge))));
    expect(result.entities[0]).toMatchObject({ id: "decodeRequest", freshness: "current" });
    expect(result.revision).toBe(1);
    const enabledTurnContext = yield* Effect.gen(function* () {
      const context = yield* ProjectContextQuery;
      return yield* prepareProjectIndexTurnContext(
        context,
        { projectId: scope.projectId },
        "Update decodeRequest",
      );
    }).pipe(Effect.provide(QueryLayer.pipe(Layer.provide(bridge))));
    expect(enabledTurnContext).toContain("decodeRequest");
    expect(yield* readKvState).toEqual(before);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openKnowledgeKvStore({ workspaceRoot: directory });
        yield* store.setSettings({ ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: false });
        expect(yield* store.getRecord("entities", "decodeRequest", 1)).not.toBeNull();
      }),
    );
    const disabledState = yield* readKvState;
    yield* Effect.gen(function* () {
      const context = yield* ProjectContextQuery;
      const disabled = yield* context
        .query({ projectId: scope.projectId, operation: "entity", entityId: "decodeRequest" })
        .pipe(Effect.flip);
      expect(disabled.code).toBe("disabled");
      expect(
        yield* prepareProjectIndexTurnContext(
          context,
          { projectId: scope.projectId },
          "Update decodeRequest",
        ),
      ).toBeUndefined();
    }).pipe(Effect.provide(QueryLayer.pipe(Layer.provide(bridge))));
    expect(yield* readKvState).toEqual(disabledState);
  }),
);

it.effect("bounds the full response, including Unicode names, metadata, evidence and cursors", () =>
  Effect.gen(function* () {
    const { reader, requests } = makeReader({
      entities: Array.from({ length: 40 }, (_, index) => ({
        ...entity(`symbol${String(index).padStart(2, "0")}`),
        signature: `symbol${index}(入力: Result): ExactFailure_${"界".repeat(180)}`,
      })),
    });
    for (const maxTokens of [3_000, 6_000, 24_000]) {
      const result = yield* query({ operation: "search", text: "symbol", maxTokens }, reader);
      expect(result.entities.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(encodeJson(result))).toBeLessThanOrEqual(maxTokens);
      expect(result.estimatedTokens).toBeLessThanOrEqual(maxTokens);
      expect(result.estimatedTokens).toBeGreaterThanOrEqual(Buffer.byteLength(encodeJson(result)));
      expect(result.truncated).toBe(true);
      expect(result.nextCursor).not.toBeNull();
      expect(isQueryResult(result)).toBe(true);
    }
    expect(requests.every((request) => (request.limit ?? 0) <= 64)).toBe(true);
  }),
);

it.effect("retrieves every search hit across batches without repeating each search", () =>
  Effect.gen(function* () {
    const entities = Array.from({ length: 35 }, (_, index) =>
      entity(`match${String(index).padStart(2, "0")}`),
    );
    const { reader, requests } = makeReader({ entities });
    const retrieval = makeProjectContextRetrieval(
      reader,
      { operation: "search", text: "match" },
      1,
    );
    const found: string[] = [];
    let position: ProjectContextPosition = { stage: 0, afterId: null };
    let complete = false;
    for (let index = 0; index <= entities.length && !complete; index += 1) {
      const page = yield* retrieval.next(position);
      if (page.candidate) found.push(page.candidate.record.id);
      position = page.position;
      complete = page.complete;
    }
    expect(complete).toBe(true);
    expect(found).toEqual(entities.map(({ id }) => id));
    expect(requests.filter(({ kind }) => kind === "search")).toHaveLength(2);
  }),
);

it.effect(
  "paginates deterministically and rejects cursors from another query, scope or revision",
  () =>
    Effect.gen(function* () {
      const { reader } = makeReader({
        entities: [entity("matchA"), entity("matchB"), entity("matchC")],
      });
      const input = { operation: "search" as const, text: "match", limit: 1 };
      const first = yield* query(input, reader);
      const repeated = yield* query(input, reader);
      expect(first).toEqual(repeated);
      expect(first.entities.map(({ id }) => id)).toEqual(["matchA"]);
      const cursor = first.nextCursor!;
      expect(decodeUnknownJson(Buffer.from(cursor, "base64url").toString("utf8"))).toMatchObject({
        version: 2,
        afterRank: 1,
        afterKind: "entities",
        afterId: "matchA",
      });
      const second = yield* query({ ...input, cursor }, reader);
      expect(second.entities.map(({ id }) => id)).toEqual(["matchB"]);
      for (const changed of [
        query({ ...input, text: "different", cursor }, reader),
        query({ ...input, cursor }, reader, { ...scope, scopeId: "another-project" }),
        query({ ...input, cursor }, makeReader({}, { revision: 2 }).reader),
      ]) {
        expect(yield* changed.pipe(Effect.flip)).toMatchObject({ code: "invalid-cursor" });
      }
      const oldCursor = Buffer.from(
        encodeJson({ version: 1, stage: 0, afterId: "matchA" }),
      ).toString("base64url");
      expect(yield* query({ ...input, cursor: oldCursor }, reader).pipe(Effect.flip)).toMatchObject(
        {
          code: "invalid-cursor",
        },
      );
    }),
);

it.effect("retains short domain words and splits compound words in task retrieval", () =>
  Effect.gen(function* () {
    for (const [text, target] of [
      [
        "Check whether the invoice ingestion boundary depends on the correct validation module.",
        entity("validateInvoice", "src/ui/invoice-form.ts"),
      ],
      [
        "Trace enabled-recipient delivery retries.",
        entity("enabledRecipients", "src/messages/select.ts"),
      ],
    ] as const) {
      const result = yield* query(
        { operation: "task", text },
        makeReader({ entities: [target] }).reader,
      );
      expect(result.entities.map(({ id }) => id)).toContain(target.id);
    }
  }),
);

it.effect("does not return unrelated symbols for a search", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({ entities: [entity("firstOnly")] });
    const result = yield* query({ operation: "search", text: "secondDifferent" }, reader);
    expect(result.entities).toEqual([]);
  }),
);

it.effect("starts an overview with connected source symbols before large rule documents", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({
      entities: [entity("entry"), entity("helper")],
      callsites: [call("entry-helper", "entry", "helper")],
      rules: [
        {
          id: "large-guide",
          name: "AGENTS.md",
          description: "Follow the project conventions. ".repeat(3_000),
          source: "explicit",
          severity: "info",
          appliesToEntityIds: [],
          evidenceIds: ["guide-evidence"],
          provenance: "parser",
          freshness: "current",
        },
      ],
      evidence: [
        {
          id: "guide-evidence",
          filePath: "AGENTS.md",
          range,
          sourceHash: "hash:AGENTS.md",
          provenance: "parser",
        },
      ],
    });
    const result = yield* query({ operation: "overview", maxTokens: 6_000 }, reader);
    expect(result.entities.map(({ id }) => id)).toEqual(["entry", "helper"]);
    expect(result.callsites.map(({ id }) => id)).toEqual(["entry-helper"]);
    expect(result.estimatedTokens).toBeLessThanOrEqual(6_000);
    expect(result.nextCursor).not.toBeNull();
  }),
);

it.effect(
  "returns original ancestor AGENTS rules without task-word overlap and excludes sibling rules",
  () =>
    Effect.gen(function* () {
      const shipping = entity("shipOrder", "src/shipping/ship.ts");
      const billing = entity("billOrder", "src/billing/bill.ts");
      const documents = [
        { ...entity("root-guide", "AGENTS.md"), kind: "file" as const },
        { ...entity("shipping-guide", "src/shipping/AGENTS.md"), kind: "file" as const },
        { ...entity("billing-guide", "src/billing/AGENTS.md"), kind: "file" as const },
      ];
      const evidence = documents.map((document) => ({
        id: `evidence:${document.id}`,
        filePath: document.filePath,
        sourceHash: document.sourceHash,
        range: document.range,
        provenance: "parser" as const,
      }));
      const rules = documents.map((document, index) => ({
        id: `rule:${document.id}`,
        name: document.filePath,
        description: [
          "Use immutable values.",
          "Keep transactions atomic.",
          "Round monetary totals once.",
        ][index]!,
        severity: "info" as const,
        source: "explicit" as const,
        appliesToEntityIds: [document.id],
        evidenceIds: [evidence[index]!.id],
        provenance: "parser" as const,
        freshness: "current" as const,
      }));
      const { reader } = makeReader({
        entities: [shipping, billing, ...documents],
        rules: [
          ...Array.from({ length: 12 }, (_, index) => ({
            ...rules[0]!,
            id: `00-copy-${index}`,
            source: "inferred" as const,
            provenance: "llm" as const,
          })),
          ...rules,
        ],
        evidence,
      });
      for (const input of [
        { operation: "task" as const, text: shipping.name, scopes: [shipping.filePath] },
        { operation: "entity" as const, entityId: shipping.id, scopes: [shipping.filePath] },
      ]) {
        const result = yield* query(input, reader);
        expect(result.rules.map((rule) => rule.id).sort()).toEqual(
          [rules[0]!.id, rules[1]!.id].sort(),
        );
        for (const rule of result.rules) {
          expect(rule).toMatchObject({
            source: "explicit",
            provenance: "parser",
            freshness: "current",
          });
          expect(rule.appliesToEntityIds).toContain(shipping.id);
          expect(rule.appliesToEntityIds).not.toContain(billing.id);
          expect(
            rule.evidenceIds.some((id) =>
              result.evidence.some(
                (source) =>
                  source.id === id &&
                  source.filePath === rule.name &&
                  source.sourceHash ===
                    documents.find((document) => document.filePath === rule.name)?.sourceHash,
              ),
            ),
          ).toBe(true);
        }
        expect(result.rules.find((rule) => rule.id === rules[0]!.id)?.description).toBe(
          rules[0]!.description,
        );
      }
      const sibling = yield* query({ operation: "entity", entityId: billing.id }, reader);
      expect(sibling.rules.map((rule) => rule.id).sort()).toEqual(
        [rules[0]!.id, rules[2]!.id].sort(),
      );
      expect((yield* reader.getRecord("rules", rules[0]!.id, 1))?.appliesToEntityIds).toEqual([
        documents[0]!.id,
      ]);
    }),
);

it.effect("keeps a readable AGENTS path when applicable directives exceed the answer budget", () =>
  Effect.gen(function* () {
    const target = entity("transform", "src/transform.ts");
    const document = { ...entity("guide", "AGENTS.md"), kind: "file" as const };
    const evidence = {
      id: "guide-evidence",
      filePath: document.filePath,
      sourceHash: document.sourceHash,
      range: document.range,
      provenance: "parser" as const,
    };
    const rule = {
      id: "large-original-rule",
      name: "AGENTS.md",
      description: "Preserve invariants and document assumptions. ".repeat(170),
      severity: "info" as const,
      source: "explicit" as const,
      appliesToEntityIds: [document.id],
      evidenceIds: [evidence.id],
      provenance: "parser" as const,
      freshness: "current" as const,
    };
    const { reader } = makeReader({
      entities: [target, document],
      evidence: [evidence],
      rules: [rule],
    });
    for (const input of [
      { operation: "task" as const, text: target.name },
      { operation: "entity" as const, entityId: target.id },
    ]) {
      const result = yield* query(input, reader);
      expect(result.rules).toEqual([]);
      expect(
        result.gaps.some((gap) => gap.kind === "limit" && gap.filePath === document.filePath),
      ).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(6_000);
    }
    const expanded = yield* query(
      { operation: "entity", entityId: target.id, maxTokens: 12_000 },
      reader,
    );
    expect(expanded.rules[0]?.description).toBe(rule.description);
    const changed = yield* queryProjectContext({
      scope,
      workspaceRoot: "/trusted/worktree",
      reader,
      input: { operation: "task", text: target.name },
      readHash: (_root, filePath) =>
        Effect.succeed(filePath === document.filePath ? "changed" : `hash:${filePath}`),
    });
    expect(changed.rules).toEqual([]);
    expect(
      changed.gaps.some((gap) => gap.kind === "stale-source" && gap.filePath === document.filePath),
    ).toBe(true);
  }),
);

it.effect("checks the real source hash before returning indexed symbols", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-context-stale-")),
    );
    temporaryDirectories.push(directory);
    const text = "export function original() {}\n";
    yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(directory, "source.ts"), text));
    const source = {
      ...entity("original", "source.ts"),
      sourceHash: NodeCrypto.createHash("sha256").update(text).digest("hex"),
    };
    const { reader } = makeReader({ entities: [source] });
    const request = {
      scope,
      workspaceRoot: directory,
      input: { operation: "entity" as const, entityId: source.id },
      reader,
    };
    expect((yield* queryProjectContext(request)).entities[0]?.freshness).toBe("current");
    yield* Effect.promise(() =>
      NodeFSP.writeFile(NodePath.join(directory, "source.ts"), "export function renamed() {}\n"),
    );
    const stale = yield* queryProjectContext(request);
    expect(stale.entities).toEqual([]);
    expect(stale.gaps[0]).toMatchObject({ kind: "stale-source", filePath: "source.ts" });
    const included = yield* queryProjectContext({
      ...request,
      input: { ...request.input, includeStale: true },
    });
    expect(included.entities[0]?.freshness).toBe("stale");
    expect(included.verification?.sourceHashes).toMatchObject({
      state: "complete",
      changedFiles: 1,
      matchedFiles: 0,
    });
    expect(included.evidence.every((source) => source.excerpt === undefined)).toBe(true);
    yield* Effect.promise(() => NodeFSP.unlink(NodePath.join(directory, "source.ts")));
    const absent = yield* queryProjectContext({
      ...request,
      input: { ...request.input, includeStale: true },
    });
    expect(absent.entities[0]?.freshness).toBe("missing");
    expect(absent.verification?.sourceHashes).toMatchObject({
      state: "complete",
      missingFiles: 1,
      matchedFiles: 0,
    });
  }),
);

it.effect(
  "reports unavailable source verification as unknown without claiming the file is missing",
  () =>
    Effect.gen(function* () {
      const { reader } = makeReader({ entities: [entity("unverified")] });
      const result = yield* queryProjectContext({
        scope,
        workspaceRoot: "/trusted/worktree",
        reader,
        input: { operation: "entity", entityId: "unverified", includeStale: true },
        readHash: () =>
          Effect.fail(
            new KnowledgePrivacyError({
              code: "source-unavailable",
              detail: "Source verification is unavailable.",
            }),
          ),
      });
      expect(result.entities[0]?.freshness).toBe("unknown");
      expect(result.verification).toMatchObject({
        checks: "not-run",
        sourceHashes: { state: "unavailable", unverifiedFiles: 1, matchedFiles: 0 },
      });
      expect(result.gaps.some((gap) => gap.kind === "incomplete-analysis")).toBe(true);
      expect(
        result.gaps.some(
          (gap) => gap.message.includes("missing") || gap.message.includes("absent"),
        ),
      ).toBe(false);
    }),
);

it.effect("validates transitive callee and configuration hashes with auto-refresh off", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-context-dependencies-")),
    );
    temporaryDirectories.push(directory);
    const contents = {
      "caller.ts": "export function caller() { return middle(); }\n",
      "middle.ts": "export function middle() { return leaf(); }\n",
      "leaf.ts": "export function leaf() { return 'original'; }\n",
      "tsconfig.json": '{"extends":"./tsconfig.base.json"}\n',
      "tsconfig.base.json": '{"compilerOptions":{"strict":true}}\n',
    };
    const files = Object.entries(contents).map(([filePath, content]): ProjectSourceFileV1 => ({
      path: filePath,
      contentHash: NodeCrypto.createHash("sha256").update(content).digest("hex"),
      language: filePath.endsWith("json") ? "json" : "typescript",
      bytes: Buffer.byteLength(content),
      classification: filePath.endsWith("json") ? "configuration" : "source",
      status: "indexed",
      configDependencies:
        filePath === "caller.ts"
          ? ["tsconfig.json"]
          : filePath === "tsconfig.json"
            ? ["tsconfig.base.json"]
            : [],
    }));
    yield* Effect.forEach(Object.entries(contents), ([filePath, content]) =>
      Effect.promise(() => NodeFSP.writeFile(NodePath.join(directory, filePath), content)),
    );
    const entities = ["caller", "middle", "leaf"].map((name) => ({
      ...entity(name, `${name}.ts`),
      sourceHash: files.find((file) => file.path === `${name}.ts`)!.contentHash,
    }));
    const { reader } = makeReader(
      {
        files,
        entities,
        callsites: [
          {
            ...call("caller-middle", "caller", "middle"),
            filePath: "caller.ts",
            sourceHash: entities[0]!.sourceHash,
          },
          {
            ...call("middle-leaf", "middle", "leaf"),
            filePath: "middle.ts",
            sourceHash: entities[1]!.sourceHash,
          },
        ],
        behaviors: [
          {
            id: "caller-behavior",
            entityIds: ["caller"],
            summary: "Returns the leaf value through middle.",
            inputs: [],
            outputs: ["original"],
            sideEffects: [],
            errorPaths: [],
            invariants: [],
            provenance: "manual",
            freshness: "current",
            evidenceIds: [],
          },
        ],
      },
      { autoRefresh: false },
    );
    const request = {
      scope,
      workspaceRoot: directory,
      reader,
      input: { operation: "entity" as const, entityId: "caller", maxTokens: 24_000 },
    };
    expect((yield* queryProjectContext(request)).entities[0]?.freshness).toBe("current");
    for (const changedPath of ["leaf.ts", "tsconfig.base.json"] as const) {
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(directory, changedPath), `${contents[changedPath]}\n`),
      );
      const changed = yield* queryProjectContext(request);
      expect(changed.entities).toEqual([]);
      expect(
        changed.gaps.some((gap) => gap.filePath === changedPath && gap.kind === "stale-source"),
      ).toBe(true);
      const historical = yield* queryProjectContext({
        ...request,
        input: { ...request.input, includeStale: true },
      });
      expect(historical.entities[0]?.freshness).toBe("stale");
      expect(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(directory, "caller.ts"), "utf8"),
        ),
      ).toBe(contents["caller.ts"]);
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(directory, changedPath), contents[changedPath]),
      );
    }
  }),
);

it.effect("respects recorded invalidation even when the caller and callee bytes still match", () =>
  Effect.gen(function* () {
    const caller = entity("caller");
    const callee = entity("callee");
    const { reader } = makeReader(
      {
        entities: [caller, callee],
        callsites: [call("call", caller.id, callee.id)],
        files: [caller, callee].map((value) => ({
          path: value.filePath,
          contentHash: value.sourceHash,
          language: "typescript",
          bytes: 1,
          classification: "source",
          status: value.id === callee.id ? "stale" : "indexed",
          configDependencies: [],
        })),
        behaviors: [
          {
            id: "behavior",
            entityIds: [caller.id],
            summary: "Derived caller behavior",
            inputs: [],
            outputs: [],
            sideEffects: [],
            errorPaths: [],
            invariants: [],
            provenance: "manual",
            freshness: "current",
            evidenceIds: [],
          },
        ],
      },
      { autoRefresh: false },
    );
    const result = yield* query(
      { operation: "entity", entityId: caller.id, includeStale: true },
      reader,
    );
    expect(result.entities[0]?.freshness).toBe("stale");
    expect(result.behaviors).toEqual([]);
    expect(result.gaps.some((gap) => gap.id.startsWith("dependency-invalidated:"))).toBe(true);
  }),
);

it.effect(
  "bounds dependency verification and reports incomplete facts instead of trusting a partial traversal",
  () =>
    Effect.gen(function* () {
      const entities = Array.from({ length: 80 }, (_, index) => entity(`node${index}`));
      const { reader, requests } = makeReader({
        entities,
        callsites: entities
          .slice(1)
          .map((target, index) => call(`edge${index}`, entities[index]!.id, target.id)),
      });
      const result = yield* query({ operation: "entity", entityId: "node0" }, reader);
      expect(result.entities).toEqual([]);
      expect(result.gaps.some((gap) => gap.kind === "limit")).toBe(true);
      expect(requests.filter((request) => request.kind === "callsites").length).toBeLessThanOrEqual(
        64,
      );
      const partial = yield* query(
        { operation: "entity", entityId: "node0", includeStale: true, maxTokens: 24_000 },
        reader,
      );
      expect(partial.entities.find((entity) => entity.id === "node0")?.freshness).toBe("unknown");
      expect(partial.entities.some((entity) => entity.freshness === "missing")).toBe(false);
    }),
);

it.effect("never returns private, outside-scope or foreign-workspace records", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({
      entities: [
        entity("secret", ".t3/knowledge/private.ts"),
        entity("allowed", "src/allowed.ts"),
        entity("outside", "other/outside.ts"),
      ],
    });
    const result = yield* query({ operation: "search", text: "allowed", scopes: ["src"] }, reader);
    expect(result.entities.map(({ id }) => id)).toEqual(["allowed"]);
    expect(encodeJson(result)).not.toContain(".t3/");
    expect(
      yield* query({ operation: "entity", entityId: "outside", scopes: ["src"] }, reader).pipe(
        Effect.flip,
      ),
    ).toMatchObject({ code: "not-found" });
    expect(
      yield* query(
        { operation: "overview" },
        makeReader({}, { workspaceId: "foreign" }).reader,
      ).pipe(Effect.flip),
    ).toMatchObject({ code: "scope-mismatch" });
  }),
);

it.effect(
  "expands confirmed helper and test calls without returning model-generated descriptions",
  () =>
    Effect.gen(function* () {
      const target = entity("decodeRequest", "src/request.ts");
      const test = entity("rejectsInvalid", "test/request.test.ts");
      const helper = entity("validateRequest", "lib/validation.ts");
      const testCall = {
        ...call("test-call", test.id, target.id),
        filePath: test.filePath,
        sourceHash: test.sourceHash,
      };
      const helperCall = {
        ...call("helper-call", target.id, helper.id),
        filePath: target.filePath,
        sourceHash: target.sourceHash,
      };
      const { reader } = makeReader({
        entities: [target, test, helper],
        callsites: [testCall, helperCall],
        modules: [
          {
            id: "request-module",
            name: "Request decoding",
            summary: "Validates requests and preserves ExactError failures.",
            entityIds: [target.id],
            filePaths: [],
            dependsOnModuleIds: [],
            provenance: "llm",
            freshness: "current",
            evidenceIds: [],
          },
        ],
        behaviors: [
          {
            id: "request-behavior",
            entityIds: [target.id],
            summary: "Decodes requests.",
            inputs: ["Request"],
            outputs: ["DecodedRequest"],
            sideEffects: [],
            errorPaths: ["ExactError.InvalidRequest"],
            invariants: [],
            provenance: "llm",
            freshness: "current",
            evidenceIds: [],
          },
        ],
        rules: [
          {
            id: "request-rule",
            name: "Preserve exact error",
            description: "Return ExactError.InvalidRequest for malformed input.",
            severity: "error",
            source: "explicit",
            appliesToEntityIds: [target.id],
            provenance: "manual",
            freshness: "current",
            evidenceIds: [],
          },
        ],
      });
      const result = yield* query(
        { operation: "task", text: "Fix decodeRequest", scopes: [target.filePath] },
        reader,
      );
      expect(result.entities.map(({ id }) => id)).toEqual(
        expect.arrayContaining([target.id, helper.id, test.id]),
      );
      expect(result.callsites.map(({ id }) => id)).toEqual(
        expect.arrayContaining([testCall.id, helperCall.id]),
      );
      expect(result.modules).toEqual([]);
      expect(result.behaviors).toEqual([]);
      expect(result.rules).toEqual([]);
      expect(
        new Set(
          result.evidence.map(
            (source) => `${source.filePath}:${JSON.stringify(source.range)}:${source.sourceHash}`,
          ),
        ).size,
      ).toBe(result.evidence.length);
      expect(result.summary).toContain("AGENTS instructions take precedence");
      const strict = yield* query(
        { operation: "entity", entityId: target.id, scopes: [target.filePath] },
        reader,
      );
      expect(strict.entities.map(({ id }) => id)).not.toContain(test.id);
      expect(strict.entities.map(({ id }) => id)).not.toContain(helper.id);
    }),
);

it.effect(
  "keeps task context on confirmed calls when legacy modules and flows claim wider paths",
  () =>
    Effect.gen(function* () {
      const entry = entity("entry", "src/entry.ts");
      const helper = entity("sharedHelper", "lib/shared.ts");
      const contract = {
        ...entity("RequestContract", "contracts/request.ts"),
        kind: "type" as const,
        signature: "type RequestContract = { message: string }",
      };
      const test = entity("requestTest", "tests/request.test.ts");
      const config = {
        ...entity("testConfig", "vitest.config.ts"),
        kind: "file" as const,
        name: "vitest.config.ts",
      };
      const entities = [entry, helper, contract, test, config];
      const edge = {
        ...call("entry-helper", entry.id, helper.id),
        filePath: entry.filePath,
        sourceHash: entry.sourceHash,
      };
      const { reader } = makeReader({
        entities,
        callsites: [edge],
        modules: [
          {
            id: "checkout",
            name: "Checkout subsystem",
            summary:
              "Checkout responsibilities use shared helpers and the request contract. Test and configuration paths are available check sources.",
            entityIds: entities.map((entity) => entity.id),
            filePaths: entities.map((entity) => entity.filePath),
            dependsOnModuleIds: [],
            provenance: "llm",
            freshness: "current",
            evidenceIds: [],
          },
        ],
        flows: [
          {
            id: "fulfillment",
            name: "Fulfillment pipeline",
            summary: "Entry calls the shared helper.",
            entryEntityIds: [entry.id],
            exitEntityIds: [helper.id],
            steps: [
              {
                order: 0,
                entityId: entry.id,
                description: "Call shared helper",
                evidenceIds: ["flow-call"],
              },
              { order: 1, entityId: helper.id, description: "Return the result", evidenceIds: [] },
            ],
            provenance: "llm",
            freshness: "current",
            evidenceIds: ["flow-call"],
          },
        ],
        evidence: [
          {
            id: "flow-call",
            filePath: edge.filePath,
            sourceHash: edge.sourceHash,
            range: edge.range,
            provenance: "compiler",
          },
        ],
        gaps: [
          {
            id: "test-candidate",
            kind: "unresolved-call",
            message: "Test is a filename candidate, not a confirmed caller.",
            filePath: test.filePath,
            entityId: test.id,
            retryable: false,
          },
        ],
      });
      for (const text of ["entry"]) {
        const result = yield* query({ operation: "task", text, scopes: [entry.filePath] }, reader);
        expect(result.modules).toEqual([]);
        expect(result.flows).toEqual([]);
        expect(result.entities.map((entity) => entity.id)).toEqual(
          expect.arrayContaining([entry.id, helper.id]),
        );
        expect(result.entities.map((entity) => entity.id)).not.toContain(contract.id);
        expect(result.evidence.map((source) => source.filePath)).not.toContain(test.filePath);
        expect(result.callsites.map((call) => call.id)).toContain(edge.id);
        expect(result.callsites.some((call) => call.callerEntityId === test.id)).toBe(false);
        expect(result.gaps.some((gap) => gap.id === "test-candidate")).toBe(false);
        expect(result.verification).toMatchObject({
          checks: "not-run",
          sourceHashes: { state: "complete", matchedFiles: 2 },
        });
        const service = ProjectContextQuery.of({
          query: (request) => {
            const { projectId: _projectId, threadId: _threadId, ...input } = request;
            return query(input, reader).pipe(Effect.orDie);
          },
        });
        const prepared = yield* prepareProjectIndexTurnContext(
          service,
          { projectId: scope.projectId },
          text,
        );
        for (const source of [entry, helper]) expect(prepared).toContain(source.filePath);
        expect(prepared).not.toContain(contract.filePath);
        expect(Buffer.byteLength(prepared ?? "", "utf8")).toBeLessThanOrEqual(2_000);
      }
    }),
);

it.effect("expands resolved imports and keeps external and unresolved imports explicit", () =>
  Effect.gen(function* () {
    const source = entity("decodeRequest", "src/request.ts");
    const target = entity("validateRequest", "src/validation.ts");
    const imports = [
      {
        id: "workspace-import",
        filePath: source.filePath,
        sourceHash: source.sourceHash,
        range,
        importText: "import { validateRequest } from './validation'",
        specifier: "./validation",
        resolution: "workspace" as const,
        targetPath: target.filePath,
        provenance: "parser" as const,
        freshness: "current" as const,
        evidenceIds: [],
      },
      {
        id: "external-import",
        filePath: source.filePath,
        sourceHash: source.sourceHash,
        range,
        importText: "import { parse } from 'utility-kit'",
        specifier: "utility-kit",
        resolution: "external" as const,
        packageName: "utility-kit",
        provenance: "parser" as const,
        freshness: "current" as const,
        evidenceIds: [],
      },
      {
        id: "unresolved-import",
        filePath: source.filePath,
        sourceHash: source.sourceHash,
        range,
        importText: "import { missing } from './missing'",
        specifier: "./missing",
        resolution: "unresolved" as const,
        provenance: "parser" as const,
        freshness: "current" as const,
        evidenceIds: [],
      },
    ];
    const { reader } = makeReader({ entities: [source, target], imports });
    const result = yield* query(
      { operation: "task", text: "decodeRequest", scopes: [source.filePath] },
      reader,
    );
    expect(result.entities.map((item) => item.id)).toEqual(
      expect.arrayContaining([source.id, target.id]),
    );
    expect((result.imports ?? []).map((item) => item.id)).toEqual(
      expect.arrayContaining(imports.map((item) => item.id)),
    );
    expect(result.imports?.find((item) => item.id === "workspace-import")?.targetPath).toBe(
      target.filePath,
    );
    expect(result.imports?.find((item) => item.id === "external-import")?.packageName).toBe(
      "utility-kit",
    );
    expect(
      result.imports?.find((item) => item.id === "unresolved-import")?.targetPath,
    ).toBeUndefined();
    expect(formatProjectIndexTurnContext(result)).toContain("Import src/request.ts:1");
  }),
);

it.effect(
  "accepts separately bounded entity and evidence lists when their source references overlap",
  () =>
    Effect.gen(function* () {
      const aliases = Array.from({ length: 40 }, (_, index) =>
        entity(`alias${index}`, "src/aliases.ts"),
      );
      const evidence = aliases.map((alias) => ({
        id: `evidence:${alias.id}`,
        filePath: alias.filePath,
        sourceHash: alias.sourceHash,
        range: alias.range,
        provenance: "compiler" as const,
      }));
      const { reader } = makeReader({
        entities: aliases,
        evidence,
        modules: [
          {
            id: "aliases",
            name: "Aliases module",
            summary: "Manifest package containing aliases from src/aliases.ts.",
            entityIds: aliases.map((alias) => alias.id),
            evidenceIds: evidence.map((item) => item.id),
            filePaths: ["src/aliases.ts"],
            dependsOnModuleIds: [],
            provenance: "parser",
            freshness: "current",
          },
        ],
      });
      const result = yield* query(
        { operation: "task", text: "Aliases module", maxTokens: 24_000 },
        reader,
      );
      expect(result.modules[0]?.freshness).toBe("current");
      expect(result.verification?.sourceHashes).toMatchObject({
        state: "complete",
        matchedFiles: 1,
      });
    }),
);

it.effect("pages static imports with the selected entity retained and omits legacy behavior", () =>
  Effect.gen(function* () {
    const container = { ...entity("file", "math.mjs"), kind: "file" as const, name: "math.mjs" };
    const target = { ...entity("increment", "math.mjs"), containerId: container.id };
    const behavior = {
      id: "increment-behavior",
      entityIds: [target.id],
      summary: "Increment returns its input plus one. ".repeat(60),
      inputs: ["value"],
      outputs: ["value + 1"],
      sideEffects: [],
      errorPaths: ["JavaScript addition preserves its normal coercion and errors."],
      invariants: [],
      provenance: "llm" as const,
      freshness: "current" as const,
      evidenceIds: [],
    };
    const imports = ["module-a", "module-b", "module-c"].map((id) => ({
      id,
      filePath: target.filePath,
      sourceHash: target.sourceHash,
      range,
      importText: `import '${id}'`,
      specifier: id,
      resolution: "external" as const,
      packageName: id,
      provenance: "parser" as const,
      freshness: "current" as const,
      evidenceIds: [],
    }));
    const { reader } = makeReader({
      entities: [target, container],
      behaviors: [behavior],
      imports,
    });
    const input = { operation: "entity" as const, entityId: target.id, limit: 1 };
    const first = yield* query(input, reader);
    expect(first.behaviors).toEqual([]);
    expect(first.entities.map((record) => record.id)).toContain(container.id);
    expect(first.nextCursor).not.toBeNull();
    const found = new Set((first.imports ?? []).map((item) => item.id));
    const cursors = new Set<string>();
    let cursor = first.nextCursor;
    for (let page = 0; cursor !== null && page < 8; page += 1) {
      expect(cursors.has(cursor)).toBe(false);
      cursors.add(cursor);
      const result = yield* query({ ...input, cursor }, reader);
      expect(result.entities.map((record) => record.id)).toContain(target.id);
      expect(result.verification?.checks).toBe("not-run");
      expect(result.estimatedTokens).toBeLessThanOrEqual(6_000);
      for (const item of result.imports ?? []) found.add(item.id);
      cursor = result.nextCursor;
    }
    expect(cursor).toBeNull();
    expect([...found].sort()).toEqual(imports.map((item) => item.id));
  }),
);

it.effect("points to the original AGENTS file when a complete rule exceeds the answer budget", () =>
  Effect.gen(function* () {
    const target = entity("increment", "math.mjs");
    const document = { ...entity("guide", "AGENTS.md"), kind: "file" as const };
    const evidence = {
      id: "guide-evidence",
      filePath: document.filePath,
      sourceHash: document.sourceHash,
      range,
      provenance: "parser" as const,
    };
    const rule = {
      id: "large-rule",
      name: "AGENTS.md",
      description: "Read the original rule before editing. ".repeat(180),
      severity: "info" as const,
      source: "explicit" as const,
      appliesToEntityIds: [target.id],
      provenance: "parser" as const,
      freshness: "current" as const,
      evidenceIds: [evidence.id],
    };
    const { reader } = makeReader({
      entities: [target, document],
      rules: [rule],
      evidence: [evidence],
    });
    const input = { operation: "entity" as const, entityId: target.id };
    const bounded = yield* query(input, reader);
    expect(bounded.rules).toEqual([]);
    expect(bounded.truncated).toBe(true);
    expect(
      bounded.gaps.some(
        (gap) =>
          gap.id === `budget:${rule.id}` &&
          gap.filePath === document.filePath &&
          gap.message.includes("workspace_read"),
      ),
    ).toBe(true);
    expect(formatProjectIndexTurnContext(bounded)).toContain(
      `Read original rule file: ${document.filePath}`,
    );
    const expanded = yield* query({ ...input, maxTokens: 12_000 }, reader);
    expect(expanded.rules[0]?.description).toBe(rule.description);
    expect(
      expanded.rules[0]?.evidenceIds.every((id) =>
        expanded.evidence.some((source) => source.id === id),
      ),
    ).toBe(true);
    expect(expanded.evidence.some((source) => source.filePath === document.filePath)).toBe(true);
    expect(expanded.estimatedTokens).toBeLessThanOrEqual(12_000);
  }),
);

it.effect(
  "bounds recursive impact and preserves candidate edges without traversing them as certain",
  () =>
    Effect.gen(function* () {
      const candidate = {
        ...call("candidate", "maybe", "a"),
        resolution: "candidate" as const,
        targetEntityIds: ["a", "b"],
      };
      const { reader } = makeReader({
        callsites: [
          call("a-b", "a", "b"),
          call("b-a", "b", "a"),
          candidate,
          call("beyond-candidate", "unsafe", "maybe"),
        ],
      });
      const impact = yield* projectContextImpact(reader, "a", 1);
      expect(impact.callsites.map(({ id }) => id)).toEqual(["a-b", "b-a", "candidate"]);
      expect(impact.truncated).toBe(false);
    }),
);

it.effect("does not follow an impact path through an intermediate source that changed", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({
      entities: [entity("a"), entity("b"), entity("c")],
      callsites: [call("b-a", "b", "a"), call("c-b", "c", "b")],
    });
    const result = yield* queryProjectContext({
      scope,
      workspaceRoot: "/trusted/worktree",
      reader,
      input: { operation: "impact", entityId: "a", includeStale: true },
      readHash: (_root, filePath) =>
        Effect.succeed(filePath === "src/b.ts" ? "changed" : `hash:${filePath}`),
    });
    expect(result.callsites.map(({ id }) => id)).toEqual(["b-a"]);
    expect(result.callsites[0]?.freshness).toBe("stale");
    expect(result.gaps.some((gap) => gap.filePath === "src/b.ts")).toBe(true);
  }),
);

it.effect("never returns legacy LLM summaries, including during refresh or includeStale", () =>
  Effect.gen(function* () {
    const { reader } = makeReader({
      entities: [entity("target")],
      modules: [
        {
          id: "module",
          name: "Target module",
          summary: "Potentially stale dependency semantics",
          entityIds: ["target"],
          filePaths: [],
          dependsOnModuleIds: [],
          provenance: "llm",
          freshness: "current",
          evidenceIds: [],
        },
      ],
    });
    for (const status of ["running", "paused", "cancelled"] as const) {
      const refreshing = {
        ...reader,
        getState: () =>
          reader.getState().pipe(Effect.map((state) => ({ ...state, status, activeRevision: 2 }))),
      };
      const result = yield* query({ operation: "task", text: "target" }, refreshing);
      expect(result.entities[0]?.freshness).toBe("current");
      expect(result.modules).toEqual([]);
      const stale = yield* query(
        { operation: "task", text: "target", includeStale: true },
        refreshing,
      );
      expect(stale.modules).toEqual([]);
    }
  }),
);

it.effect("rejects a budget that cannot contain the required scope metadata", () =>
  Effect.gen(function* () {
    const longScope = { ...scope, scopeId: "s".repeat(512), workspaceFingerprint: "f".repeat(256) };
    expect(
      yield* query({ operation: "overview", maxTokens: 1_024 }, null, longScope).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid-request" });
  }),
);

it.effect(
  "returns coverage from the published revision while a refresh updates live progress",
  () =>
    Effect.gen(function* () {
      const { reader } = makeReader({ entities: [entity("current")] });
      const publishedCoverage = {
        ...EMPTY_PROJECT_INDEX_COVERAGE,
        indexedFiles: 1,
        totalEntities: 1,
      };
      const refreshing = {
        ...reader,
        getState: () =>
          reader.getState().pipe(
            Effect.map((state) => ({
              ...state,
              status: "running" as const,
              activeRevision: 2,
              coverage: { ...EMPTY_PROJECT_INDEX_COVERAGE, indexedFiles: 99, totalEntities: 999 },
            })),
          ),
        getCoverage: (revision: number) => {
          expect(revision).toBe(1);
          return Effect.succeed(publishedCoverage);
        },
      };
      const result = yield* query({ operation: "search", text: "current" }, refreshing);
      expect(result.revision).toBe(1);
      expect(result.coverage).toEqual(publishedCoverage);
    }),
);
