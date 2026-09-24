// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { PROJECT_INDEX_SYNTAX_GRAMMARS } from "@t3tools/shared/projectIndexLanguages";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { verifyProjectIndexerHelpers } from "./verify-project-indexing-artifacts.ts";

const executeFile = NodeUtil.promisify(NodeChildProcess.execFile);
const decodeCompilerManifest = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);
const REQUIRED_GRAMMAR_FILES = new Set(
  PROJECT_INDEX_SYNTAX_GRAMMARS.map((grammar) => `tree-sitter-${grammar}.wasm`),
);

function isWithinDirectory(root: string, filename: string): boolean {
  const relative = NodePath.relative(root, filename);
  return (
    relative !== ".." && !relative.startsWith(`..${NodePath.sep}`) && !NodePath.isAbsolute(relative)
  );
}

/** Prune only the isolated dependency copy used to assemble a release artifact. */
export async function pruneProjectIndexerRuntimeAssets(stageRoot: string) {
  const canonicalStage = await NodeFSP.realpath(stageRoot);
  const sourceRoot = await NodeFSP.realpath(NodeURL.fileURLToPath(new URL("..", import.meta.url)));
  if (isWithinDirectory(canonicalStage, sourceRoot)) {
    throw new Error(
      "Project indexer pruning requires an isolated release stage, not the source checkout.",
    );
  }
  const contained = async (filename: string) => {
    const resolved = await NodeFSP.realpath(filename);
    if (!isWithinDirectory(canonicalStage, resolved)) {
      throw new Error(
        "Project indexer pruning cannot change dependencies outside the release stage.",
      );
    }
    return resolved;
  };
  const require = NodeModule.createRequire(NodePath.join(canonicalStage, "package.json"));
  const manifest = await contained(require.resolve("tree-sitter-wasms/package.json"));
  const directory = await contained(NodePath.join(NodePath.dirname(manifest), "out"));
  const files = await NodeFSP.readdir(directory, { withFileTypes: true });
  for (const required of REQUIRED_GRAMMAR_FILES) {
    const filename = await contained(NodePath.join(directory, required));
    if (!(await NodeFSP.stat(filename)).isFile())
      throw new Error(`Missing required grammar: ${required}`);
  }
  const candidates = [];
  for (const entry of files) {
    if (!entry.name.endsWith(".wasm") || REQUIRED_GRAMMAR_FILES.has(entry.name)) continue;
    const filename = NodePath.join(directory, entry.name);
    const resolved = await contained(filename);
    const info = await NodeFSP.stat(resolved);
    if (!info.isFile()) throw new Error(`Unused grammar is not a regular file: ${entry.name}`);
    candidates.push({ filename, bytes: info.size });
  }
  for (const candidate of candidates) {
    await contained(candidate.filename);
    await NodeFSP.unlink(candidate.filename);
  }
  return {
    keptGrammars: [...REQUIRED_GRAMMAR_FILES],
    removedGrammars: candidates.length,
    removedBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
  };
}

