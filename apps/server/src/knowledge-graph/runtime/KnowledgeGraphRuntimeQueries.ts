import {
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
  type KnowledgeGraphOperationError,
  type KnowledgeGraphQueryBatchInput,
  type KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import type * as KnowledgeGraphRepository from "../persistence/KnowledgeGraphRepository.ts";
import type * as KnowledgeGraphEventHub from "./KnowledgeGraphEventHub.ts";
import type * as KnowledgeGraphScopeCatalog from "./KnowledgeGraphScopeCatalog.ts";
import { graphError, type KnowledgeGraphRuntime } from "./KnowledgeGraphRuntimeService.ts";

export interface KnowledgeGraphRuntimeQueryDependencies {
  readonly repository: KnowledgeGraphRepository.KnowledgeGraphRepository["Service"];
  readonly catalog: KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog["Service"];
  readonly eventHub: KnowledgeGraphEventHub.KnowledgeGraphEventHub["Service"];
  readonly workspaceFiles: WorkspaceFileSystem.WorkspaceFileSystem["Service"];
  readonly resolveScope: (
    input: Parameters<KnowledgeGraphRuntime["Service"]["cancel"]>[0],
  ) => Effect.Effect<KnowledgeGraphScopeV1, KnowledgeGraphOperationError>;
  readonly requireEnabled: (
    operation: string,
    scopeId?: KnowledgeGraphScopeId,
  ) => Effect.Effect<void, KnowledgeGraphOperationError>;
}

export function makeKnowledgeGraphRuntimeQueries(
  dependencies: KnowledgeGraphRuntimeQueryDependencies,
): Pick<
  KnowledgeGraphRuntime["Service"],
  "subscribe" | "query" | "queryForThread" | "nodeContent"
> {
  const mapPersistenceError = (operation: string, scopeId?: KnowledgeGraphScopeId) =>
    Effect.mapError(() =>
      graphError({
        operation,
        code: "persistence",
        retryable: true,
        detail: "The Knowledge Graph derived-data store is unavailable.",
        ...(scopeId === undefined ? {} : { scopeId }),
      }),
    );

  const subscribe: KnowledgeGraphRuntime["Service"]["subscribe"] = Effect.fn(
    "KnowledgeGraphRuntime.subscribe",
  )(function* (input) {
    const scope = yield* dependencies.resolveScope(input.scope);
    yield* dependencies.requireEnabled("subscribe", scope.scopeId);
    yield* dependencies.repository
      .ensureScope(scope)
      .pipe(mapPersistenceError("subscribe", scope.scopeId));
    const live = yield* dependencies.eventHub.subscribe(scope.scopeId);
    const snapshot = Option.getOrThrow(
      yield* dependencies.repository
        .getSnapshot(scope.scopeId)
        .pipe(mapPersistenceError("subscribe", scope.scopeId)),
    );
    if (input.afterRevision === undefined) {
      return Stream.concat(Stream.make(snapshot), live);
    }
    if (input.afterRevision === snapshot.revision) return live;
    const patches =
      input.afterRevision < snapshot.revision
        ? yield* dependencies.repository
            .listPatchesAfter({ scopeId: scope.scopeId, afterRevision: input.afterRevision })
            .pipe(mapPersistenceError("subscribe", scope.scopeId))
        : [];
    let expected = input.afterRevision;
    const contiguous =
      patches.every((patch) => {
        const valid = patch.baseRevision === expected && patch.revision === expected + 1;
        expected = patch.revision;
        return valid;
      }) && expected === snapshot.revision;
    if (contiguous) return Stream.concat(Stream.fromIterable(patches), live);
    const invalidate: KnowledgeGraphStreamEvent = {
      version: 1,
      type: "invalidate",
      scopeId: scope.scopeId,
      reason: "revision-gap",
      expectedRevision: input.afterRevision,
      availableRevision: snapshot.revision,
    };
    return Stream.concat(Stream.fromIterable([invalidate, snapshot]), live);
  });

  const queryScope = Effect.fn("KnowledgeGraphRuntime.queryScope")(function* (
    scope: KnowledgeGraphScopeV1,
    query: KnowledgeGraphQueryBatchInput,
  ) {
    yield* dependencies.requireEnabled("query", scope.scopeId);
    yield* dependencies.repository
      .ensureScope(scope)
      .pipe(mapPersistenceError("query", scope.scopeId));
    return yield* dependencies.repository
      .query({ scopeId: scope.scopeId, query })
      .pipe(mapPersistenceError("query", scope.scopeId));
  });

  const query: KnowledgeGraphRuntime["Service"]["query"] = (input) =>
    dependencies
      .resolveScope(input.scope)
      .pipe(Effect.flatMap((scope) => queryScope(scope, { queries: input.queries })));

  const queryForThread: KnowledgeGraphRuntime["Service"]["queryForThread"] = (input) =>
    dependencies.catalog.resolveThread(input.threadId).pipe(
      Effect.mapError(() =>
        graphError({
          operation: "query",
          code: "scope-not-found",
          retryable: false,
          detail: "The authenticated thread does not resolve to a project scope.",
        }),
      ),
      Effect.flatMap(({ scope }) => queryScope(scope, input.query)),
    );

  const nodeContent: KnowledgeGraphRuntime["Service"]["nodeContent"] = Effect.fn(
    "KnowledgeGraphRuntime.nodeContent",
  )(function* (input) {
    const scope = yield* dependencies.resolveScope(input.scope);
    yield* dependencies.requireEnabled("node-content", scope.scopeId);
    const bundle = yield* dependencies.repository
      .getNodeBundle({ scopeId: scope.scopeId, nodeId: input.nodeId })
      .pipe(mapPersistenceError("node-content", scope.scopeId));
    if (Option.isNone(bundle)) {
      return yield* graphError({
        operation: "node-content",
        code: "scope-not-found",
        retryable: false,
        detail: "The requested graph node is not present in this scope.",
        scopeId: scope.scopeId,
      });
    }
    const snapshot = Option.getOrThrow(
      yield* dependencies.repository
        .getSnapshot(scope.scopeId)
        .pipe(mapPersistenceError("node-content", scope.scopeId)),
    );
    const evidenceExcerpts = bundle.value.evidence.flatMap((evidence) =>
      evidence.source === undefined || evidence.excerpt === undefined
        ? []
        : [
            {
              source: evidence.source,
              excerpt: evidence.excerpt,
              truncated: evidence.excerpt.length >= KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
              fingerprint: evidence.fingerprint,
            },
          ],
    );
    let excerpts = evidenceExcerpts;
    if (excerpts.length === 0 && bundle.value.node.source !== undefined) {
      const source = bundle.value.node.source;
      const file = yield* dependencies.workspaceFiles
        .readFile({ cwd: scope.effectiveWorkspaceRoot, relativePath: source.path })
        .pipe(Effect.option);
      if (Option.isSome(file)) {
        excerpts = [
          {
            source,
            excerpt: file.value.contents.slice(0, KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH),
            truncated:
              file.value.truncated ||
              file.value.contents.length > KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
            fingerprint: file.value.revision ?? `size:${file.value.byteLength}`,
          },
        ];
      }
    }
    return {
      version: 1,
      scope,
      revision: snapshot.revision,
      node: bundle.value.node,
      excerpts,
    };
  });

  return { subscribe, query, queryForThread, nodeContent };
}
