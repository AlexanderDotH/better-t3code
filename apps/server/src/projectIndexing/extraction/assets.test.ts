// @effect-diagnostics nodeBuiltinImport:off - Synthetic archive layouts exercise real OS paths and worker loading without Electron or a T3 process.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeWorkerThreads from "node:worker_threads";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { resolveFilesystemAsset, resolveIndexerPackage, unpackedAssetPath } from "./assets.ts";
import { resolveAnalysisHelper } from "./nativeSemantic.ts";
import { resolveCompatibleWorker } from "./typescriptCompatible.ts";
import { typescriptNativeExecutable } from "./typescriptNative.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function archiveFixture() {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-asar-"));
  roots.push(temporary);
  const archive = NodePath.join(temporary, "Café App.app", "Contents", "Resources", "app.asar");
  await NodeFSP.mkdir(NodePath.dirname(archive), { recursive: true });
  // A regular file proves the operating system cannot traverse the apparent archive directory.
  await NodeFSP.writeFile(archive, "synthetic archive boundary");
  const unpacked = `${archive}.unpacked`;
  const write = async (relative: string, contents: string) => {
    const file = NodePath.join(unpacked, relative);
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
    await NodeFSP.writeFile(file, contents);
    return file;
  };
  const entry = "apps/server/dist/bin.mjs";
  await write(entry, "export {};\n");
  return {
    archive,
    unpacked,
    write,
    moduleUrl: NodeURL.pathToFileURL(NodePath.join(archive, entry)).href,
  };
}

async function addTypeScript6(fixture: Awaited<ReturnType<typeof archiveFixture>>) {
  await fixture.write(
    "node_modules/@typescript/typescript6/package.json",
    JSON.stringify({
      name: "@typescript/typescript6",
      type: "module",
      exports: { ".": "./index.mjs", "./package.json": "./package.json" },
    }),
  );
  await fixture.write(
    "node_modules/@typescript/typescript6/index.mjs",
    'export default { version: "fixture-6" };',
  );
}

async function runWorker(entry: URL) {
  const worker = new NodeWorkerThreads.Worker(entry, { execArgv: [] });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited (${code}).`));
      });
    });
  } finally {
    await worker.terminate();
  }
}

describe("project indexer filesystem assets", () => {
  it.each([
    [
      "/Applications/T3.app/Resources/app.asar/apps/server/dist/worker.mjs",
      "/Applications/T3.app/Resources/app.asar.unpacked/apps/server/dist/worker.mjs",
    ],
    [
      "C:\\Program Files\\T3\\resources\\app.asar\\node_modules\\typescript\\bin\\tsc",
      "C:\\Program Files\\T3\\resources\\app.asar.unpacked\\node_modules\\typescript\\bin\\tsc",
    ],
    ["/app/server.asar.unpacked/worker.mjs", "/app/server.asar.unpacked/worker.mjs"],
    ["/app/project.asar-backup/worker.mjs", "/app/project.asar-backup/worker.mjs"],
    ["/app/dist/worker.mjs", "/app/dist/worker.mjs"],
  ])("maps archive boundaries without double rewriting %s", (input, expected) => {
    expect(unpackedAssetPath(input)).toBe(expected);
  });

  it("selects the actual unpacked TypeScript native executable and rejects missing assets", async () => {
    const fixture = await archiveFixture();
    await fixture.write("node_modules/typescript/package.json", '{ "name": "typescript" }');
    await fixture.write(
      "node_modules/@typescript/typescript-darwin-arm64/package.json",
      '{ "name": "@typescript/typescript-darwin-arm64" }',
    );
    const executable = await fixture.write(
      "node_modules/@typescript/typescript-darwin-arm64/lib/tsc",
      "compiler fixture",
    );
    expect(typescriptNativeExecutable("darwin", "arm64", fixture.moduleUrl)).toBe(
      await NodeFSP.realpath(executable),
    );
    await NodeFSP.rm(executable);
    expect(() => typescriptNativeExecutable("darwin", "arm64", fixture.moduleUrl)).toThrow(
      "real filesystem",
    );
  });

  it("resolves Roslyn and JDT as real sibling files and never substitutes a source-tree helper for a package", async () => {
    const fixture = await archiveFixture();
    const dotnet = await fixture.write(
      "apps/server/dist/project-indexer/ProjectIndexer.dll",
      "Roslyn fixture",
    );
    const java = await fixture.write(
      "apps/server/dist/project-indexer/project-indexer-java.jar",
      "JDT fixture",
    );
    expect(await resolveAnalysisHelper("csharp", fixture.moduleUrl)).toBe(
      await NodeFSP.realpath(dotnet),
    );
    expect(await resolveAnalysisHelper("java", fixture.moduleUrl)).toBe(
      await NodeFSP.realpath(java),
    );
    await NodeFSP.rm(java);
    expect(await resolveAnalysisHelper("java", fixture.moduleUrl)).toBeUndefined();
    expect(() =>
      resolveFilesystemAsset(NodePath.join(fixture.archive, "apps/server/dist/missing.mjs")),
    ).toThrow("real filesystem");
  });

  it("loads a real worker from the unpacked entry with its relative chunk and external package", async () => {
    const fixture = await archiveFixture();
    await addTypeScript6(fixture);
    await fixture.write(
      "apps/server/dist/shared-compiler.mjs",
      'export const marker = "unpacked-chunk";',
    );
    await fixture.write(
      "apps/server/dist/project-indexer-typescript-compatible.mjs",
      `import { parentPort } from "node:worker_threads"; import ts from "@typescript/typescript6"; import { marker } from "./shared-compiler.mjs"; parentPort.postMessage({ marker, version: ts.version });`,
    );
    const resolved = resolveCompatibleWorker(fixture.moduleUrl);
    expect(resolved.sourceMode).toBe(false);
    expect(NodeURL.fileURLToPath(resolved.entry)).toContain("app.asar.unpacked");
    expect(await runWorker(resolved.entry)).toEqual({
      marker: "unpacked-chunk",
      version: "fixture-6",
    });
    await NodeFSP.rm(NodePath.join(fixture.unpacked, "apps/server/dist/shared-compiler.mjs"));
    await expect(runWorker(resolved.entry)).rejects.toThrow("shared-compiler.mjs");
  });

  it("rejects an ambient compiler package outside the unpacked application", async () => {
    const fixture = await archiveFixture();
    const resources = NodePath.dirname(fixture.archive);
    const outside = NodePath.join(resources, "node_modules", "@typescript", "typescript6");
    await NodeFSP.mkdir(outside, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(outside, "package.json"),
      '{ "name": "@typescript/typescript6" }',
    );
    expect(() => resolveIndexerPackage(fixture.moduleUrl, "@typescript/typescript6")).toThrow(
      "unpacked application",
    );
  });
});
