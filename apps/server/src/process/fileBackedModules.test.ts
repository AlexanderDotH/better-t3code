// @effect-diagnostics nodeBuiltinImport:off - Inert package fixtures verify runtime module lookup without launching the application.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSea from "node:sea";
import * as NodeURL from "node:url";

import { afterEach, expect, it, vi } from "vite-plus/test";

import { createFileBackedRequire } from "./fileBackedModules.ts";

vi.mock("node:sea", () => ({ isSea: vi.fn(() => false) }));

const packageName = "@t3-runtime-fixture/native";
const roots: string[] = [];

afterEach(async () => {
  vi.mocked(NodeSea.isSea).mockReturnValue(false);
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(entry: string, packageRoot: string, origin: string) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-runtime-modules-"));
  roots.push(root);
  const entryPath = NodePath.join(root, entry);
  const packageDirectory = NodePath.join(root, packageRoot, "node_modules", packageName);
  await NodeFSP.mkdir(NodePath.dirname(entryPath), { recursive: true });
  await NodeFSP.writeFile(entryPath, "inert entry fixture");
  await NodeFSP.mkdir(packageDirectory, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: { ".": { import: "./unavailable.mjs", require: "./index.cjs" } },
    }),
  );
  const packageEntry = NodePath.join(packageDirectory, "index.cjs");
  await NodeFSP.writeFile(
    packageEntry,
    `module.exports = ${JSON.stringify({ origin, entry: "commonjs" })};`,
  );
  return { root, entryPath, packageEntry };
}

it.each([
  ["source", "apps/server/src/bin.ts", "apps/server"],
  ["npm", "node_modules/t3/dist/bin.mjs", "node_modules/t3"],
  ["desktop", "Resources/server/bin.mjs", "Resources/server"],
])("loads the file-backed CommonJS export in the %s runtime", async (origin, entry, root) => {
  const files = await fixture(entry, root, origin);
  const require = createFileBackedRequire(NodeURL.pathToFileURL(files.entryPath).href);
  expect(require(packageName)).toEqual({ origin, entry: "commonjs" });
  expect(require.resolve(packageName)).toBe(await NodeFSP.realpath(files.packageEntry));
});

it("loads native modules from the real unpacked Desktop tree", async () => {
  const files = await fixture(
    "Café App.app/Resources/app.asar.unpacked/apps/server/dist/bin.mjs",
    "Café App.app/Resources/app.asar.unpacked",
    "asar",
  );
  const archive = NodePath.join(files.root, "Café App.app/Resources/app.asar");
  await NodeFSP.writeFile(archive, "inert archive fixture");
  const moduleUrl = NodeURL.pathToFileURL(
    files.entryPath.replace("app.asar.unpacked", "app.asar"),
  ).href;
  expect(createFileBackedRequire(moduleUrl)(packageName)).toEqual({
    origin: "asar",
    entry: "commonjs",
  });
});

it("loads packaged modules beside the SEA executable rather than its embedded module URL", async () => {
  const files = await fixture("Café runtime/t3", "Café runtime", "sea");
  const previousExecutable = process.execPath;
  process.execPath = files.entryPath;
  vi.mocked(NodeSea.isSea).mockReturnValue(true);
  try {
    const require = createFileBackedRequire("sea://embedded/bin.mjs");
    expect(require(packageName)).toEqual({ origin: "sea", entry: "commonjs" });
    expect(require.resolve(packageName)).toBe(await NodeFSP.realpath(files.packageEntry));
  } finally {
    process.execPath = previousExecutable;
  }
});