/** Materialize declarations before Electron filters pnpm's symlinked dependencies. */
export async function stageProjectIndexerDeclarations(stageRoot: string, destination: string) {
  const canonicalStage = await NodeFSP.realpath(stageRoot);
  const requestedStage = NodePath.resolve(stageRoot);
  if (!isWithinDirectory(requestedStage, NodePath.resolve(destination)))
    throw new Error("Runtime declarations must stay inside the release stage.");
  const output = NodePath.join(
    canonicalStage,
    NodePath.relative(requestedStage, NodePath.resolve(destination)),
  );
  await NodeFSP.mkdir(output, { recursive: true });
  if (!isWithinDirectory(canonicalStage, await NodeFSP.realpath(output)))
    throw new Error("Runtime declarations must stay inside the release stage.");
  let copiedFiles = 0;
  const walk = async (source: string, relative: string, ancestors: ReadonlySet<string>) => {
    const resolved = await NodeFSP.realpath(source);
    if (!isWithinDirectory(canonicalStage, resolved))
      throw new Error("A compiler declaration resolves outside the release stage.");
    const stat = await NodeFSP.stat(resolved);
    if (stat.isDirectory()) {
      if (ancestors.has(resolved))
        throw new Error("A compiler dependency contains a symlink cycle.");
      const next = new Set([...ancestors, resolved]);
      for (const entry of await NodeFSP.readdir(resolved)) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        await walk(NodePath.join(resolved, entry), NodePath.join(relative, entry), next);
      }
    } else if (stat.isFile() && relative.endsWith(".d.ts")) {
      const target = NodePath.join(output, relative);
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      await NodeFSP.copyFile(resolved, target);
      copiedFiles++;
    }
  };
  const stageRequire = NodeModule.createRequire(NodePath.join(canonicalStage, "package.json"));
  const pending = ["typescript", "@typescript/typescript6"].map((name) => ({
    name,
    manifest: stageRequire.resolve(`${name}/package.json`),
  }));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (visited.has(item.name)) continue;
    visited.add(item.name);
    const manifestPath = await NodeFSP.realpath(item.manifest);
    if (!isWithinDirectory(canonicalStage, manifestPath))
      throw new Error("A compiler declaration resolves outside the release stage.");
    if (item.name.startsWith("@typescript/"))
      await walk(NodePath.dirname(manifestPath), item.name.slice("@typescript/".length), new Set());
    const manifest = decodeCompilerManifest(await NodeFSP.readFile(manifestPath, "utf8"));
    const packageRequire = NodeModule.createRequire(manifestPath);
    for (const name of Object.keys({
      ...manifest.optionalDependencies,
      ...manifest.dependencies,
    })) {
      if (!name.startsWith("@typescript/")) continue;
      try {
        pending.push({ name, manifest: packageRequire.resolve(`${name}/package.json`) });
      } catch (error) {
        if (
          manifest.dependencies?.[name] !== undefined ||
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "MODULE_NOT_FOUND"
        )
          throw error;
      }
    }
  }
  if (copiedFiles === 0)
    throw new Error("The staged TypeScript runtimes have no standard libraries.");
  return { copiedFiles };
}

export interface ProjectIndexerBuildOptions {
  readonly repoRoot?: string;
  readonly serverDist?: string;
  readonly dotnetCommand?: string;
  readonly mavenCommand?: string;
  readonly mavenRepository?: string;
  readonly javaHome?: string;
  readonly offline?: boolean;
}

export interface ProjectIndexerBuildCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export const resolveProjectIndexerBuildCommand = Effect.fn("resolveProjectIndexerBuildCommand")(
  function* (input: ProjectIndexerBuildCommand) {
    const resolved = yield* resolveSpawnCommand(input.command, input.args, { env: input.env });
    return { ...input, ...resolved };
  },
);

