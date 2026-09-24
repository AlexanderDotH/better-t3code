// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { it } from "@effect/vitest";
import { afterEach, describe, expect } from "vite-plus/test";

import {
  assertPublicProjectPaths,
  hashProjectSourceFile,
  isPrivateProjectPath,
  prepareKnowledgeWorkspace,
  PRIVATE_PROJECT_GIT_PATHSPECS,
} from "./WorkspacePrivacy.ts";

const directories: string[] = [];
function directory() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-index-privacy-"));
  directories.push(root);
  return root;
}
const git = (root: string, ...args: string[]) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", `core.hooksPath=${NodeOS.devNull}`, "-C", root, ...args],
    { encoding: "utf8" },
  );
afterEach(() => {
  for (const root of directories.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("private workspace preparation", () => {
  it.effect("preserves dirty repositories and excludes only local private data", () =>
    Effect.gen(function* () {
      const root = directory();
      git(root, "init", "-q");
      NodeFS.writeFileSync(NodePath.join(root, "source.ts"), "export const changed = true;\n");
      NodeFS.writeFileSync(NodePath.join(root, ".gitignore"), "dist/\n");
      NodeFS.mkdirSync(NodePath.join(root, ".t3"));
      NodeFS.writeFileSync(
        NodePath.join(root, ".t3", "MEMORY.md"),
        "Remember the user's preferences.",
      );
      yield* prepareKnowledgeWorkspace(root);
      expect(git(root, "status", "--porcelain")).toContain("source.ts");
      expect(git(root, "status", "--porcelain")).not.toContain(".t3");
      expect(NodeFS.readFileSync(NodePath.join(root, ".gitignore"), "utf8")).toBe("dist/\n");
      expect(NodeFS.readFileSync(NodePath.join(root, ".t3", "MEMORY.md"), "utf8")).toContain(
        "preferences",
      );
      expect(git(root, "check-ignore", ".t3/knowledge/knowledge.sqlite").trim()).toBe(
        ".t3/knowledge/knowledge.sqlite",
      );
    }),
  );

  it.effect("rejects previously tracked .t3 data without changing the index", () =>
    Effect.gen(function* () {
      const root = directory();
      git(root, "init", "-q");
      NodeFS.mkdirSync(NodePath.join(root, ".t3"));
      NodeFS.writeFileSync(NodePath.join(root, ".t3", "tracked.md"), "private");
      git(root, "add", ".t3/tracked.md");
      const before = git(root, "ls-files", "--stage");
      expect((yield* Effect.flip(prepareKnowledgeWorkspace(root))).message).toContain(
        "already tracks .t3",
      );
      expect(git(root, "ls-files", "--stage")).toBe(before);
      expect(NodeFS.existsSync(NodePath.join(root, ".t3", "knowledge"))).toBe(false);
    }),
  );

  it.effect("protects non-Git directories when Git is initialized later", () =>
    Effect.gen(function* () {
      const root = directory();
      NodeFS.mkdirSync(NodePath.join(root, ".t3"));
      NodeFS.writeFileSync(NodePath.join(root, ".t3", ".gitignore"), "# custom\n!MEMORY.md\n");
      yield* prepareKnowledgeWorkspace(root);
      NodeFS.writeFileSync(NodePath.join(root, ".t3", "knowledge", "local.txt"), "private");
      git(root, "init", "-q");
      expect(git(root, "status", "--porcelain")).toBe("");
      expect(NodeFS.readFileSync(NodePath.join(root, ".t3", ".gitignore"), "utf8")).toContain(
        "# custom\n!MEMORY.md\n*\n",
      );
    }),
  );

  it.effect("keeps linked worktrees isolated and uses their shared local exclude file", () =>
    Effect.gen(function* () {
      const root = directory();
      git(root, "init", "-q");
      git(
        root,
        "-c",
        "user.name=T3 Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-qm",
        "initial",
      );
      const linked = NodePath.join(directory(), "worktree");
      git(root, "worktree", "add", "--detach", linked);
      const first = yield* prepareKnowledgeWorkspace(root);
      const second = yield* prepareKnowledgeWorkspace(linked);
      expect(first.workspaceId).not.toBe(second.workspaceId);
      expect(first.databasePath).not.toBe(second.databasePath);
      expect(git(linked, "check-ignore", ".t3/knowledge/knowledge.sqlite").trim()).toBe(
        ".t3/knowledge/knowledge.sqlite",
      );
    }),
  );

  it.effect("uses the containing repository for nested project scopes", () =>
    Effect.gen(function* () {
      const root = directory();
      git(root, "init", "-q");
      const nested = NodePath.join(root, "packages", "client");
      NodeFS.mkdirSync(nested, { recursive: true });
      const workspace = yield* prepareKnowledgeWorkspace(nested);
      expect(workspace.knowledgeRoot).toBe(
        NodePath.join(NodeFS.realpathSync(nested), ".t3/knowledge"),
      );
      expect(git(root, "check-ignore", "packages/client/.t3/knowledge/knowledge.sqlite")).toContain(
        "packages/client/.t3",
      );
    }),
  );

  it("excludes private paths from whole-repository staging launched in a nested cwd", () => {
    const root = directory();
    git(root, "init", "-q");
    const nested = NodePath.join(root, "nested");
    NodeFS.mkdirSync(NodePath.join(root, ".t3"));
    NodeFS.mkdirSync(NodePath.join(nested, ".t3"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "public.ts"), "public");
    NodeFS.writeFileSync(NodePath.join(root, ".t3", "secret"), "private");
    NodeFS.writeFileSync(NodePath.join(nested, "nested.ts"), "nested");
    NodeFS.writeFileSync(NodePath.join(nested, ".t3", "secret"), "private");
    git(nested, "add", "--all", "--", ":/", ...PRIVATE_PROJECT_GIT_PATHSPECS);
    expect(git(root, "ls-files").trim().split("\n")).toEqual(["nested/nested.ts", "public.ts"]);
  });

  it.effect("rejects symlink escapes in private storage and source inputs", () =>
    Effect.gen(function* () {
      const root = directory();
      const outside = directory();
      NodeFS.writeFileSync(NodePath.join(outside, "source.ts"), "private");
      NodeFS.symlinkSync(outside, NodePath.join(root, ".t3"), "dir");
      expect((yield* Effect.flip(prepareKnowledgeWorkspace(root))).message).toContain("symlinks");
      NodeFS.symlinkSync(NodePath.join(outside, "source.ts"), NodePath.join(root, "source.ts"));
      expect((yield* Effect.flip(hashProjectSourceFile(root, "source.ts"))).message).toContain(
        "symlinks",
      );
      expect(NodeFS.readdirSync(outside)).toEqual(["source.ts"]);
    }),
  );

  it.effect("hashes uncommitted bytes and rejects private and secret sources", () =>
    Effect.gen(function* () {
      const root = directory();
      NodeFS.writeFileSync(NodePath.join(root, "source.ts"), "first");
      const first = yield* hashProjectSourceFile(root, "source.ts");
      NodeFS.writeFileSync(NodePath.join(root, "source.ts"), "changed");
      const second = yield* hashProjectSourceFile(root, "source.ts");
      expect(first).not.toBe(second);
      expect((yield* Effect.flip(hashProjectSourceFile(root, ".env.local"))).message).toContain(
        "cannot be indexed",
      );
      expect((yield* Effect.flip(hashProjectSourceFile(root, "../source.ts"))).message).toContain(
        "cannot be indexed",
      );
      expect(isPrivateProjectPath("module/.t3/MEMORY.md")).toBe(true);
      expect(() => assertPublicProjectPaths(["module/.t3/MEMORY.md"])).toThrow("cannot be staged");
    }),
  );
});
