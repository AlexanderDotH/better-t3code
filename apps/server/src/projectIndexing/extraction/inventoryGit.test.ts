// @effect-diagnostics nodeBuiltinImport:off - Git admission tests use synthetic repositories and read-only production checks.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createGitIgnoreFilter } from "./gitIgnore.ts";
import { scanInventory, type InventoryCursor } from "./inventory.ts";
import { sourceHash } from "./source.ts";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function git(root: string, ...args: string[]) {
  return execute(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      `core.hooksPath=${NodeOS.devNull}`,
      "-c",
      `core.attributesFile=${NodeOS.devNull}`,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Index Fixture",
      "-c",
      "user.email=index@example.invalid",
      "-C",
      root,
      ...args,
    ],
    { timeout: 10_000 },
  );
}

async function write(root: string, path: string, text: string) {
  await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, path), text);
}

async function repository() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-git-"));
  roots.push(root);
  await git(root, "init", "-q", "--template=");
  await git(root, "config", "core.excludesFile", NodeOS.devNull);
  return root;
}

async function allFiles(root: string, batchSize = 3) {
  const files: ProjectSourceFileV1[] = [];
  let cursor: InventoryCursor | undefined;
  do {
    const page = await scanInventory(root, { batchSize, ...(cursor ? { cursor } : {}) });
    expect(page.files.length).toBeLessThanOrEqual(batchSize);
    files.push(...page.files);
    cursor = page.nextCursor ? JSON.parse(JSON.stringify(page.nextCursor)) : undefined;
  } while (cursor);
  expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
  return files;
}

