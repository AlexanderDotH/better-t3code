// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type { KnowledgeGraphScopeV1, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as KnowledgeGraphScopeCatalog from "../../knowledge-graph/runtime/KnowledgeGraphScopeCatalog.ts";
import * as KnowledgeGraphWatcherMultiplexer from "../../knowledge-graph/runtime/KnowledgeGraphWatcherMultiplexer.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  ProjectIndexingBridge,
  type ResolvedProjectIndexScope,
} from "../runtime/ProjectIndexingBridge.ts";
import { makeProjectIndexDiffReader } from "./ProjectIndexDiff.ts";
import { makeProjectIndexGenerator } from "./ProjectIndexGeneration.ts";
import { projectIndexScopeError } from "./ProjectIndexScopeErrors.ts";
import {
  ProjectIndexModelError,
  isProjectIndexModelError,
  resolveProjectIndexModel,
} from "./ProjectIndexModel.ts";

function resolvedScope(
  scope: KnowledgeGraphScopeV1,
  threadId?: ThreadId,
): ResolvedProjectIndexScope {
  return {
    workspaceRoot: scope.effectiveWorkspaceRoot,
    scope: {
      scopeId: scope.scopeId,
      projectId: scope.projectId,
      ...(threadId === undefined ? {} : { threadId }),
      workspaceFingerprint: NodeCrypto.createHash("sha256")
        .update(scope.effectiveWorkspaceRoot)
        .digest("hex"),
    },
  };
}

const make = Effect.gen(function* () {
  const catalog = yield* KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog;
  const watcher = yield* KnowledgeGraphWatcherMultiplexer.KnowledgeGraphWatcherMultiplexer;
  const registry = yield* ProviderRegistry;
  const providers = yield* ProviderService;
  const projections = yield* ProjectionSnapshotQuery;
  const generate = yield* makeProjectIndexGenerator;
  const readDiff = yield* makeProjectIndexDiffReader;

  const resolveScope: ProjectIndexingBridge["Service"]["resolveScope"] = Effect.fn(
    "ProjectIndexingBridge.resolveScope",
  )(function* (input) {
    return resolvedScope(
      yield* catalog.resolveScope(input).pipe(Effect.mapError(projectIndexScopeError)),
      input.threadId,
    );
  });

  const listScopes: ProjectIndexingBridge["Service"]["listScopes"] = Effect.fn(
    "ProjectIndexingBridge.listScopes",
  )(function* () {
    const scopes = yield* catalog.listKnownScopes();
    const shell = yield* projections.getShellSnapshot();
    const worktreeOwners = new Map<string, ThreadId>();
    for (const thread of shell.threads) {
      if (thread.worktreePath === null) continue;
      const resolved = yield* catalog
        .resolveScope({ projectId: thread.projectId, threadId: thread.id })
        .pipe(Effect.option);
      if (resolved._tag === "Some" && !worktreeOwners.has(resolved.value.scopeId))
        worktreeOwners.set(resolved.value.scopeId, thread.id);
    }
    return scopes.map((scope) => resolvedScope(scope, worktreeOwners.get(scope.scopeId)));
  });

  const capabilities: ProjectIndexingBridge["Service"]["capabilities"] = Effect.fn(
    "ProjectIndexingBridge.capabilities",
  )(function* (selection) {
    const available = yield* registry.getProviders;
    const model = yield* Effect.try({
      try: () => resolveProjectIndexModel(available, selection),
      catch: (cause) =>
        isProjectIndexModelError(cause)
          ? cause
          : new ProjectIndexModelError({ message: "The analysis model configuration is invalid." }),
    });
    return {
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
      supportedContextWindows: model.supportedContextWindows,
      promptOverheadTokens: model.promptOverheadTokens,
    };
  });

  const admit: ProjectIndexingBridge["Service"]["admit"] = Effect.fn("ProjectIndexingBridge.admit")(
    function* () {
      // The generator owns the resource lease. This gate avoids starting background
      // model work while a durable interactive turn is already using the environment.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const events =
            providers.subscribeEvents === undefined
              ? providers.streamEvents
              : yield* providers.subscribeEvents;
          const shell = yield* projections.getShellSnapshot();
          const interactiveIds = new Set(shell.threads.map((thread) => thread.id));
          const isBusy = providers
            .listSessions()
            .pipe(
              Effect.map((sessions) =>
                sessions.some(
                  (session) => interactiveIds.has(session.threadId) && session.status === "running",
                ),
              ),
            );
          if (!(yield* isBusy)) return;
          yield* events.pipe(
            Stream.filter(
              (event) =>
                interactiveIds.has(event.threadId) &&
                [
                  "turn.completed",
                  "turn.aborted",
                  "session.exited",
                  "session.state.changed",
                ].includes(event.type),
            ),
            Stream.filterEffect(() => isBusy.pipe(Effect.map((busy) => !busy))),
            Stream.take(1),
            Stream.runDrain,
          );
        }),
      );
      return { release: Effect.void };
    },
  );

  const reconcileWatchers: ProjectIndexingBridge["Service"]["reconcileWatchers"] = Effect.fn(
    "ProjectIndexingBridge.reconcileWatchers",
  )(function* (scopes, onChange) {
    const nativeScopes = yield* catalog.listKnownScopes();
    const byId = new Map(scopes.map((scope) => [scope.scope.scopeId, scope]));
    yield* watcher.reconcile(
      nativeScopes.filter((scope) => byId.has(scope.scopeId)),
      (changed) =>
        onChange(
          changed.flatMap((scope) => {
            const resolved = byId.get(scope.scopeId);
            return resolved === undefined ? [] : [resolved];
          }),
        ),
      "project-indexing",
    );
  });

  yield* Effect.addFinalizer(() => watcher.reconcile([], () => Effect.void, "project-indexing"));
  return ProjectIndexingBridge.of({
    resolveScope,
    listScopes,
    capabilities,
    generate,
    admit,
    readDiff,
    reconcileWatchers,
  });
});

export const layer = Layer.effect(ProjectIndexingBridge, make);
