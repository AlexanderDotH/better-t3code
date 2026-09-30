import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { build } from "vite-plus/pack";
import { assert, it } from "vite-plus/test";

import serverConfig from "../vite.config.ts";

it("preserves prepared CLI runtime assets when packing the standalone launcher", async () => {
  const serverDirectory = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-launcher-output-preservation-"),
  );
  const outputDirectory = NodePath.join(directory, "dist");
  const preparedAssets = {
    "client/index.html": "<!doctype html><title>Prepared client</title>",
    "project-indexer/ProjectIndexer.dll": "prepared native indexer",
    "project-indexer/project-indexer-java.jar": "prepared Java indexer",
    "project-indexer/typescript/lib/lib.es2024.d.ts": "prepared compiler declarations",
    "project-indexer-typescript-compatible.mjs": "export const preparedWorker = true;",
    "resource-monitor/win-x64/t3-resource-monitor.exe": "prepared resource monitor",
  };
  const launcherConfig = serverConfig.pack.find((config) =>
    Object.hasOwn(config.entry, "service-launcher"),
  );
  assert.ok(launcherConfig);

  try {
    for (const [path, content] of Object.entries(preparedAssets)) {
      const destination = NodePath.join(outputDirectory, path);
      await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
      await NodeFSP.writeFile(destination, content);
    }
    await build({
      ...launcherConfig,
      config: false,
      cwd: serverDirectory,
      outDir: outputDirectory,
      exe: false,
      sourcemap: false,
      report: false,
      onSuccess: undefined,
    });
    for (const [path, content] of Object.entries(preparedAssets)) {
      assert.equal(await NodeFSP.readFile(NodePath.join(outputDirectory, path), "utf8"), content);
    }
    assert.ok(
      (await NodeFSP.stat(NodePath.join(outputDirectory, "service-launcher.mjs"))).size > 0,
    );
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}, 15_000);
