import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";

import { build } from "vite-plus/pack";
import { assert, it } from "vite-plus/test";

import desktopConfig from "../vite.config.ts";
import { verifySandboxPreloadImports } from "./verify-preload-bundle.mjs";

const sandboxPrelude = `
  const { Buffer, clearImmediate, clearInterval, clearTimeout, global, process,
          require, setImmediate, setInterval, setTimeout } = __electronSandbox;
  const exports = {};
  const module = { exports };
`;

function executeSandboxPreload(source, fileName) {
  const exposedGlobals = new Map();
  const ipcListeners = new Map();
  const windowListeners = new Map();
  const noop = () => {};
  const timer = () => 1;
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => exposedGlobals.set(name, api),
    },
    ipcRenderer: {
      on: (channel, listener) => ipcListeners.set(channel, listener),
      once: (channel, listener) => ipcListeners.set(channel, listener),
      removeListener: noop,
      invoke: async () => undefined,
      send: noop,
      sendSync: () => undefined,
    },
    webFrame: { getZoomFactor: () => 1 },
    webUtils: { getPathForFile: () => "" },
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    performance,
    queueMicrotask: noop,
    setTimeout: timer,
    clearTimeout: noop,
    setInterval: timer,
    clearInterval: noop,
    window: {
      addEventListener: (name, listener) => windowListeners.set(name, listener),
      removeEventListener: noop,
      location: { href: "https://preview.example/" },
      navigator: { userAgent: "Electron", platform: "MacIntel" },
    },
    document: {
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: () => null,
      querySelector: () => null,
      visibilityState: "visible",
      documentElement: { style: { setProperty: noop } },
    },
  };
  context.__electronSandbox = {
    Buffer,
    clearImmediate: noop,
    clearInterval: noop,
    clearTimeout: noop,
    global: context,
    process: { contextIsolated: true, platform: "darwin", versions: { electron: "44.4.2" } },
    require: (id) => {
      assert.equal(id, "electron");
      return electron;
    },
    setImmediate: timer,
    setInterval: timer,
    setTimeout: timer,
  };
  NodeVM.runInNewContext(sandboxPrelude + source, context, { filename: fileName, timeout: 1_000 });
  if (fileName === "preload.cjs") {
    assert.equal(exposedGlobals.get("desktopBridge")?.getClientPlatform(), "darwin");
    assert.ok(exposedGlobals.has("__clerk_internal_electron_passkeys"));
  } else if (fileName === "preview-pick-preload.cjs") {
    assert.ok(ipcListeners.size > 0);
  } else if (fileName === "preview-pip-preload.cjs") {
    assert.equal(typeof exposedGlobals.get("previewPictureInPicture")?.onFrame, "function");
  } else {
    assert.ok(windowListeners.has("DOMContentLoaded"));
  }
}

it("emits isolated preloads that initialize inside Electron's sandbox scope", async () => {
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
      assert.doesNotThrow(() => executeSandboxPreload(source, fileName), fileName);
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
