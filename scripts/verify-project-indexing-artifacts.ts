// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { listPackage } from "@electron/asar";
import * as Schema from "effect/Schema";

import { projectIndexGrammarFixtures } from "./project-indexing-grammar-fixtures.ts";

const executeFile = NodeUtil.promisify(NodeChildProcess.execFile);
const decodeEntryManifest = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

export function assertNoPrivateProjectIndexEntries(entries: ReadonlyArray<string>): void {
  const privateEntries = entries.filter((entry) =>
    entry
      .replaceAll("\\", "/")
      .split("/")
      .some((segment) => segment.toLowerCase() === ".t3"),
  );
  if (privateEntries.length > 0) {
    throw new Error(`Artifact contains private .t3 data: ${privateEntries.slice(0, 5).join(", ")}`);
  }
}

export async function collectProjectIndexArtifactEntries(
  root: string,
): Promise<ReadonlyArray<string>> {
  const entries: string[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await NodeFSP.readdir(NodePath.join(root, directory), {
      withFileTypes: true,
    })) {
      const relative = NodePath.posix.join(directory, entry.name);
      entries.push(relative);
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile() && entry.name.endsWith(".asar")) {
        entries.push(
          ...listPackage(NodePath.join(root, relative), { isPack: false }).map(
            (member) => `${relative}/${member.replace(/^[\\/]+/, "")}`,
          ),
        );
      }
    }
  }
  return entries;
}

const GrammarProbeResult = Schema.Struct({
  grammars: Schema.Array(Schema.Struct({ name: Schema.String, parsed: Schema.Boolean })),
  typescriptFallback: Schema.String,
  nativeCompiler: Schema.String,
});
const decodeGrammarProbe = Schema.decodeSync(Schema.fromJsonString(GrammarProbeResult));

// The probe runs plain Node against the staged dependency tree so development
// dependencies and Electron's asar filesystem cannot hide missing package assets.
const grammarProbe = String.raw`
import { createRequire } from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
const root = await NodeFSP.realpath(process.argv[1]);
const require = createRequire(NodePath.resolve(root, process.argv[2], "package.json"));
async function contained(filename) {
  const resolved = await NodeFSP.realpath(filename);
  const relative = NodePath.relative(root, resolved);
  if (relative === ".." || relative.startsWith(".." + NodePath.sep) || NodePath.isAbsolute(relative)) {
    throw new Error("Indexer asset resolves outside the artifact: " + filename);
  }
  return resolved;
}
const runtime = await import(NodeURL.pathToFileURL(await contained(require.resolve("web-tree-sitter"))).href);
const wasm = await contained(require.resolve("web-tree-sitter/tree-sitter.wasm"));
await runtime.Parser.init({ locateFile: () => wasm });
const samples = ${JSON.stringify(Object.fromEntries(projectIndexGrammarFixtures.map((fixture) => [fixture.grammar, fixture.source])))};
const grammars = [];
for (const [name, source] of Object.entries(samples)) {
  const grammar = await contained(require.resolve("tree-sitter-wasms/out/tree-sitter-" + name + ".wasm"));
  const parser = new runtime.Parser();
  parser.setLanguage(await runtime.Language.load(grammar));
  const tree = parser.parse(source);
  if (!tree || tree.rootNode.hasError) throw new Error("Packaged grammar failed: " + name);
  grammars.push({ name, parsed: true });
  tree.delete();
  parser.delete();
}
const fallbackEntry = await contained(require.resolve("@typescript/typescript6"));
const ts = require(fallbackEntry);
const library = await contained(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ESNext }));
const parsed = ts.createSourceFile("fixture.ts", "export function fixture(): number { return 1; }", ts.ScriptTarget.Latest, true);
if (parsed.parseDiagnostics.length !== 0 || !library) throw new Error("Packaged compatible TypeScript parser failed.");
const compilerRequire = createRequire(require.resolve("typescript/package.json"));
const compilerManifest = await contained(compilerRequire.resolve("@typescript/typescript-" + process.platform + "-" + process.arch + "/package.json"));
const nativeCompiler = await contained(NodePath.join(NodePath.dirname(compilerManifest), "lib", process.platform === "win32" ? "tsc.exe" : "tsc"));
process.stdout.write(JSON.stringify({ grammars, typescriptFallback: ts.version, nativeCompiler: NodePath.relative(root, nativeCompiler) }));
`;

