// @effect-diagnostics nodeBuiltinImport:off - Module resolution reads only admitted workspace paths.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import ts from "@typescript/typescript6";
import type { ProjectImportV1, ProjectSourceFileV1 } from "@t3tools/contracts";

import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { createGitIgnoreFilter } from "./gitIgnore.ts";
import { excludedPathReason } from "./inventory.ts";
import { isWithinRoot, portablePath } from "./source.ts";

interface ResolutionInput {
  readonly root: string;
  readonly file: ProjectSourceFileV1;
  readonly imports: readonly ProjectImportV1[];
  readonly signal?: AbortSignal;
}

function admittedPath(root: string, absolute: string): string | undefined {
  if (!isWithinRoot(root, absolute)) return undefined;
  const relative = portablePath(NodePath.relative(root, absolute));
  if (!relative || !isSafeProjectSourcePath(relative) || excludedPathReason(relative))
    return undefined;
  let current = root;
  for (const component of relative.split("/")) {
    current = NodePath.join(current, component);
    try {
      if (NodeFS.lstatSync(current).isSymbolicLink()) return undefined;
    } catch {
      return undefined;
    }
  }
  return relative;
}

function compilerHost(root: string): ts.ModuleResolutionHost {
  const admitted = new Map<string, string | undefined>();
  const relativePath = (absolute: string) => {
    let path = admitted.get(absolute);
    if (!admitted.has(absolute)) {
      path = admittedPath(root, absolute);
      admitted.set(absolute, path);
    }
    return path;
  };
  return {
    getCurrentDirectory: () => root,
    fileExists: (absolute) => {
      if (!relativePath(absolute)) return false;
      try {
        return NodeFS.statSync(absolute).isFile();
      } catch {
        return false;
      }
    },
    directoryExists: (absolute) => {
      if (absolute !== root && !relativePath(absolute)) return false;
      try {
        return NodeFS.statSync(absolute).isDirectory();
      } catch {
        return false;
      }
    },
    readFile: (absolute) => {
      if (NodePath.basename(absolute) !== "package.json" || !relativePath(absolute))
        return undefined;
      try {
        return NodeFS.readFileSync(absolute, "utf8");
      } catch {
        return undefined;
      }
    },
    realpath: (absolute) => (absolute === root || relativePath(absolute) ? absolute : ""),
    useCaseSensitiveFileNames: () => true,
  };
}

function closestCompilerConfig(file: ProjectSourceFileV1): string | undefined {
  return file.configDependencies
    .filter((path) => /(?:^|\/)(?:ts|js)config(?:\.[^/]*)?\.json$/u.test(path))
    .sort((left, right) => {
      const depth = right.split("/").length - left.split("/").length;
      if (depth !== 0) return depth;
      const leftExact = /(?:^|\/)(?:ts|js)config\.json$/u.test(left);
      const rightExact = /(?:^|\/)(?:ts|js)config\.json$/u.test(right);
      return Number(rightExact) - Number(leftExact);
    })[0];
}

