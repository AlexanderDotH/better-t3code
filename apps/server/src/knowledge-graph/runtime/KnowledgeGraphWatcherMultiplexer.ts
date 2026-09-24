// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import type { KnowledgeGraphScopeV1 } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  isIgnoredKnowledgeGraphDirectory,
  isIgnoredKnowledgeGraphWatchPath,
  isSecretKnowledgeGraphPath,
} from "../extraction/KnowledgeGraphPathPolicy.ts";

type ScopeChangeHandler = (
  scopes: ReadonlyArray<KnowledgeGraphScopeV1>,
) => Effect.Effect<void, Error>;

interface WatchState {
  readonly scopes: ReadonlyArray<KnowledgeGraphScopeV1>;
  readonly onChange: ScopeChangeHandler;
}

interface WatchRegistration {
  readonly state: Ref.Ref<WatchState>;
  readonly fiber: Fiber.Fiber<void, never>;
}

export interface KnowledgeGraphWatcherDependencies {
  readonly debounce: Duration.Input;
  readonly watchWorkspaceRoot: (
    workspaceRoot: string,
    options: { readonly recursive: true },
  ) => Stream.Stream<{ readonly path: string }, Error>;
}

export interface KnowledgeGraphWatcherMultiplexerShape {
  readonly reconcile: (
    scopes: ReadonlyArray<KnowledgeGraphScopeV1>,
    onChange: ScopeChangeHandler,
    consumerId?: string,
  ) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly watchedRoots: Effect.Effect<ReadonlyArray<string>>;
}

export class KnowledgeGraphWatcherMultiplexer extends Context.Service<
  KnowledgeGraphWatcherMultiplexer,
  KnowledgeGraphWatcherMultiplexerShape
>()("t3/knowledge-graph/runtime/KnowledgeGraphWatcherMultiplexer") {}

function groupScopesByRoot(
  scopes: ReadonlyArray<KnowledgeGraphScopeV1>,
): ReadonlyMap<string, ReadonlyArray<KnowledgeGraphScopeV1>> {
  const grouped = new Map<string, Map<string, KnowledgeGraphScopeV1>>();
  for (const scope of scopes) {
    const rootScopes = grouped.get(scope.effectiveWorkspaceRoot) ?? new Map();
    rootScopes.set(scope.scopeId, scope);
    grouped.set(scope.effectiveWorkspaceRoot, rootScopes);
  }
  return new Map(
    [...grouped.entries()].map(([root, rootScopes]) => [
      root,
      [...rootScopes.values()].sort((left, right) =>
        String(left.scopeId).localeCompare(String(right.scopeId)),
      ),
    ]),
  );
}

function relativeWatchPath(workspaceRoot: string, eventPath: string): string | null {
  const absoluteEventPath = NodePath.isAbsolute(eventPath)
    ? NodePath.resolve(eventPath)
    : NodePath.resolve(workspaceRoot, eventPath);
  const relativePath = NodePath.relative(workspaceRoot, absoluteEventPath).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../")) return null;
  return relativePath;
}

function isProjectIndexMetadataChange(relativePath: string): boolean {
  if (isSecretKnowledgeGraphPath(relativePath)) return false;
  if (/^\.git\/(?:HEAD$|index$|refs\/heads\/)/.test(relativePath)) return true;
  const segments = relativePath.split("/");
  const filename = segments.at(-1) ?? "";
  const directories = segments.slice(0, -1);
  const isAssetsManifest = filename === "project.assets.json" && directories.at(-1) === "obj";
  const isRuleDirectory = (directory: string) =>
    directory === ".agents" || directory === ".claude" || directory === ".cursor";
  if (
    directories.some(
      (directory) =>
        isIgnoredKnowledgeGraphDirectory(directory) &&
        !isRuleDirectory(directory) &&
        !(directory === "obj" && isAssetsManifest),
    )
  ) {
    return false;
  }
  return (
    isAssetsManifest ||
    directories.some(isRuleDirectory) ||
    /^\.(?:editorconfig|gitignore|gitattributes|eslintrc(?:\.[^/]+)?|prettierrc(?:\.[^/]+)?)$/.test(
      filename,
    )
  );
}