const runBuildCommand = async (input: ProjectIndexerBuildCommand) => {
  try {
    const resolved = await Effect.runPromise(resolveProjectIndexerBuildCommand(input));
    await executeFile(resolved.command, resolved.args, {
      cwd: resolved.cwd,
      env: resolved.env,
      shell: resolved.shell,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (cause) {
    throw new Error(
      `Project indexer build failed with ${input.command}. Install the required .NET SDK, JDK 21, and Maven or pass explicit tool paths.`,
      { cause },
    );
  }
};

/** Build only T3's checked-in compiler helpers; a project being indexed is never a build input. */
export async function buildProjectIndexers(
  options: ProjectIndexerBuildOptions = {},
  runCommand: (input: ProjectIndexerBuildCommand) => Promise<void> = runBuildCommand,
) {
  const repoRoot = NodePath.resolve(
    options.repoRoot ?? NodeURL.fileURLToPath(new URL("..", import.meta.url)),
  );
  const serverDist = NodePath.resolve(
    options.serverDist ?? NodePath.join(repoRoot, "apps/server/dist"),
  );
  const outputDirectory = NodePath.join(serverDist, "project-indexer");
  const dotnetProject = NodePath.join(
    repoRoot,
    "native/project-indexer-dotnet/ProjectIndexer.csproj",
  );
  const javaProject = NodePath.join(repoRoot, "native/project-indexer-java/pom.xml");
  await Promise.all([NodeFSP.access(dotnetProject), NodeFSP.access(javaProject)]);
  await NodeFSP.mkdir(serverDist, { recursive: true });
  const workingDirectory = await NodeFSP.mkdtemp(
    NodePath.join(serverDist, ".project-indexer-build-"),
  );
  const stagedDirectory = NodePath.join(workingDirectory, "staged");
  const backupDirectory = NodePath.join(workingDirectory, "previous");
  const javaHome = options.javaHome ?? process.env.JAVA_HOME;
  const mavenRepository = options.mavenRepository ?? process.env.T3CODE_INDEXER_MAVEN_REPOSITORY;
  const env = {
    ...process.env,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_NOLOGO: "1",
    ...(javaHome
      ? {
          JAVA_HOME: javaHome,
          PATH: `${NodePath.join(javaHome, "bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
        }
      : {}),
  };
  const existingVerification = await verifyProjectIndexerHelpers(outputDirectory, {
    probeRuntime: false,
  }).catch(() => null);

  let backedUp = false;
  let preserveBackup = false;
  try {
    try {
      await runCommand({
        command: options.dotnetCommand ?? process.env.T3CODE_INDEXER_DOTNET ?? "dotnet",
        args: [
          "publish",
          dotnetProject,
          "--configuration",
          "Release",
          "--output",
          stagedDirectory,
          "-p:UseAppHost=false",
        ],
        cwd: repoRoot,
        env,
      });
      await runCommand({
        command: options.mavenCommand ?? process.env.T3CODE_INDEXER_MAVEN ?? "mvn",
        args: [
          "--batch-mode",
          ...(options.offline ? ["--offline"] : []),
          ...(mavenRepository ? [`-Dmaven.repo.local=${NodePath.resolve(mavenRepository)}`] : []),
          "-f",
          javaProject,
          "-DskipTests",
          "package",
        ],
        cwd: repoRoot,
        env,
      });
      await NodeFSP.copyFile(
        NodePath.join(repoRoot, "native/project-indexer-java/target/project-indexer-java.jar"),
        NodePath.join(stagedDirectory, "project-indexer-java.jar"),
      );
    } catch (buildError) {
      if (existingVerification) {
        process.stderr.write(
          "warning: dotnet or maven build failed; reusing existing valid project-indexer helpers.\n",
        );
        return { outputDirectory, verification: existingVerification };
      }
      const cacheDir = NodePath.join(repoRoot, "native/project-indexer-cache");
      const cacheVerification = await verifyProjectIndexerHelpers(cacheDir, {
        probeRuntime: false,
      }).catch(() => null);
      if (cacheVerification) {
        process.stderr.write(
          "warning: dotnet or maven build failed; copying cached project-indexer helpers from native/project-indexer-cache.\n",
        );
        await NodeFSP.cp(cacheDir, outputDirectory, { recursive: true });
        return { outputDirectory, verification: cacheVerification };
      }
      throw buildError;
    }
    const verification = await verifyProjectIndexerHelpers(stagedDirectory);
    const previous = await NodeFSP.lstat(outputDirectory).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
      throw cause;
    });
    if (previous !== null) {
      if (!previous.isDirectory() || previous.isSymbolicLink()) {
        throw new Error("The existing project-indexer output must be a regular build directory.");
      }
      await NodeFSP.rename(outputDirectory, backupDirectory);
      backedUp = true;
    }
    try {
      await NodeFSP.rename(stagedDirectory, outputDirectory);
    } catch (cause) {
      if (backedUp) {
        try {
          await NodeFSP.rename(backupDirectory, outputDirectory);
        } catch (restoreFailure) {
          preserveBackup = true;
          throw new AggregateError(
            [cause, restoreFailure],
            `The previous compiler helper bundle was preserved at ${backupDirectory}. Restore it before rebuilding.`,
            { cause: restoreFailure },
          );
        }
      }
      throw cause;
    }
    return { outputDirectory, verification };
  } finally {
    if (!preserveBackup) await NodeFSP.rm(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      "repo-root": { type: "string" },
      "server-dist": { type: "string" },
      dotnet: { type: "string" },
      maven: { type: "string" },
      "maven-repository": { type: "string" },
      "java-home": { type: "string" },
      offline: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: node scripts/build-project-indexers.ts [--dotnet <executable>] [--maven <executable>] [--java-home <JDK21>] [--server-dist <directory>] [--offline]\n",
    );
    return;
  }
  const result = await buildProjectIndexers({
    ...(values["repo-root"] ? { repoRoot: values["repo-root"] } : {}),
    ...(values["server-dist"] ? { serverDist: values["server-dist"] } : {}),
    ...(values.dotnet ? { dotnetCommand: values.dotnet } : {}),
    ...(values.maven ? { mavenCommand: values.maven } : {}),
    ...(values["maven-repository"] ? { mavenRepository: values["maven-repository"] } : {}),
    ...(values["java-home"] ? { javaHome: values["java-home"] } : {}),
    offline: values.offline,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  await main();
