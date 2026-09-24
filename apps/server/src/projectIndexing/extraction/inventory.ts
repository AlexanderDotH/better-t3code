// @effect-diagnostics nodeBuiltinImport:off - Resumable traversal is a read-only, abortable filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import type { ProjectIndexGapV1, ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PROJECT_INDEX_SYNTAX_LANGUAGES } from "@t3tools/shared/projectIndexLanguages";

import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { projectArtifactPathReason } from "../privacy/ProjectArtifactPathPolicy.ts";
import { createGitIgnoreFilter, GIT_IGNORE_BATCH_SIZE, type GitIgnoredPath } from "./gitIgnore.ts";
import { hashFile, isWithinRoot, portablePath, stableId } from "./source.ts";

export type ExtractionGap = ProjectIndexGapV1;

const excludedDirectories = new Map([
  [".git", "version control metadata"],
  [".t3", "T3 runtime state"],
  [".repos", "reference repositories"],
  ["node_modules", "installed dependencies"],
  ["vendor", "vendored dependencies"],
  [".venv", "virtual environment"],
  ["venv", "virtual environment"],
  [".gradle", "Gradle cache"],
  [".m2", "Maven cache"],
  [".nuget", "NuGet cache"],
  ["dist", "generated build output"],
  ["build", "generated build output"],
  ["target", "generated build output"],
  ["obj", "generated build output"],
  ["coverage", "generated coverage"],
  [".next", "generated framework output"],
  [".cache", "cache"],
  [".turbo", "cache"],
  [".vscode-test", "test runtime dependencies"],
  ["secrets", "secret storage"],
  [".ssh", "credentials"],
]);

const sourceLanguages: Readonly<Record<string, string>> = Object.fromEntries(
  PROJECT_INDEX_SYNTAX_LANGUAGES.flatMap(({ language, extensions }) =>
    extensions.map((extension) => [extension, language]),
  ),
);
const otherSourceLanguages: Readonly<Record<string, string>> = {
  ".swift": "swift",
  ".lua": "lua",
  ".vue": "vue",
  ".svelte": "svelte",
  ".elm": "elm",
  ".ql": "ql",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".hs": "haskell",
  ".clj": "clojure",
  ".erl": "erlang",
};

export function sourceLanguage(filePath: string): string {
  const extension = NodePath.extname(filePath).toLowerCase();
  return (
    sourceLanguages[extension] ?? otherSourceLanguages[extension] ?? (extension.slice(1) || "text")
  );
}

export function supportsSyntax(language: string): boolean {
  return PROJECT_INDEX_SYNTAX_LANGUAGES.some((entry) => entry.language === language);
}

export function excludedPathReason(filePath: string): string | undefined {
  const artifactReason = projectArtifactPathReason(filePath);
  if (artifactReason) return artifactReason;
  if (!isSafeProjectSourcePath(filePath)) return "private source path";
  const parts = filePath.split(/[\\/]/);
  for (const directory of parts.slice(0, -1)) {
    const reason = excludedDirectories.get(directory);
    if (reason) return reason;
  }
  const name = parts.at(-1) ?? "";
  if (
    /^(\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa)(?:\..*)?)$/i.test(
      name,
    )
  )
    return "credentials or secrets";
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(name)) return "private key material";
  if (/(?:\.min\.[cm]?js|\.map|\.generated\.[^.]+|\.g(?:\.i)?\.cs|\.designer\.cs)$/i.test(name))
    return "generated source";
  return undefined;
}

function classify(filePath: string): ProjectSourceFileV1["classification"] {
  const name = NodePath.basename(filePath).toLowerCase();
  if (
    /^(agents|claude|gemini|copilot-instructions)\.md$/.test(name) ||
    /(?:^|\/)(?:\.cursor\/rules|\.github\/instructions|\.agents\/rules)\//.test(filePath) ||
    name === ".cursorrules"
  )
    return "rule";
  if (
    /^(package\.json|[^/]*\.csproj|[^/]*\.slnx?|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|cargo\.toml|go\.mod|pyproject\.toml|requirements[^/]*\.txt|[^/]*lock[^/]*|packages\.config)$/.test(
      name,
    )
  )
    return "manifest";
  if (
    /\.(json|jsonc|yaml|yml|toml|ini|xml|props|targets|config|editorconfig)$/.test(name) ||
    /^(?:\.[^/]*rc|\.classpath|\.project|\.gitignore)$/.test(name) ||
    /(?:^|\.)config\.[cm]?[jt]s$/.test(name)
  )
    return "configuration";
  if (/\.(md|mdx|rst|txt|adoc)$/.test(name)) return "documentation";
  if (sourceLanguages[NodePath.extname(name)] || otherSourceLanguages[NodePath.extname(name)]) {
    return /(?:^|\/)(?:tests?|__tests__|specs?|fixtures)(?:\/|$)|(?:\.|_)(?:test|spec)\.|Test(?:s)?\.(?:cs|java)$/.test(
      filePath,
    )
      ? "test"
      : "source";
  }
  return "unsupported";
}