export const makeKnowledgeGraphWatcherMultiplexer = Effect.fn(
  "KnowledgeGraphWatcherMultiplexer.make",
)(function* (
  dependencies: KnowledgeGraphWatcherDependencies,
): Effect.fn.Return<KnowledgeGraphWatcherMultiplexerShape, never, Scope.Scope> {
  const watcherScope = yield* Scope.Scope;
  const registrations = yield* Ref.make(new Map<string, WatchRegistration>());
  const semaphore = yield* Semaphore.make(1);
  const consumers = new Map<string, WatchState>();
  const consumerSemaphore = yield* Semaphore.make(1);

  const startRegistration = Effect.fn("KnowledgeGraphWatcherMultiplexer.startRegistration")(
    function* (workspaceRoot: string, state: WatchState) {
      const stateRef = yield* Ref.make(state);
      const fiber = yield* Effect.suspend(() =>
        dependencies.watchWorkspaceRoot(workspaceRoot, { recursive: true }).pipe(
          Stream.filter((event) => {
            const relativePath = relativeWatchPath(workspaceRoot, event.path);
            return (
              relativePath !== null &&
              (!isIgnoredKnowledgeGraphWatchPath(relativePath) ||
                (consumers
                  .get("project-indexing")
                  ?.scopes.some((scope) => scope.effectiveWorkspaceRoot === workspaceRoot) ===
                  true &&
                  isProjectIndexMetadataChange(relativePath)))
            );
          }),
          Stream.debounce(dependencies.debounce),
          Stream.runForEach(() =>
            Ref.get(stateRef).pipe(
              Effect.flatMap((current) => current.onChange(current.scopes)),
              Effect.catchCause((cause) =>
                Effect.logWarning("Knowledge Graph filesystem change handling failed", {
                  workspaceRoot,
                  cause,
                }),
              ),
            ),
          ),
        ),
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Knowledge Graph workspace watcher stopped", {
            workspaceRoot,
            cause,
          }),
        ),
        Effect.retry({ schedule: Schedule.spaced("1 second") }),
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph workspace watcher could not restart", {
            workspaceRoot,
            cause,
          }),
        ),
        Effect.forkIn(watcherScope),
      );
      return { state: stateRef, fiber } satisfies WatchRegistration;
    },
  );

  const reconcileAll = (
    scopes: ReadonlyArray<KnowledgeGraphScopeV1>,
    onChange: ScopeChangeHandler,
  ) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const nextByRoot = groupScopesByRoot(scopes);
        const current = yield* Ref.get(registrations);
        const next = new Map<string, WatchRegistration>();

        for (const [workspaceRoot, rootScopes] of nextByRoot) {
          const existing = current.get(workspaceRoot);
          if (existing !== undefined) {
            yield* Ref.set(existing.state, { scopes: rootScopes, onChange });
            next.set(workspaceRoot, existing);
            continue;
          }
          next.set(
            workspaceRoot,
            yield* startRegistration(workspaceRoot, { scopes: rootScopes, onChange }),
          );
        }

        for (const [workspaceRoot, registration] of current) {
          if (nextByRoot.has(workspaceRoot)) continue;
          yield* Fiber.interrupt(registration.fiber);
        }
        yield* Ref.set(registrations, next);
      }),
    );

  const reconcile: KnowledgeGraphWatcherMultiplexerShape["reconcile"] = (
    scopes,
    onChange,
    consumerId = "knowledge-graph",
  ) =>
    consumerSemaphore.withPermits(1)(
      Effect.gen(function* () {
        if (scopes.length === 0) consumers.delete(consumerId);
        else consumers.set(consumerId, { scopes, onChange });
        const active = [...consumers.values()];
        const allScopes = [
          ...new Map(
            active
              .flatMap((consumer) => consumer.scopes)
              .map((scope) => [scope.scopeId, scope] as const),
          ).values(),
        ];
        yield* reconcileAll(allScopes, (changed) =>
          Effect.forEach(
            active,
            (consumer) => {
              const matching = changed.filter((scope) =>
                consumer.scopes.some((owned) => owned.scopeId === scope.scopeId),
              );
              return matching.length === 0
                ? Effect.void
                : consumer
                    .onChange(matching)
                    .pipe(
                      Effect.catchCause((cause) =>
                        Effect.logWarning("Knowledge Graph watcher consumer failed", { cause }),
                      ),
                    );
            },
            { discard: true },
          ),
        );
      }),
    );

  const clear = reconcile([], () => Effect.void);

  return {
    reconcile,
    clear,
    watchedRoots: Ref.get(registrations).pipe(Effect.map((current) => [...current.keys()].sort())),
  };
});

export const layer = Layer.effect(
  KnowledgeGraphWatcherMultiplexer,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return KnowledgeGraphWatcherMultiplexer.of(
      yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: Duration.millis(175),
        watchWorkspaceRoot: (workspaceRoot, options) => fileSystem.watch(workspaceRoot, options),
      }),
    );
  }),
);