export async function verifyProjectIndexerRuntime(
  root: string,
  packageRoot = ".",
  options: {
    readonly requireCompatibleWorker?: boolean;
  } = {},
) {
  const canonicalRoot = await NodeFSP.realpath(root);
  const relativePackageRoot = NodePath.relative(
    canonicalRoot,
    NodePath.resolve(canonicalRoot, packageRoot),
  );
  if (relativePackageRoot.startsWith("..") || NodePath.isAbsolute(relativePackageRoot)) {
    throw new Error("Package root must be inside the artifact.");
  }
  const probe = await executeFile(
    process.execPath,
    ["--input-type=module", "-e", grammarProbe, canonicalRoot, relativePackageRoot],
    {
      cwd: canonicalRoot,
      timeout: 30_000,
      maxBuffer: 256 * 1024,
    },
  );
  const parsed = decodeGrammarProbe(probe.stdout);
  const native = await executeFile(
    NodePath.join(canonicalRoot, parsed.nativeCompiler),
    ["--version"],
    {
      cwd: canonicalRoot,
      timeout: 30_000,
      maxBuffer: 16 * 1024,
    },
  );
  let compatibleWorker: string | null = null;
  for (const relative of [
    "apps/server/dist/project-indexer-typescript-compatible.mjs",
    "dist/project-indexer-typescript-compatible.mjs",
  ]) {
    const entry = await NodeFSP.lstat(NodePath.join(canonicalRoot, relative)).catch(() => null);
    if (entry?.isFile() && entry.size > 0) compatibleWorker = relative;
  }
  if (compatibleWorker === null && options.requireCompatibleWorker !== false) {
    throw new Error("The packaged TypeScript compatibility worker is missing.");
  }
  return { ...parsed, nativeCompilerVersion: native.stdout.trim(), compatibleWorker };
}

const HelperProbeResult = Schema.Struct({
  calls: Schema.Array(
    Schema.Struct({
      filePath: Schema.String,
      exact: Schema.Boolean,
      targets: Schema.Array(Schema.Struct({ filePath: Schema.String })),
    }),
  ),
});
const decodeHelperProbe = Schema.decodeSync(Schema.fromJsonString(HelperProbeResult));

const PackagedProbeResult = Schema.Struct({
  unpackedRoot: Schema.String,
  nativeCompiler: Schema.String,
  compatibleWorker: Schema.String,
  dotnetHelper: Schema.String,
  javaHelper: Schema.String,
  nativeResolvedCalls: Schema.Int,
  compatibleResolvedCalls: Schema.Int,
});
const decodePackagedProbe = Schema.decodeSync(Schema.fromJsonString(PackagedProbeResult));

const packagedProbe = String.raw`
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const [moduleUrl, assetsUrl, nativeUrl, compatibleUrl, syntaxUrl, sourceUrl, helperUrl] = process.argv.slice(1);
const assets = await import(assetsUrl);
const native = await import(nativeUrl);
const compatible = await import(compatibleUrl);
const syntax = await import(syntaxUrl);
const sources = await import(sourceUrl);
const helpers = await import(helperUrl);
const modulePath = fileURLToPath(moduleUrl);
const archiveRoot = /^(.*?\.asar)(?=[\\/])/.exec(modulePath)?.[1];
if (!archiveRoot) throw new Error("Packaged verification requires a module URL inside an ASAR archive.");
const unpackedRoot = await fs.realpath(assets.unpackedAssetPath(archiveRoot));
async function contained(filename) {
  const real = await fs.realpath(filename);
  const relative = path.relative(unpackedRoot, real);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("A packaged indexer asset resolves outside the application's unpacked tree.");
  }
  return real;
}
await contained(assets.resolveFilesystemAsset(modulePath));
const nativeCompiler = await contained(native.typescriptNativeExecutable(undefined, undefined, moduleUrl));
await contained(path.join(path.dirname(nativeCompiler), "lib.d.ts"));
await contained(path.join(path.dirname(nativeCompiler), "lib.esnext.full.d.ts"));
const worker = compatible.resolveCompatibleWorker(moduleUrl);
if (worker.sourceMode) throw new Error("The packaged TypeScript worker incorrectly fell back to source mode.");
const compatibleWorker = await contained(fileURLToPath(worker.entry));
const compatibleManifest = await contained(assets.resolveIndexerPackage(moduleUrl, "@typescript/typescript6"));
const compatibleCompiler = createRequire(compatibleManifest)(path.dirname(compatibleManifest));
await contained(compatibleCompiler.getDefaultLibFilePath({ target: compatibleCompiler.ScriptTarget.ESNext }));
await contained(path.join(path.dirname(compatibleCompiler.getDefaultLibFilePath({ target: compatibleCompiler.ScriptTarget.ESNext })), "lib.d.ts"));
const dotnetHelper = await helpers.resolveAnalysisHelper("csharp", moduleUrl);
const javaHelper = await helpers.resolveAnalysisHelper("java", moduleUrl);
if (!dotnetHelper || !javaHelper) throw new Error("A packaged semantic compiler helper is missing.");
await contained(dotnetHelper);
await contained(javaHelper);
const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "t3-packaged-typescript-probe-")));
try {
  const source = "export function helper(value: number) { return value; }\nexport function caller() { return helper(1); }\n";
  await fs.writeFile(path.join(root, "fixture.ts"), source);
  await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true }, files: ["fixture.ts"] }));
  const hash = sources.sourceHash(source);
  const extracted = await syntax.extractSyntax({ filePath: "fixture.ts", source, sourceHash: hash });
  const input = { root, files: [{ path: "fixture.ts", language: "typescript", contentHash: hash, bytes: Buffer.byteLength(source), classification: "source", status: "indexed", configDependencies: ["tsconfig.json"] }], entities: extracted.entities, callsites: extracted.callsites };
  const nativeResult = await native.resolveTypeScriptNative(input, moduleUrl);
  const compatibleResult = await compatible.resolveTypeScriptCompatible(input, moduleUrl);
  const nativeResolvedCalls = nativeResult.callsites.filter(call => call.resolution === "resolved").length;
  const compatibleResolvedCalls = compatibleResult.callsites.filter(call => call.resolution === "resolved").length;
  if (nativeResolvedCalls === 0 || compatibleResolvedCalls === 0) {
    throw new Error("Packaged compiler call resolution failed: " + JSON.stringify({ native: nativeResult.gaps, compatible: compatibleResult.gaps }));
  }
  process.stdout.write(JSON.stringify({ unpackedRoot, nativeCompiler, compatibleWorker, dotnetHelper, javaHelper, nativeResolvedCalls, compatibleResolvedCalls }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
`;

