// @effect-diagnostics nodeBuiltinImport:off - Isolated filesystem fixtures exercise traversal, hashes and NodeFSP.symlink containment.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { filesAffectedByChange, extractFile } from "./index.ts";
import { scanInventory, type InventoryCursor } from "./inventory.ts";
import { readSourceUnit, sourceHash } from "./source.ts";

const roots: string[] = [];
const decodeSourceFile = Schema.decodeUnknownSync(ProjectSourceFileV1);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function workspace(files: Record<string, string>) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-inventory-"));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, name)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, name), contents);
  }
  return root;
}

describe("project inventory", () => {
  it("resumes paginated traversal and records explicit exclusions without reading secret/dependency source", async () => {
    const root = await workspace({
      "AGENTS.md": "Repository rules",
      "package.json": "{}",
      "tsconfig.json": "{}",
      "README.md": "Docs",
      "src/code.mjs": "export function run() {}",
      "src/code.test.ts": "test('works', () => {})",
      "src/empty.ts": "",
      ".t3/userdata/state.sqlite": "private",
      ".repos/vendor.ts": "reference",
      "node_modules/pkg/index.js": "dependency",
      ".env.local": "SECRET=secret",
      ".aws/config": "private",
      ".npmrc": "private",
      "auth.json": "private",
      "private-keys/key.txt": "private",
      "credentials.json": "private",
      "generated.g.cs": "generated",
      "src/generated.ts": "// @generated\nexport class Generated {}",
      "image.bin": "\0binary",
    });
    const files: ProjectSourceFileV1[] = [];
    let cursor: InventoryCursor | undefined;
    do {
      const page = await scanInventory(root, { batchSize: 2, ...(cursor ? { cursor } : {}) });
      expect(page.files.length).toBeLessThanOrEqual(2);
      files.push(...page.files);
      cursor = page.nextCursor ? JSON.parse(JSON.stringify(page.nextCursor)) : undefined;
    } while (cursor);
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
    expect(files.find((file) => file.path === "AGENTS.md")?.classification).toBe("rule");
    expect(files.find((file) => file.path === "src/code.test.ts")?.classification).toBe("test");
    expect(files.find((file) => file.path === "src/empty.ts")?.contentHash).toBe(sourceHash(""));
    expect(files.find((file) => file.path === "src/code.mjs")?.configDependencies).toEqual([
      "package.json",
      "tsconfig.json",
    ]);
    expect(files.some((file) => file.path.includes("userdata"))).toBe(false);
    expect(files.find((file) => file.path === ".env.local")?.contentHash).toBe("unread");
    expect(files.find((file) => file.path === ".aws")?.contentHash).toBe("unread");
    expect(files.find((file) => file.path === ".npmrc")?.contentHash).toBe("unread");
    expect(files.find((file) => file.path === "auth.json")?.contentHash).toBe("unread");
    expect(files.find((file) => file.path === "src/generated.ts")?.classification).toBe(
      "generated",
    );
    for (const file of files) expect(decodeSourceFile(file)).toEqual(file);
    expect(filesAffectedByChange(files, ["tsconfig.json"])).toContain("src/code.mjs");
  });

  it("rejects NodeFSP.symlink escapes and detects edits before source units are read", async () => {
    const root = await workspace({ "main.ts": "export class A {}" });
    const outside = await workspace({ "external.ts": "private" });
    await NodeFSP.symlink(NodePath.join(outside, "external.ts"), NodePath.join(root, "linked.ts"));
    const inventory = await scanInventory(root);
    expect(inventory.files.find((file) => file.path === "linked.ts")?.status).toBe("skipped");
    await expect(
      readSourceUnit({ root, filePath: "linked.ts", expectedHash: sourceHash("private") }),
    ).rejects.toThrow("leaves the project root");
    const file = inventory.files.find((file) => file.path === "main.ts")!;
    await NodeFSP.writeFile(NodePath.join(root, "main.ts"), "export class Changed {}");
    const extraction = await extractFile({ root, file });
    expect(extraction.file.status).toBe("stale");
    expect(extraction.entities).toEqual([]);
    expect(extraction.gaps[0]?.kind).toBe("stale-source");
  });

  it("returns complete units rather than clipping method source", async () => {
    const source = `/* 👋 */ export class A { run() { return '${"x".repeat(30_000)}'; } }`;
    const root = await workspace({ "main.ts": source });
    const inventory = await scanInventory(root);
    const extraction = await extractFile({ root, file: inventory.files[0]! });
    const method = extraction.entities.find((entity) => entity.name === "run")!;
    expect(
      await readSourceUnit({
        root,
        filePath: "main.ts",
        expectedHash: sourceHash(source),
        range: method.range,
      }),
    ).toBe(source.slice(method.range.startOffset, method.range.endOffset));
    expect(
      (
        await readSourceUnit({
          root,
          filePath: "main.ts",
          expectedHash: sourceHash(source),
          range: method.range,
        })
      ).length,
    ).toBeGreaterThan(30_000);
  });

  it("tracks inherited JSONC configurations and project references for incremental invalidation", async () => {
    const root = await workspace({
      "tsconfig.json":
        '{ // config\n "extends": "./config/base", "references": [{ "path": "./child" }] }',
      "config/base.json": '{ "extends": "../shared.json" }',
      "shared.json": "{}",
      "child/tsconfig.json": "{}",
      "src/main.ts": "export class Main {}",
    });
    const inventory = await scanInventory(root);
    const source = inventory.files.find((file) => file.path === "src/main.ts")!;
    expect(source.configDependencies).toEqual([
      "child/tsconfig.json",
      "config/base.json",
      "shared.json",
      "tsconfig.json",
    ]);
    expect(filesAffectedByChange(inventory.files, ["shared.json"])).toContain("src/main.ts");
  });

  it("fingerprints existing Roslyn reference metadata while excluding generated sources", async () => {
    const root = await workspace({
      "App.csproj": "<Project />",
      "App.cs": "class App {}",
      "obj/project.assets.json": '{ "targets": {} }',
      "obj/Generated.cs": "class Generated {}",
      "src/bin/Entry.cs": "class Entry {}",
      "bin/App.dll": "binary output",
    });
    const files: ProjectSourceFileV1[] = [];
    let cursor: InventoryCursor | undefined;
    do {
      const page = await scanInventory(root, { batchSize: 1, ...(cursor ? { cursor } : {}) });
      files.push(...page.files);
      cursor = page.nextCursor;
    } while (cursor);
    const metadata = files.find((file) => file.path === "obj/project.assets.json")!;
    expect(metadata.contentHash).toBe(sourceHash('{ "targets": {} }'));
    expect(metadata.classification).toBe("configuration");
    expect(metadata.status).toBe("skipped");
    expect(
      files.some((file) => file.path === "obj/Generated.cs" || file.path === "bin/App.dll"),
    ).toBe(false);
    expect(
      files.some((file) => file.path === "src/bin/Entry.cs" && file.status === "pending"),
    ).toBe(true);
    expect(files.find((file) => file.path === "App.cs")?.configDependencies).toContain(
      "obj/project.assets.json",
    );
  });

  it("marks configurations outside the workspace as a freshness gap", async () => {
    const outside = await workspace({ "base.json": "{}" });
    const root = await workspace({
      "tsconfig.json": JSON.stringify({ extends: NodePath.join(outside, "base.json") }),
      "main.ts": "export class Main {}",
    });
    const inventory = await scanInventory(root);
    expect(
      inventory.gaps.some(
        (gap) =>
          gap.kind === "incomplete-analysis" && gap.message.includes("outside the project root"),
      ),
    ).toBe(true);
    expect(inventory.files.find((file) => file.path === "main.ts")?.configDependencies).toEqual([
      "tsconfig.json",
    ]);
  });
});