function compilerOptions(root: string, file: ProjectSourceFileV1): ts.CompilerOptions {
  const configPath = closestCompilerConfig(file);
  if (configPath) {
    const allowed = new Set(file.configDependencies);
    const readConfig = (absolute: string) => {
      const relative = admittedPath(root, absolute);
      if (!relative || !allowed.has(relative)) return undefined;
      try {
        return NodeFS.readFileSync(absolute, "utf8");
      } catch {
        return undefined;
      }
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(
      NodePath.join(root, configPath),
      {},
      {
        useCaseSensitiveFileNames: true,
        getCurrentDirectory: () => root,
        readDirectory: () => [],
        fileExists: (absolute) => readConfig(absolute) !== undefined,
        readFile: readConfig,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (parsed && parsed.errors.every((diagnostic) => diagnostic.code === 18003))
      return {
        ...parsed.options,
        allowJs: parsed.options.allowJs ?? true,
        resolveJsonModule: parsed.options.resolveJsonModule ?? true,
      };
  }
  return {
    allowJs: true,
    resolveJsonModule: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
}

function matchesConfiguredAlias(
  specifier: string,
  paths: ts.MapLike<string[]> | undefined,
): boolean {
  for (const pattern of Object.keys(paths ?? {})) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0 && specifier === pattern) return true;
    if (
      wildcard >= 0 &&
      specifier.startsWith(pattern.slice(0, wildcard)) &&
      specifier.endsWith(pattern.slice(wildcard + 1))
    )
      return true;
  }
  return false;
}

function externalPackage(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("#") || /^(?:[a-z]+:|[/.])/iu.test(specifier)) return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return name && /^(@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/u.test(name) ? name : undefined;
}

function relativeModuleCandidates(file: ProjectSourceFileV1, record: ProjectImportV1): string[] {
  const specifier = record.specifier;
  if (specifier.length >= 1_024 || specifier.includes("\\") || NodePath.posix.isAbsolute(specifier))
    return [];
  const directory = NodePath.posix.dirname(file.path);
  switch (file.language) {
    case "python": {
      const relative = /^(\.+)([\w.]+)?$/u.exec(specifier);
      if (!relative) return [];
      const parent = NodePath.posix.join(
        directory,
        ...Array<string>(relative[1]!.length - 1).fill(".."),
      );
      const module = relative[2]?.replaceAll(".", "/");
      const path = module ? NodePath.posix.join(parent, module) : parent;
      return module ? [path + ".py", path + "/__init__.py"] : [path + "/__init__.py"];
    }
    case "c":
    case "cpp":
    case "objective-c":
      return /#\s*(?:include|import)\s*"/u.test(record.importText)
        ? [NodePath.posix.join(directory, specifier)]
        : [];
    case "dart":
    case "zig":
      return !specifier.includes(":") && (file.language === "dart" || specifier.endsWith(".zig"))
        ? [NodePath.posix.join(directory, specifier)]
        : [];
    default:
      return [];
  }
}

async function resolveRelativeModules(input: ResolutionInput): Promise<ProjectImportV1[]> {
  const root = await NodeFSP.realpath(input.root);
  const host = compilerHost(root);
  const candidates = input.imports.map((record) => {
    input.signal?.throwIfAborted();
    const paths = relativeModuleCandidates(input.file, record).filter((path) =>
      host.fileExists(NodePath.join(root, path)),
    );
    // Ambiguous module layouts need the language's runtime/compiler configuration.
    return { record, targetPath: paths.length === 1 ? paths[0] : undefined };
  });
  const targetPaths = [...new Set(candidates.flatMap(({ targetPath }) => targetPath ?? []))];
  const ignored =
    targetPaths.length > 0
      ? await (await createGitIgnoreFilter(root, input.signal)).inspect(targetPaths)
      : new Map();
  return candidates.map(({ record, targetPath }) =>
    targetPath && !ignored.has(targetPath)
      ? { ...record, resolution: "workspace", targetPath }
      : record,
  );
}

/** Resolve only workspace files admitted by the indexer; a package name is not a file edge. */
export async function resolveImports(input: ResolutionInput): Promise<ProjectImportV1[]> {
  if (input.imports.length === 0) return [];
  input.signal?.throwIfAborted();
  if (input.file.language !== "javascript" && input.file.language !== "typescript")
    return resolveRelativeModules(input);
  const root = await NodeFSP.realpath(input.root);
  const options = compilerOptions(root, input.file);
  const host = compilerHost(root);
  const importer = NodePath.join(root, input.file.path);
  const candidates = input.imports.map((record) => {
    const specifier = record.specifier;
    if (
      specifier.length >= 1_024 ||
      specifier.includes("\\") ||
      /^require\s*\(/u.test(record.importText)
    )
      return { record, targetPath: undefined, packageName: undefined };
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    const alias = matchesConfiguredAlias(specifier, options.paths);
    const attemptWorkspace = relative || alias || options.baseUrl !== undefined;
    const resolved = attemptWorkspace
      ? ts.resolveModuleName(specifier, importer, options, host).resolvedModule?.resolvedFileName
      : undefined;
    const targetPath = resolved ? admittedPath(root, resolved) : undefined;
    const packageName = !relative && !alias ? externalPackage(specifier) : undefined;
    return { record, targetPath, packageName };
  });
  const targetPaths = [...new Set(candidates.flatMap((candidate) => candidate.targetPath ?? []))];
  const ignored =
    targetPaths.length > 0
      ? await (await createGitIgnoreFilter(root, input.signal)).inspect(targetPaths)
      : new Map();
  return candidates.map(({ record, targetPath, packageName }) => {
    input.signal?.throwIfAborted();
    if (targetPath && !ignored.has(targetPath))
      return { ...record, resolution: "workspace", targetPath };
    if (packageName) return { ...record, resolution: "external", packageName };
    return record;
  });
}