describe("Git-aware source admission", () => {
  it("excludes local ignored data, respects negation, and preserves tracked descendants", async () => {
    const root = await repository();
    await write(
      root,
      ".gitignore",
      "local.json\nodd \\[name\\].json\ncache-output/\ncustom-generated/\nselective/*\n!selective/kept.ts\n",
    );
    await write(root, "local.json", '{"private":true}');
    await write(root, "odd [name].json", '{"private":true}');
    await write(root, "cache-output/deep/kept.ts", "export class Kept {}");
    await write(root, "cache-output/deep/untracked.ts", "export class Ignored {}");
    await write(root, "cache-output/data.json", '{"private":true}');
    await write(root, "custom-generated/one.ts", "export class Output {}");
    await write(root, "selective/kept.ts", "export class Included {}");
    await write(root, "selective/ignored.ts", "export class Excluded {}");
    await git(root, "add", "-f", "cache-output/deep/kept.ts");
    const files = await allFiles(root);
    expect(files.find((file) => file.path === "local.json")).toMatchObject({
      status: "skipped",
      contentHash: "unread",
      classification: "ignored",
    });
    expect(files.find((file) => file.path === "local.json")?.skipReason).toContain(".gitignore");
    expect(files.find((file) => file.path === "odd [name].json")?.contentHash).toBe("unread");
    expect(files.find((file) => file.path === "cache-output/deep/kept.ts")?.status).toBe("pending");
    expect(files.find((file) => file.path === "cache-output/deep/untracked.ts")?.contentHash).toBe(
      "unread",
    );
    expect(files.find((file) => file.path === "selective/kept.ts")?.status).toBe("pending");
    expect(files.find((file) => file.path === "selective/ignored.ts")?.status).toBe("skipped");
    expect(files.find((file) => file.path === "custom-generated")?.skipReason).toContain(
      "Git ignore",
    );
    expect(files.some((file) => file.path.startsWith("custom-generated/"))).toBe(false);
  });

  it("uses info-exclude and parent rules from a nested project in a linked worktree", async () => {
    const main = await repository();
    await write(main, "packages/client/kept.ts", "export class Kept {}");
    await write(main, ".gitignore", "packages/client/local.json\npackages/client/cached/\n");
    await write(main, "packages/client/cached/tracked.ts", "export class Tracked {}");
    await git(
      main,
      "add",
      "-f",
      ".gitignore",
      "packages/client/kept.ts",
      "packages/client/cached/tracked.ts",
    );
    await git(main, "commit", "-qm", "fixture");
    const holder = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-linked-"));
    roots.push(holder);
    const linked = NodePath.join(holder, "linked");
    await git(main, "worktree", "add", "--detach", linked, "HEAD");
    await write(main, ".git/info/exclude", "\npackages/client/transient.json\n");
    const project = NodePath.join(linked, "packages/client");
    await write(project, "local.json", "private");
    await write(project, "transient.json", "private");
    await write(project, "cached/local.json", "private");
    const files = await allFiles(project, 2);
    expect(files.find((file) => file.path === "kept.ts")?.status).toBe("pending");
    expect(files.find((file) => file.path === "cached/tracked.ts")?.status).toBe("pending");
    expect(files.find((file) => file.path === "cached/local.json")?.status).toBe("skipped");
    expect(files.find((file) => file.path === "local.json")?.status).toBe("skipped");
    expect(files.find((file) => file.path === "transient.json")?.skipReason).toContain(
      "local exclude",
    );
    expect(
      files.every((file) => !file.skipReason?.includes(main) && !file.skipReason?.includes(linked)),
    ).toBe(true);
  });

  it("rechecks changed ignore rules and refuses admission on a corrupt Git index", async () => {
    const root = await repository();
    await write(root, ".gitignore", "local.json\n");
    await write(root, "local.json", '{"value":1}');
    expect((await allFiles(root)).find((file) => file.path === "local.json")?.contentHash).toBe(
      "unread",
    );
    await write(root, ".gitignore", "");
    expect((await allFiles(root)).find((file) => file.path === "local.json")?.contentHash).toBe(
      sourceHash('{"value":1}'),
    );
    await write(root, ".git/index", "broken index");
    await expect(scanInventory(root)).rejects.toThrow("source admission stopped");
  });

  it("keeps reference metadata fingerprint-only while excluding ignored config inputs", async () => {
    const root = await repository();
    await write(root, ".gitignore", "obj/\ntsconfig.local.json\nmachine-config/\n");
    await write(root, "App.csproj", "<Project />");
    await write(root, "App.cs", "class App {}");
    await write(root, "obj/project.assets.json", '{"targets":{}}');
    await write(root, "obj/Generated.cs", "class Generated {}");
    await write(root, "tsconfig.json", '{"extends":"./machine-config/base.json"}');
    await write(root, "tsconfig.local.json", '{"extends":"/outside-private"}');
    await write(root, "machine-config/base.json", '{"extends":"/must-not-read"}');
    await write(root, "main.ts", "export class Main {}");
    const files = await allFiles(root, 1);
    expect(files.find((file) => file.path === "obj/project.assets.json")).toMatchObject({
      classification: "configuration",
      status: "skipped",
      contentHash: sourceHash('{"targets":{}}'),
    });
    expect(files.some((file) => file.path === "obj/Generated.cs")).toBe(false);
    expect(files.find((file) => file.path === "main.ts")?.configDependencies).toContain(
      "tsconfig.json",
    );
    expect(files.find((file) => file.path === "main.ts")?.configDependencies).not.toContain(
      "tsconfig.local.json",
    );
    expect(files.find((file) => file.path === "main.ts")?.configDependencies).not.toContain(
      "machine-config/base.json",
    );
    const scan = await scanInventory(root);
    expect(scan.gaps.some((gap) => gap.message.includes("outside the project root"))).toBe(false);
  });

  it("handles more than one ignore window, missing ignored entries, and safe external rule labels", async () => {
    const root = await repository();
    const external = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-exclude-"));
    roots.push(external);
    await write(external, "rules", "*.local.json\n");
    await git(root, "config", "core.excludesFile", NodePath.join(external, "rules"));
    await write(root, ".gitignore", "gone.json\n");
    await Promise.all(
      Array.from({ length: 275 }, (_, index) =>
        write(root, `item-${String(index).padStart(3, "0")}.local.json`, '{"local":true}'),
      ),
    );
    const files = await allFiles(root, 137);
    const ignored = files.filter((file) => file.path.endsWith(".local.json"));
    expect(ignored).toHaveLength(275);
    expect(
      ignored.every(
        (file) =>
          file.contentHash === "unread" && file.skipReason?.startsWith("Git global ignore rule"),
      ),
    ).toBe(true);
    expect(
      ignored.every(
        (file) => !file.skipReason?.includes(external) && !file.skipReason?.includes("*.local"),
      ),
    ).toBe(true);
    const filter = await createGitIgnoreFilter(root);
    expect((await filter.inspect(["gone.json"])).get("gone.json")?.reason).toContain(".gitignore");
  });

  it("does not run a configured fsmonitor hook and supports projects outside Git", async () => {
    const root = await repository();
    const hook = NodePath.join(root, "fsmonitor-hook.sh");
    await NodeFSP.writeFile(hook, '#!/bin/sh\nprintf invoked > "$0.invoked"\n');
    await NodeFSP.chmod(hook, 0o700);
    await git(root, "config", "core.fsmonitor", hook);
    await write(root, "main.ts", "export class Main {}");
    await git(root, "add", "main.ts");
    expect((await allFiles(root)).find((file) => file.path === "main.ts")?.status).toBe("pending");
    await expect(NodeFSP.access(`${hook}.invoked`)).rejects.toThrow();
    const plain = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-no-git-"));
    roots.push(plain);
    await write(plain, "main.ts", "export class Main {}");
    expect((await createGitIgnoreFilter(plain)).isRepository).toBe(false);
    expect((await allFiles(plain)).find((file) => file.path === "main.ts")?.status).toBe("pending");
  });
});
