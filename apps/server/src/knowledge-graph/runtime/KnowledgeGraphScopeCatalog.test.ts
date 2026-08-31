import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeKnowledgeGraphScopeCatalog } from "./KnowledgeGraphScopeCatalog.ts";

const environmentId = EnvironmentId.make("environment-1");
const projectOne = ProjectId.make("project-1");
const projectTwo = ProjectId.make("project-2");
const mainThread = ThreadId.make("thread-main");
const featureThread = ThreadId.make("thread-feature");

const shell = {
  projects: [
    { id: projectOne, workspaceRoot: "/repo" },
    { id: projectTwo, workspaceRoot: "/other" },
  ],
  threads: [
    { id: mainThread, projectId: projectOne, worktreePath: null },
    { id: featureThread, projectId: projectOne, worktreePath: "/repo-worktrees/feature" },
  ],
};

const catalog = makeKnowledgeGraphScopeCatalog({
  getEnvironmentId: Effect.succeed(environmentId),
  getShellSnapshot: Effect.succeed(shell),
  canonicalizeWorkspaceRoot: (root) => Effect.succeed(`/canonical${root}`),
});

describe("KnowledgeGraphScopeCatalog", () => {
  it.effect("isolates the project root and each known worktree into stable scopes", () =>
    Effect.gen(function* () {
      const scopes = yield* catalog.listKnownScopes();

      assert.strictEqual(scopes.length, 3);
      assert.deepStrictEqual(
        scopes.map((scope) => [scope.projectId, scope.effectiveWorkspaceRoot, scope.isWorktree]),
        [
          [projectTwo, "/canonical/other", false],
          [projectOne, "/canonical/repo", false],
          [projectOne, "/canonical/repo-worktrees/feature", true],
        ],
      );
      assert.strictEqual(new Set(scopes.map((scope) => scope.scopeId)).size, 3);
      assert.deepStrictEqual(yield* catalog.listKnownScopes(), scopes);
    }),
  );

  it.effect("resolves a thread only inside its owning project", () =>
    Effect.gen(function* () {
      const scope = yield* catalog.resolveScope({
        projectId: projectOne,
        threadId: featureThread,
      });

      assert.strictEqual(scope.effectiveWorkspaceRoot, "/canonical/repo-worktrees/feature");
      assert.strictEqual(scope.isWorktree, true);

      const error = yield* Effect.flip(
        catalog.resolveScope({ projectId: projectTwo, threadId: featureThread }),
      );
      assert.strictEqual(error.reason, "thread-project-mismatch");
    }),
  );

  it.effect("derives the current project scope from an authenticated thread", () =>
    Effect.gen(function* () {
      const resolved = yield* catalog.resolveThread(featureThread);

      assert.strictEqual(resolved.projectId, projectOne);
      assert.strictEqual(
        resolved.scope.effectiveWorkspaceRoot,
        "/canonical/repo-worktrees/feature",
      );
    }),
  );

  it.effect("deduplicates live worktree aliases by canonical effective root", () =>
    Effect.gen(function* () {
      const aliasCatalog = makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: Effect.succeed(environmentId),
        getShellSnapshot: Effect.succeed({
          projects: [{ id: projectOne, workspaceRoot: "/repo" }],
          threads: [
            { id: mainThread, projectId: projectOne, worktreePath: "/worktrees/feature" },
            { id: featureThread, projectId: projectOne, worktreePath: "/aliases/feature" },
          ],
        }),
        canonicalizeWorkspaceRoot: (root) =>
          Effect.succeed(root === "/repo" ? "/canonical/repo" : "/canonical/worktrees/feature"),
      });

      const scopes = yield* aliasCatalog.listKnownScopes();

      assert.deepStrictEqual(
        scopes.map(({ effectiveWorkspaceRoot }) => effectiveWorkspaceRoot),
        ["/canonical/repo", "/canonical/worktrees/feature"],
      );
      assert.strictEqual(new Set(scopes.map(({ scopeId }) => scopeId)).size, scopes.length);
    }),
  );

  it.effect("keeps registered projects available when a stale worktree disappeared", () =>
    Effect.gen(function* () {
      const catalogWithStaleWorktree = makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: Effect.succeed(environmentId),
        getShellSnapshot: Effect.succeed({
          projects: [{ id: projectOne, workspaceRoot: "/repo" }],
          threads: [
            { id: featureThread, projectId: projectOne, worktreePath: "/deleted-worktree" },
          ],
        }),
        canonicalizeWorkspaceRoot: (root) =>
          root === "/deleted-worktree"
            ? Effect.fail(new Error("worktree no longer exists"))
            : Effect.succeed("/canonical/repo"),
      });

      const scopes = yield* catalogWithStaleWorktree.listKnownScopes();

      assert.deepStrictEqual(
        scopes.map(({ effectiveWorkspaceRoot }) => effectiveWorkspaceRoot),
        ["/canonical/repo"],
      );
    }),
  );

  it.effect("retains the environment identity after the last project is removed", () =>
    Effect.gen(function* () {
      const emptyCatalog = makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: Effect.succeed(environmentId),
        getShellSnapshot: Effect.succeed({ projects: [], threads: [] }),
        canonicalizeWorkspaceRoot: (root) => Effect.succeed(root),
      });

      assert.strictEqual(yield* emptyCatalog.getEnvironmentId, environmentId);
      assert.deepStrictEqual(yield* emptyCatalog.listKnownScopes(), []);
    }),
  );

  it.effect("keeps healthy projects indexable when another registered root disappeared", () =>
    Effect.gen(function* () {
      const catalogWithMissingProject = makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: Effect.succeed(environmentId),
        getShellSnapshot: Effect.succeed({
          projects: [
            { id: projectOne, workspaceRoot: "/missing" },
            { id: projectTwo, workspaceRoot: "/healthy" },
          ],
          threads: [],
        }),
        canonicalizeWorkspaceRoot: (root) =>
          root === "/missing"
            ? Effect.fail(new Error("project root no longer exists"))
            : Effect.succeed("/canonical/healthy"),
      });

      const scopes = yield* catalogWithMissingProject.listKnownScopes();
      assert.deepStrictEqual(
        scopes.map(({ projectId, effectiveWorkspaceRoot }) => [projectId, effectiveWorkspaceRoot]),
        [[projectTwo, "/canonical/healthy"]],
      );
    }),
  );
});