function isConfiguration(name: string): boolean {
  return /^(?:tsconfig[^/]*\.json|jsconfig[^/]*\.json|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|[^/]*\.csproj|[^/]*\.slnx?|directory\.build\.(?:props|targets)|directory\.packages\.props|global\.json|nuget\.config|pom\.xml|gradle\.properties|(?:build|settings)\.gradle(?:\.kts)?|\.classpath|\.project)$/i.test(
    name,
  );
}

const TypeScriptConfigLinks = Schema.Struct({
  extends: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  references: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String }))),
});
const decodeConfigLinks = Schema.decodeUnknownSync(TypeScriptConfigLinks);

async function addConfigDependencies(
  root: string,
  dependencies: Set<string>,
  onGap?: (gap: ExtractionGap) => void,
  gitIgnore?: Awaited<ReturnType<typeof createGitIgnoreFilter>>,
) {
  const pending = [...dependencies].filter((dependency) =>
    /(?:^|\/)(?:ts|js)config[^/]*\.json$/.test(dependency),
  );
  if (pending.length === 0) return;
  const { default: compiler } = await import("@typescript/typescript6");
  const visited = new Set<string>();
  while (pending.length > 0) {
    const dependency = pending.pop()!;
    if (visited.has(dependency)) continue;
    visited.add(dependency);
    const exclusion =
      excludedPathReason(dependency) ??
      (await gitIgnore?.inspect([dependency]))?.get(dependency)?.reason;
    if (exclusion) {
      dependencies.delete(dependency);
      onGap?.(coverageGap("excluded", `Configuration excluded: ${exclusion}`, dependency));
      continue;
    }
    const absolute = NodePath.join(root, dependency);
    try {
      const parsed: unknown = compiler.parseConfigFileTextToJson(
        absolute,
        await NodeFSP.readFile(absolute, "utf8"),
      ).config;
      const config = decodeConfigLinks(parsed);
      const inherited =
        typeof config.extends === "string" ? [config.extends] : (config.extends ?? []);
      const references = (config.references ?? []).map((reference) => reference.path);
      const resolver = NodeModule.createRequire(absolute);
      for (const link of [...inherited, ...references]) {
        let resolved: string;
        if (NodePath.isAbsolute(link) || link.startsWith("."))
          resolved = NodePath.resolve(NodePath.dirname(absolute), link);
        else {
          try {
            resolved = resolver.resolve(link);
          } catch {
            resolved = NodePath.resolve(NodePath.dirname(absolute), link);
          }
        }
        if (!NodePath.extname(resolved)) {
          try {
            resolved = (await NodeFSP.lstat(resolved)).isDirectory()
              ? NodePath.join(resolved, "tsconfig.json")
              : resolved;
          } catch {
            resolved += ".json";
          }
        }
        if (!isWithinRoot(root, resolved)) {
          onGap?.(
            coverageGap(
              "incomplete-analysis",
              "An inherited configuration outside the project root is not fingerprinted; refresh semantic analysis when that configuration changes.",
              dependency,
            ),
          );
          continue;
        }
        const relative = portablePath(NodePath.relative(root, resolved));
        if (!isSafeProjectSourcePath(relative)) continue;
        dependencies.add(relative);
        pending.push(relative);
      }
    } catch {
      // The compiler reports invalid/missing configurations during semantic analysis.
    }
  }
}

