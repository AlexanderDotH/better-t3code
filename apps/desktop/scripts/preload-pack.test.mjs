import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { build } from "vite-plus/pack";
import { assert, it } from "vite-plus/test";

import desktopConfig from "../vite.config.ts";
import { verifySandboxPreloadImports } from "./verify-preload-bundle.mjs";

it("emits every sandbox preload without package imports or shared runtime chunks", async () => {
  const desktopDirectory = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  const outputDirectory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-preload-pack-"));
  const preloadConfigs = desktopConfig.pack.filter((config) =>
    config.entry.some((entry) => entry.endsWith("preload.ts")),
  );
  assert.equal(preloadConfigs.length, 4);

  try {
    for (const config of preloadConfigs) {
      await build({
        ...config,
        config: false,
        cwd: desktopDirectory,
        outDir: outputDirectory,
        sourcemap: false,
        clean: false,
        report: false,
      });
      const fileName = NodePath.basename(config.entry[0], ".ts") + ".cjs";
      const source = await NodeFSP.readFile(NodePath.join(outputDirectory, fileName), "utf8");
      assert.doesNotThrow(() => verifySandboxPreloadImports(source), fileName);
    }
    assert.deepEqual((await NodeFSP.readdir(outputDirectory)).toSorted(), [
      "mac-permission-preload.cjs",
      "preload.cjs",
      "preview-pick-preload.cjs",
      "preview-pip-preload.cjs",
    ]);
  } finally {
    await NodeFSP.rm(outputDirectory, { recursive: true, force: true });
  }
}, 15_000);
