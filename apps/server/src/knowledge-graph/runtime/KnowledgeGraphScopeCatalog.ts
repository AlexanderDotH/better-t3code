// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  type EnvironmentId,
  type KnowledgeGraphScopeInput,
  KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";

export const KnowledgeGraphScopeResolutionReason = Schema.Literals([
  "project-not-found",
  "thread-not-found",
  "thread-project-mismatch",
  "workspace-root-unavailable",
]);
export type KnowledgeGraphScopeResolutionReason = typeof KnowledgeGraphScopeResolutionReason.Type;

export class KnowledgeGraphScopeResolutionError extends Schema.TaggedErrorClass<KnowledgeGraphScopeResolutionError>()(
  "KnowledgeGraphScopeResolutionError",
  {
    reason: KnowledgeGraphScopeResolutionReason,
    projectId: Schema.optional(Schema.String),
    threadId: Schema.optional(Schema.String),
    workspaceRoot: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Knowledge Graph scope resolution failed (${this.reason}).`;
  }
}

interface ScopeProject {
  readonly id: ProjectId;
  readonly workspaceRoot: string;
}

interface ScopeThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}

interface ScopeShellSnapshot {
  readonly projects: ReadonlyArray<ScopeProject>;
  readonly threads: ReadonlyArray<ScopeThread>;
}

export interface KnowledgeGraphScopeCatalogDependencies {
  readonly getEnvironmentId: Effect.Effect<EnvironmentId, Error>;
  readonly getShellSnapshot: Effect.Effect<ScopeShellSnapshot, Error>;
  readonly canonicalizeWorkspaceRoot: (workspaceRoot: string) => Effect.Effect<string, Error>;
}

export interface KnowledgeGraphResolvedThreadScope {
  readonly projectId: ProjectId;
  readonly scope: KnowledgeGraphScopeV1;
}

export interface KnowledgeGraphScopeCatalogShape {
  readonly getEnvironmentId: Effect.Effect<EnvironmentId, KnowledgeGraphScopeResolutionError>;
  readonly resolveScope: (
    input: KnowledgeGraphScopeInput,
  ) => Effect.Effect<KnowledgeGraphScopeV1, KnowledgeGraphScopeResolutionError>;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<KnowledgeGraphResolvedThreadScope, KnowledgeGraphScopeResolutionError>;
  readonly listKnownScopes: () => Effect.Effect<
    ReadonlyArray<KnowledgeGraphScopeV1>,
    KnowledgeGraphScopeResolutionError
  >;
}

export class KnowledgeGraphScopeCatalog extends Context.Service<
  KnowledgeGraphScopeCatalog,
  KnowledgeGraphScopeCatalogShape
>()("t3/knowledge-graph/runtime/KnowledgeGraphScopeCatalog") {}

function scopeId(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly effectiveWorkspaceRoot: string;
}): KnowledgeGraphScopeId {
  const digest = NodeCrypto.createHash("sha256")
    .update(input.environmentId)
    .update("\0")
    .update(input.projectId)
    .update("\0")
    .update(input.effectiveWorkspaceRoot)
    .digest("hex");
  return KnowledgeGraphScopeId.make(`kg:${digest}`);
}

export function makeKnowledgeGraphScopeCatalog(
  dependencies: KnowledgeGraphScopeCatalogDependencies,
): KnowledgeGraphScopeCatalogShape {
  const readShell = dependencies.getShellSnapshot.pipe(
    Effect.mapError(
      (cause) =>
        new KnowledgeGraphScopeResolutionError({
          reason: "workspace-root-unavailable",
          cause,
        }),
    ),
  );
  const readEnvironmentId = dependencies.getEnvironmentId.pipe(
    Effect.mapError(
      (cause) =>
        new KnowledgeGraphScopeResolutionError({
          reason: "workspace-root-unavailable",
          cause,
        }),
    ),
  );

  const makeScope = Effect.fn("KnowledgeGraphScopeCatalog.makeScope")(function* (input: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly projectWorkspaceRoot: string;
  }) {
    const effectiveWorkspaceRoot = yield* dependencies
      .canonicalizeWorkspaceRoot(input.workspaceRoot)
      .pipe(
        Effect.mapError(
          (cause) =>
            new KnowledgeGraphScopeResolutionError({
              reason: "workspace-root-unavailable",
              projectId: input.projectId,
              workspaceRoot: input.workspaceRoot,
              cause,
            }),
        ),
      );
    const canonicalProjectRoot = yield* dependencies
      .canonicalizeWorkspaceRoot(input.projectWorkspaceRoot)
      .pipe(
        Effect.mapError(
          (cause) =>
            new KnowledgeGraphScopeResolutionError({
              reason: "workspace-root-unavailable",
              projectId: input.projectId,
              workspaceRoot: input.projectWorkspaceRoot,
              cause,
            }),
        ),
      );
    return {
      version: 1,
      scopeId: scopeId({
        environmentId: input.environmentId,
        projectId: input.projectId,
        effectiveWorkspaceRoot,
      }),
      environmentId: input.environmentId,
      projectId: input.projectId,
      effectiveWorkspaceRoot,
      isWorktree: effectiveWorkspaceRoot !== canonicalProjectRoot,
    } satisfies KnowledgeGraphScopeV1;
  });

  const resolveScope = Effect.fn("KnowledgeGraphScopeCatalog.resolveScope")(function* (
    input: KnowledgeGraphScopeInput,
  ) {
    const [environmentId, shell] = yield* Effect.all([readEnvironmentId, readShell]);
    const project = shell.projects.find(({ id }) => id === input.projectId);
    if (project === undefined) {
      return yield* new KnowledgeGraphScopeResolutionError({
        reason: "project-not-found",
        projectId: input.projectId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      });
    }
    if (input.threadId === undefined) {
      return yield* makeScope({
        environmentId,
        projectId: project.id,
        workspaceRoot: project.workspaceRoot,
        projectWorkspaceRoot: project.workspaceRoot,
      });
    }
    const thread = shell.threads.find(({ id }) => id === input.threadId);
    if (thread === undefined) {
      return yield* new KnowledgeGraphScopeResolutionError({
        reason: "thread-not-found",
        projectId: input.projectId,
        threadId: input.threadId,
      });
    }
    if (thread.projectId !== project.id) {
      return yield* new KnowledgeGraphScopeResolutionError({
        reason: "thread-project-mismatch",
        projectId: input.projectId,
        threadId: input.threadId,
      });
    }
    return yield* makeScope({
      environmentId,
      projectId: project.id,
      workspaceRoot: thread.worktreePath ?? project.workspaceRoot,
      projectWorkspaceRoot: project.workspaceRoot,
    });
  });

  const resolveThread = Effect.fn("KnowledgeGraphScopeCatalog.resolveThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* readShell;
    const thread = shell.threads.find(({ id }) => id === threadId);
    if (thread === undefined) {
      return yield* new KnowledgeGraphScopeResolutionError({
        reason: "thread-not-found",
        threadId,
      });
    }
    return {
      projectId: thread.projectId,
      scope: yield* resolveScope({ projectId: thread.projectId, threadId }),
    };
  });

  const listKnownScopes = Effect.fn("KnowledgeGraphScopeCatalog.listKnownScopes")(function* () {
    const [environmentId, shell] = yield* Effect.all([readEnvironmentId, readShell]);
    const projectsById = new Map(shell.projects.map((project) => [project.id, project] as const));
    const requestedScopes = new Map<
      string,
      {
        readonly project: ScopeProject;
        readonly workspaceRoot: string;
      }
    >();
    for (const project of shell.projects) {
      requestedScopes.set(`${project.id}\0${project.workspaceRoot}`, {
        project,
        workspaceRoot: project.workspaceRoot,
      });
    }
    for (const thread of shell.threads) {
      if (thread.worktreePath === null) continue;
      const project = projectsById.get(thread.projectId);
      if (project === undefined) continue;
      const key = `${project.id}\0${thread.worktreePath}`;
      if (requestedScopes.has(key)) continue;
      requestedScopes.set(key, {
        project,
        workspaceRoot: thread.worktreePath,
      });
    }
    const scopes = yield* Effect.forEach(requestedScopes.values(), ({ project, workspaceRoot }) => {
      const resolved = makeScope({
        environmentId,
        projectId: project.id,
        workspaceRoot,
        projectWorkspaceRoot: project.workspaceRoot,
      });
      return Effect.orElseSucceed(resolved, () => null);
    });
    const availableScopes = scopes.filter(
      (scope): scope is KnowledgeGraphScopeV1 => scope !== null,
    );
    const canonicalScopes = new Map(
      availableScopes.map((scope) => [scope.scopeId, scope] as const),
    );
    return [...canonicalScopes.values()].sort((left, right) => {
      const leftKey = `${left.effectiveWorkspaceRoot}\0${left.projectId}`;
      const rightKey = `${right.effectiveWorkspaceRoot}\0${right.projectId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  });

  return {
    getEnvironmentId: readEnvironmentId,
    resolveScope,
    resolveThread,
    listKnownScopes,
  };
}

export const layer = Layer.effect(
  KnowledgeGraphScopeCatalog,
  Effect.gen(function* () {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return KnowledgeGraphScopeCatalog.of(
      makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: environment.getEnvironmentId,
        getShellSnapshot: projections.getShellSnapshot(),
        canonicalizeWorkspaceRoot: (workspaceRoot) =>
          fileSystem.realPath(path.resolve(workspaceRoot)),
      }),
    );
  }),
);