async function configDependenciesForFile(
  root: string,
  filePath: string,
  onGap?: (gap: ExtractionGap) => void,
  gitFilter?: Awaited<ReturnType<typeof createGitIgnoreFilter>>,
): Promise<string[]> {
  if (!isSafeProjectSourcePath(filePath))
    throw new Error("Private paths have no indexable configuration dependencies.");
  const dependencies = new Set<string>();
  const gitIgnore = gitFilter ?? (await createGitIgnoreFilter(root));
  let directory = NodePath.posix.dirname(portablePath(filePath));
  while (true) {
    const names = await NodeFSP.readdir(NodePath.join(root, directory));
    for (const name of names) {
      if (isConfiguration(name)) dependencies.add(NodePath.posix.join(directory, name));
    }
    if (directory === ".") break;
    directory = NodePath.posix.dirname(directory);
  }
  const ignored = await gitIgnore.inspect(
    [...dependencies].filter((path) => excludedPathReason(path) === undefined),
  );
  for (const dependency of dependencies) {
    const exclusion = excludedPathReason(dependency) ?? ignored.get(dependency)?.reason;
    if (exclusion) {
      dependencies.delete(dependency);
      onGap?.(coverageGap("excluded", `Configuration excluded: ${exclusion}`, dependency));
    }
  }
  await addConfigDependencies(root, dependencies, onGap, gitIgnore);
  for (const configuration of dependencies) {
    if (configuration.endsWith(".csproj"))
      dependencies.add(
        NodePath.posix.join(NodePath.posix.dirname(configuration), "obj/project.assets.json"),
      );
  }
  return [...dependencies].sort();
}

type InventoryFrame = { directory: string; after: string | null; compilerMetadata?: true };
export interface InventoryCursor {
  version: 1;
  root: string;
  stack: InventoryFrame[];
}

export function coverageGap(
  kind: ExtractionGap["kind"],
  message: string,
  filePath?: string,
  retryable = false,
): ExtractionGap {
  return {
    id: stableId("gap", kind, filePath ?? "", message),
    kind,
    message,
    ...(filePath ? { filePath } : {}),
    retryable,
  };
}

