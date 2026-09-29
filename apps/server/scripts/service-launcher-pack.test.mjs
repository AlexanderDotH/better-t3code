import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { build } from "vite-plus/pack";
import { assert, it } from "vite-plus/test";

import serverConfig from "../vite.config.ts";

it("imports the relocated standalone launcher without starting its CLI", async () => {
  const serverDirectory = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  const outputDirectory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-launcher-pack-"),
  );
  const launcherConfig = serverConfig.pack.find((config) =>
    Object.hasOwn(config.entry, "service-launcher"),
  );
  assert.ok(launcherConfig);

  try {
    await build({
      ...launcherConfig,
      config: false,
      cwd: serverDirectory,
      outDir: outputDirectory,
      sourcemap: false,
      report: false,
      onSuccess: undefined,
    });
    assert.deepEqual(await NodeFSP.readdir(outputDirectory), ["service-launcher.mjs"]);
    const launcherUrl = NodeURL.pathToFileURL(
      NodePath.join(outputDirectory, "service-launcher.mjs"),
    ).href;
    const result = await NodeUtil.promisify(NodeChildProcess.execFile)(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(launcherUrl)})`],
      { cwd: outputDirectory, env: { ...process.env, T3CODE_HOME: "" } },
    );
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await NodeFSP.rm(outputDirectory, { recursive: true, force: true });
  }
}, 15_000);
