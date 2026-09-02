// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  isKnowledgeGraphWorkspaceRootIndexable,
  makeKnowledgeGraphScopeCatalog,
} from "./KnowledgeGraphScopeCatalog.ts";

const environmentId = EnvironmentId.make("environment-1");
const projectOne = ProjectId.make("project-1");
const projectTwo = ProjectId.make("project-2");
const rootProject = ProjectId.make("project-root");
const homeProject = ProjectId.make("project-home");
const aliasProject = ProjectId.make("project-home-alias");
const mainThread = ThreadId.make("thread-main");
const featureThread = ThreadId.make("thread-feature");
const homeDirectory = NodePath.resolve(NodePath.sep, "home", "test-user");

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
  homeDirectory,
});

describe("KnowledgeGraphScopeCatalog", () => {
  it("rejects the filesystem root and user home but permits a project below home", () => {
    assert.isFalse(
      isKnowledgeGraphWorkspaceRootIndexable(NodePath.parse(homeDirectory).root, homeDirectory),
    );
    assert.isFalse(isKnowledgeGraphWorkspaceRootIndexable(homeDirectory, homeDirectory));
    assert.isTrue(
      isKnowledgeGraphWorkspaceRootIndexable(
        NodePath.join(homeDirectory, "project"),
        homeDirectory,
      ),
    );
  });

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
        homeDirectory,
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
        homeDirectory,
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
        homeDirectory,
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
        homeDirectory,
      });

      const scopes = yield* catalogWithMissingProject.listKnownScopes();
      assert.deepStrictEqual(
        scopes.map(({ projectId, effectiveWorkspaceRoot }) => [projectId, effectiveWorkspaceRoot]),
        [[projectTwo, "/canonical/healthy"]],
      );
    }),
  );

  it.effect("rejects canonical root and home scopes while allowing descendants", () =>
    Effect.gen(function* () {
      const filesystemRoot = NodePath.parse(homeDirectory).root;
      const safeProjectRoot = NodePath.join(homeDirectory, "project");
      const safeWorktreeRoot = NodePath.join(homeDirectory, "project-worktree");
      const homeAlias = NodePath.join(filesystemRoot, "home-alias");
      const broadRootCatalog = makeKnowledgeGraphScopeCatalog({
        getEnvironmentId: Effect.succeed(environmentId),
        getShellSnapshot: Effect.succeed({
          projects: [
            { id: rootProject, workspaceRoot: filesystemRoot },
            { id: homeProject, workspaceRoot: homeDirectory },
            { id: aliasProject, workspaceRoot: homeAlias },
            { id: projectTwo, workspaceRoot: safeProjectRoot },
          ],
          threads: [{ id: featureThread, projectId: homeProject, worktreePath: safeWorktreeRoot }],
        }),
        canonicalizeWorkspaceRoot: (root) =>
          Effect.succeed(root === homeAlias ? homeDirectory : NodePath.resolve(root)),
        homeDirectory,
      });

      const scopes = yield* broadRootCatalog.listKnownScopes();
      assert.deepStrictEqual(
        scopes.map(({ projectId, effectiveWorkspaceRoot }) => [projectId, effectiveWorkspaceRoot]),
        [
          [projectTwo, safeProjectRoot],
          [homeProject, safeWorktreeRoot],
        ],
      );

      for (const projectId of [rootProject, homeProject, aliasProject]) {
        const error = yield* Effect.flip(broadRootCatalog.resolveScope({ projectId }));
        assert.strictEqual(error.reason, "workspace-root-unavailable");
      }

      const projectScope = yield* broadRootCatalog.resolveScope({ projectId: projectTwo });
      assert.strictEqual(projectScope.effectiveWorkspaceRoot, safeProjectRoot);

      const worktreeScope = yield* broadRootCatalog.resolveScope({
        projectId: homeProject,
        threadId: featureThread,
      });
      assert.strictEqual(worktreeScope.effectiveWorkspaceRoot, safeWorktreeRoot);
    }),
  );
});