/** A cursor checkpoints traversal, never a fixed file-count cutoff. New changes are handled by the watcher. */
export async function scanInventory(
  root: string,
  options: {
    cursor?: InventoryCursor;
    batchSize?: number;
    signal?: AbortSignal;
  } = {},
) {
  const canonicalRoot = await NodeFSP.realpath(root);
  const cursor: InventoryCursor = options.cursor
    ? { ...options.cursor, stack: options.cursor.stack.map((frame) => ({ ...frame })) }
    : { version: 1, root: canonicalRoot, stack: [{ directory: "", after: null }] };
  if (cursor.root !== canonicalRoot || cursor.version !== 1)
    throw new Error("Inventory cursor belongs to a different project or version.");
  for (const frame of cursor.stack) {
    if (NodePath.isAbsolute(frame.directory) || frame.directory.split(/[\\/]/).includes(".."))
      throw new Error("Invalid inventory cursor path.");
    if (frame.compilerMetadata && NodePath.posix.basename(frame.directory) !== "obj")
      throw new Error("Invalid compiler-metadata inventory cursor.");
  }
  const batchSize = options.batchSize ?? 256;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error("Inventory batch size must be positive.");
  const files: ProjectSourceFileV1[] = [];
  const gaps: ExtractionGap[] = [];
  const gitIgnore = await createGitIgnoreFilter(canonicalRoot, options.signal);
  const configurationCache = new Map<string, Promise<string[]>>();
  const configurationGapIds = new Set<string>();
  const entriesCache = new Map<
    string,
    { names: string[]; index: number; ignoreUntil: number; ignored: Map<string, GitIgnoredPath> }
  >();
  const readConfigurations = (filePath: string) => {
    const directory = NodePath.dirname(filePath);
    let pending = configurationCache.get(directory);
    if (!pending) {
      pending = configDependenciesForFile(
        canonicalRoot,
        filePath,
        (gap) => {
          if (configurationGapIds.has(gap.id)) return;
          configurationGapIds.add(gap.id);
          gaps.push(gap);
        },
        gitIgnore,
      );
      configurationCache.set(directory, pending);
    }
    return pending;
  };
  while (cursor.stack.length > 0 && files.length < batchSize) {
    options.signal?.throwIfAborted();
    const frame = cursor.stack.at(-1)!;
    let entries = entriesCache.get(frame.directory);
    try {
      if (!entries) {
        const names = (await NodeFSP.readdir(NodePath.join(canonicalRoot, frame.directory)))
          .filter((name) => !frame.compilerMetadata || name === "project.assets.json")
          .sort();
        const index = frame.after === null ? 0 : names.findIndex((name) => name > frame.after!);
        entries = {
          names,
          index: index === -1 ? names.length : index,
          ignoreUntil: 0,
          ignored: new Map(),
        };
        entriesCache.set(frame.directory, entries);
      }
    } catch (error) {
      gaps.push(
        coverageGap(
          "incomplete-analysis",
          `Cannot enumerate directory: ${String(error)}`,
          frame.directory,
          true,
        ),
      );
      cursor.stack.pop();
      continue;
    }
    if (entries.index >= entries.ignoreUntil && entries.index < entries.names.length) {
      const window = entries.names.slice(entries.index, entries.index + GIT_IGNORE_BATCH_SIZE);
      entries.ignored = await gitIgnore.inspect(
        frame.compilerMetadata
          ? []
          : window
              .map((name) => NodePath.posix.join(frame.directory, name))
              .filter((path) => excludedPathReason(path) === undefined),
      );
      entries.ignoreUntil = entries.index + window.length;
    }
    // Resume by name rather than an offset: insertion/deletion before this entry cannot skip later names.
    const name = entries.names[entries.index++];
    if (!name) {
      cursor.stack.pop();
      continue;
    }
    frame.after = name;
    const relative = NodePath.posix.join(frame.directory, name);
    const absolute = NodePath.join(canonicalRoot, relative);
    const base = {
      path: relative,
      language: sourceLanguage(relative),
      contentHash: "unread",
      bytes: 0,
      configDependencies: [],
    };
    try {
      const stat = await NodeFSP.lstat(absolute);
      const compilerMetadata =
        frame.compilerMetadata === true &&
        name === "project.assets.json" &&
        isSafeProjectSourcePath(relative);
      const ignored = compilerMetadata ? undefined : entries.ignored.get(relative);
      const reason =
        (compilerMetadata ? undefined : excludedPathReason(relative)) ??
        (stat.isDirectory() ? excludedDirectories.get(name) : undefined) ??
        (stat.isDirectory() &&
        name === "bin" &&
        entries.names.some((entry) => entry.endsWith(".csproj"))
          ? "generated .NET build output"
          : undefined) ??
        ignored?.reason;
      if (reason || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        const skipReason =
          reason ??
          (stat.isSymbolicLink() ? "symbolic link (not followed)" : "not a regular source file");
        files.push({
          ...base,
          classification: reason?.includes("generated") ? "generated" : "ignored",
          status: "skipped",
          skipReason,
        });
        gaps.push(coverageGap("excluded", skipReason, relative));
        if (
          name === "obj" &&
          stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          isSafeProjectSourcePath(relative) &&
          entries.names.some((entry) => entry.endsWith(".csproj"))
        ) {
          cursor.stack.push({ directory: relative, after: null, compilerMetadata: true });
        } else if (
          ignored?.hasTrackedDescendants &&
          stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          excludedPathReason(relative) === undefined &&
          !excludedDirectories.has(name)
        ) {
          cursor.stack.push({ directory: relative, after: null });
        }
      } else if (stat.isDirectory()) {
        cursor.stack.push({ directory: relative, after: null });
      } else {
        const { contentHash, bytes, sample } = await hashFile(absolute, options.signal);
        const binary = sample.includes(0);
        const generated = /(?:<auto-generated\b|@generated\b|Code generated .* DO NOT EDIT)/i.test(
          sample.toString("utf8"),
        );
        const classification = compilerMetadata
          ? "configuration"
          : binary
            ? "binary"
            : generated
              ? "generated"
              : classify(relative);
        const skipped =
          compilerMetadata || ["binary", "generated", "unsupported"].includes(classification);
        const skipReason = compilerMetadata
          ? "Existing compiler reference metadata (fingerprinted only)"
          : skipped
            ? `Excluded ${classification} file`
            : undefined;
        files.push({
          ...base,
          contentHash,
          bytes,
          classification,
          status: skipped ? "skipped" : "pending",
          configDependencies: await readConfigurations(relative),
          ...(skipReason ? { skipReason } : {}),
        });
        if (skipped) gaps.push(coverageGap("excluded", skipReason!, relative));
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      files.push({
        ...base,
        classification: classify(relative),
        status: "failed",
        skipReason: String(error),
      });
      gaps.push(
        coverageGap("incomplete-analysis", `Cannot read source: ${String(error)}`, relative, true),
      );
    }
  }
  return {
    files,
    gaps,
    done: cursor.stack.length === 0,
    nextCursor: cursor.stack.length > 0 ? cursor : undefined,
  };
}