/** Use the production asset resolvers against the actual app archive without importing its startup module. */
export async function verifyPackagedProjectIndexerRuntime(
  moduleUrl: string,
  options: {
    readonly probeHelpers?: boolean;
    readonly dotnetCommand?: string;
    readonly javaCommand?: string;
  } = {},
) {
  const modulePath = NodeURL.fileURLToPath(moduleUrl);
  if (!/\.asar[\\/]/i.test(modulePath)) {
    throw new Error("Packaged verification requires a module URL inside an ASAR archive.");
  }
  const extraction = new URL("../apps/server/src/projectIndexing/extraction/", import.meta.url);
  const probe = await executeFile(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      packagedProbe,
      moduleUrl,
      ...[
        "assets.ts",
        "typescriptNative.ts",
        "typescriptCompatible.ts",
        "syntax.ts",
        "source.ts",
        "nativeSemantic.ts",
      ].map((filename) => new URL(filename, extraction).href),
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = decodePackagedProbe(probe.stdout);
  const runtime = await verifyProjectIndexerRuntime(parsed.unpackedRoot);
  const helperDirectory = NodePath.dirname(parsed.dotnetHelper);
  if (helperDirectory !== NodePath.dirname(parsed.javaHelper)) {
    throw new Error("The packaged compiler helpers resolved to different output directories.");
  }
  const helpers = await verifyProjectIndexerHelpers(helperDirectory, {
    probeRuntime: options.probeHelpers ?? false,
    ...(options.dotnetCommand ? { dotnetCommand: options.dotnetCommand } : {}),
    ...(options.javaCommand ? { javaCommand: options.javaCommand } : {}),
  });
  const archiveRoot = /^(.*?\.asar)(?=[\\/])/i.exec(modulePath)![1]!;
  const archiveEntries = listPackage(archiveRoot, { isPack: false });
  const unpackedEntries = await collectProjectIndexArtifactEntries(parsed.unpackedRoot);
  assertNoPrivateProjectIndexEntries([...archiveEntries, ...unpackedEntries]);
  return {
    ...parsed,
    runtime,
    helpers,
    privateIndexEntries: 0,
    checkedEntries: archiveEntries.length + unpackedEntries.length,
  };
}

export async function probeProjectIndexerHelpers(
  helperDirectory: string,
  options: {
    readonly dotnetCommand?: string;
    readonly javaCommand?: string;
  } = {},
) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-packaged-indexer-probe-"));
  const probes = [
    {
      language: "csharp",
      command: options.dotnetCommand ?? "dotnet",
      args: [NodePath.resolve(helperDirectory, "ProjectIndexer.dll")],
      filePath: "Fixture.cs",
      source:
        "public static class Fixture { public static int Shared(int value) { return value; } public static int Run() { return Shared(1); } }",
    },
    {
      language: "java",
      command: options.javaCommand ?? "java",
      args: ["-jar", NodePath.resolve(helperDirectory, "project-indexer-java.jar")],
      filePath: "Fixture.java",
      source:
        "class Fixture { static int shared(int value) { return value; } static int run() { return shared(1); } }",
    },
  ];
  try {
    const results = [];
    for (const probe of probes) {
      await NodeFSP.writeFile(NodePath.join(root, probe.filePath), probe.source);
      const execution = executeFile(probe.command, probe.args, {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      execution.child.stdin?.end(
        JSON.stringify({
          root,
          sources: [{ filePath: probe.filePath, source: probe.source }],
          configPaths: [],
        }),
      );
      const output = await execution;
      const parsed = decodeHelperProbe(output.stdout);
      if (
        !parsed.calls.some(
          (call) => call.exact && call.targets.some((target) => target.filePath === probe.filePath),
        )
      ) {
        throw new Error(
          `Packaged ${probe.language} helper did not resolve the synthetic source call.`,
        );
      }
      results.push({
        language: probe.language,
        resolvedCalls: parsed.calls.filter((call) => call.exact).length,
      });
    }
    return results;
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
}

export async function verifyProjectIndexerHelpers(
  helperDirectory: string,
  options: {
    readonly probeRuntime?: boolean;
    readonly dotnetCommand?: string;
    readonly javaCommand?: string;
  } = {},
) {
  const requiredFiles = [
    "ProjectIndexer.dll",
    "ProjectIndexer.runtimeconfig.json",
    "ProjectIndexer.deps.json",
    "Microsoft.CodeAnalysis.dll",
    "Microsoft.CodeAnalysis.CSharp.dll",
    "project-indexer-java.jar",
  ];
  for (const filename of requiredFiles) {
    const target = NodePath.join(helperDirectory, filename);
    const entry = await NodeFSP.lstat(target);
    if (!entry.isFile() || entry.size === 0)
      throw new Error(`Missing or invalid packaged helper: ${filename}`);
  }
  const assembly = await NodeFSP.readFile(NodePath.join(helperDirectory, "ProjectIndexer.dll"));
  const jar = await NodeFSP.readFile(NodePath.join(helperDirectory, "project-indexer-java.jar"));
  if (
    assembly.subarray(0, 2).toString("ascii") !== "MZ" ||
    jar.subarray(0, 2).toString("ascii") !== "PK"
  ) {
    throw new Error("Packaged compiler helpers have invalid executable/archive headers.");
  }
  const runtime = options.probeRuntime
    ? await probeProjectIndexerHelpers(helperDirectory, options)
    : null;
  return { files: requiredFiles, runtimeVerified: runtime !== null, runtime };
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      root: { type: "string" },
      "package-root": { type: "string", default: "." },
      "helper-directory": { type: "string" },
      "skip-semantic-helpers": { type: "boolean", default: false },
      "probe-helpers": { type: "boolean", default: false },
      "module-url": { type: "string" },
      java: { type: "string" },
      dotnet: { type: "string" },
      entries: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: node scripts/verify-project-indexing-artifacts.ts --root <unpacked-stage> [--package-root .] [--helper-directory apps/server/dist/project-indexer]\n" +
        "Use --module-url <file URL inside app.asar> --probe-helpers [--java <executable>] for the final packaged application.\n" +
        "Use --entries <JSON-array> to check a release/support export manifest for private .t3 data.\n",
    );
    return;
  }
  if (values.entries) {
    const entries = decodeEntryManifest(await NodeFSP.readFile(values.entries, "utf8"));
    assertNoPrivateProjectIndexEntries(entries);
    process.stdout.write(
      `${JSON.stringify({ privateIndexEntries: 0, checkedEntries: entries.length })}\n`,
    );
  }
  if (values["module-url"]) {
    const packaged = await verifyPackagedProjectIndexerRuntime(values["module-url"], {
      probeHelpers: values["probe-helpers"],
      ...(values.java ? { javaCommand: values.java } : {}),
      ...(values.dotnet ? { dotnetCommand: values.dotnet } : {}),
    });
    process.stdout.write(`${JSON.stringify(packaged, null, 2)}\n`);
  }
  if (values.root) {
    const root = await NodeFSP.realpath(values.root);
    const entries = await collectProjectIndexArtifactEntries(root);
    assertNoPrivateProjectIndexEntries(entries);
    const runtime = await verifyProjectIndexerRuntime(root, values["package-root"]);
    const helpers = values["skip-semantic-helpers"]
      ? null
      : await verifyProjectIndexerHelpers(
          NodePath.resolve(root, values["helper-directory"] ?? "apps/server/dist/project-indexer"),
          {
            probeRuntime: values["probe-helpers"],
            ...(values.java ? { javaCommand: values.java } : {}),
            ...(values.dotnet ? { dotnetCommand: values.dotnet } : {}),
          },
        );
    process.stdout.write(
      `${JSON.stringify({ checkedEntries: entries.length, privateIndexEntries: 0, runtime, helpers }, null, 2)}\n`,
    );
  }
  if (!values.root && !values.entries && !values["module-url"])
    throw new Error("Provide an artifact root or an export entry manifest.");
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  await main();
