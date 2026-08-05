import * as NodeOS from "node:os";

import type {
  AgentImportSource,
  AgentImportSourceId,
  AgentImportSourcesResult,
  AgentImportTool,
  McpProviderRouting,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  ProjectId,
  ServerSettings,
  SkillDescriptor,
} from "@t3tools/contracts";
import { McpConfigError, SkillEngineError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "./pathExpansion.ts";
import { isValidSkillName, parseSkillFile } from "./skills/skillFile.ts";

const MCP_ID_MAX_LENGTH = 96;
const MAX_DISCOVERY_DEPTH = 5;

interface AgentToolDefinition {
  readonly tool: AgentImportTool;
  readonly displayName: string;
  readonly homePrefixes: ReadonlyArray<string>;
  readonly configDirectories: ReadonlyArray<string>;
  readonly configFiles: ReadonlyArray<string>;
  readonly skillDirectories: ReadonlyArray<SkillDirectoryDefinition>;
}

interface SkillDirectoryDefinition {
  readonly relativePath: string;
  readonly mode: "skillFile" | "markdown";
}

interface CandidateRoot {
  readonly tool: AgentImportTool;
  readonly path: string;
  readonly label: string;
}

interface ResolvedSource extends AgentImportSource {
  readonly rootPath: string;
}

interface RawSkillImport {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly displayName?: string | undefined;
  readonly shortDescription?: string | undefined;
  readonly sourcePath: string;
  readonly sourceTool: AgentImportTool;
}

interface RawMcpServerInput {
  readonly command?: unknown;
  readonly args?: unknown;
  readonly cwd?: unknown;
  readonly env?: unknown;
  readonly url?: unknown;
  readonly headers?: unknown;
  readonly type?: unknown;
  readonly transport?: unknown;
  readonly environment?: unknown;
  readonly enabled?: unknown;
}

const TOOL_DEFINITIONS: ReadonlyArray<AgentToolDefinition> = [
  {
    tool: "codex",
    displayName: "Codex",
    homePrefixes: [".codex"],
    configDirectories: [],
    configFiles: ["config.toml"],
    skillDirectories: [{ relativePath: "skills", mode: "skillFile" }],
  },
  {
    tool: "cursor",
    displayName: "Cursor",
    homePrefixes: [".cursor"],
    configDirectories: [],
    configFiles: ["mcp.json", "settings.json"],
    skillDirectories: [
      { relativePath: "skills", mode: "skillFile" },
      { relativePath: "rules", mode: "markdown" },
    ],
  },
  {
    tool: "claude",
    displayName: "Claude",
    homePrefixes: [".claude"],
    configDirectories: ["claude"],
    configFiles: [".claude.json", "mcp.json", ".mcp.json", "settings.json"],
    skillDirectories: [
      { relativePath: "skills", mode: "skillFile" },
      { relativePath: "commands", mode: "markdown" },
      { relativePath: "agents", mode: "markdown" },
    ],
  },
  {
    tool: "opencode",
    displayName: "OpenCode",
    homePrefixes: [".opencode"],
    configDirectories: ["opencode"],
    configFiles: ["opencode.json", "opencode.jsonc", "config.json", "settings.json"],
    skillDirectories: [
      { relativePath: "skills", mode: "skillFile" },
      { relativePath: "agent", mode: "markdown" },
      { relativePath: "agents", mode: "markdown" },
      { relativePath: "command", mode: "markdown" },
      { relativePath: "commands", mode: "markdown" },
    ],
  },
] as const;

function toolDefinition(tool: AgentImportTool): AgentToolDefinition {
  return TOOL_DEFINITIONS.find((definition) => definition.tool === tool)!;
}

function toMcpError(detail: string, cause?: unknown): McpConfigError {
  return new McpConfigError({ detail, ...(cause === undefined ? {} : { cause }) });
}

function toSkillError(message: string, cause?: unknown): SkillEngineError {
  return new SkillEngineError({ message, ...(cause === undefined ? {} : { cause }) });
}

function sourceId(tool: AgentImportTool, rootPath: string): AgentImportSourceId {
  return `${tool}:${rootPath}` as AgentImportSourceId;
}

function normalizePath(path: Path.Path, value: string): string {
  return path.resolve(expandHomePath(value));
}

function isAgentDotFolder(name: string, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

function configuredRootsFromSettings(
  path: Path.Path,
  settings: ServerSettings | undefined,
): ReadonlyArray<CandidateRoot> {
  if (!settings) return [];
  const roots: CandidateRoot[] = [];
  const codexHome = settings.providers.codex.homePath.trim();
  if (codexHome) {
    roots.push({
      tool: "codex",
      path: normalizePath(path, codexHome),
      label: "Codex configured home",
    });
  }

  const claudeHome = settings.providers.claudeAgent.homePath.trim();
  if (claudeHome) {
    const resolvedHome = normalizePath(path, claudeHome);
    roots.push({
      tool: "claude",
      path: path.join(resolvedHome, ".claude"),
      label: "Claude configured home",
    });
  }
  return roots;
}

function uniqueRoots(roots: ReadonlyArray<CandidateRoot>): ReadonlyArray<CandidateRoot> {
  const seen = new Set<string>();
  const output: CandidateRoot[] = [];
  for (const root of roots) {
    const key = `${root.tool}:${root.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(root);
  }
  return output;
}

function isDirectory(fileSystem: FileSystem.FileSystem, candidate: string): Effect.Effect<boolean> {
  return fileSystem.stat(candidate).pipe(
    Effect.map((stat) => stat.type === "Directory"),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function isFile(fileSystem: FileSystem.FileSystem, candidate: string): Effect.Effect<boolean> {
  return fileSystem.stat(candidate).pipe(
    Effect.map((stat) => stat.type === "File"),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function homeDotFolderCandidates(input: {
  readonly homeDir: string;
  readonly settings?: ServerSettings | undefined;
}): Effect.Effect<ReadonlyArray<CandidateRoot>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fileSystem
      .readDirectory(input.homeDir)
      .pipe(Effect.orElseSucceed(() => []));
    const roots: CandidateRoot[] = [];

    for (const entry of entries) {
      if (!entry.startsWith(".")) continue;
      for (const definition of TOOL_DEFINITIONS) {
        if (!isAgentDotFolder(entry, definition.homePrefixes)) continue;
        roots.push({
          tool: definition.tool,
          path: path.join(input.homeDir, entry),
          label: `${definition.displayName} ${entry}`,
        });
      }
    }

    const configRoot = path.join(input.homeDir, ".config");
    for (const definition of TOOL_DEFINITIONS) {
      for (const directory of definition.configDirectories) {
        roots.push({
          tool: definition.tool,
          path: path.join(configRoot, directory),
          label: `${definition.displayName} .config/${directory}`,
        });
      }
    }

    return uniqueRoots([...configuredRootsFromSettings(path, input.settings), ...roots]);
  });
}

function configFileCandidates(path: Path.Path, source: CandidateRoot): ReadonlyArray<string> {
  const definition = toolDefinition(source.tool);
  const candidates = definition.configFiles.map((fileName) =>
    fileName === ".claude.json" && source.path.endsWith(`${path.sep}.claude`)
      ? path.join(path.dirname(source.path), fileName)
      : path.join(source.path, fileName),
  );
  return [...new Set(candidates)];
}

function readExistingConfigFiles(input: {
  readonly source: CandidateRoot;
}): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const candidates = configFileCandidates(path, input.source);
    const existing = yield* Effect.forEach(
      candidates,
      (candidate) =>
        isFile(fileSystem, candidate).pipe(Effect.map((exists) => (exists ? candidate : null))),
      { concurrency: "unbounded" },
    );
    return existing.filter((candidate): candidate is string => candidate !== null);
  });
}

function scanFiles(input: {
  readonly root: string;
  readonly accept: (filePath: string) => boolean;
  readonly maxDepth?: number | undefined;
}): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output: string[] = [];

    const visit = (directory: string, depth: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (depth > (input.maxDepth ?? MAX_DISCOVERY_DEPTH)) return;
        const entries = yield* fileSystem
          .readDirectory(directory)
          .pipe(Effect.orElseSucceed(() => []));
        yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.gen(function* () {
              const entryPath = path.join(directory, entry);
              const stat = yield* fileSystem
                .stat(entryPath)
                .pipe(Effect.catch(() => Effect.succeed(null)));
              if (!stat) return;
              if (stat.type === "File") {
                if (input.accept(entryPath)) output.push(entryPath);
                return;
              }
              if (stat.type === "Directory") {
                yield* visit(entryPath, depth + 1);
              }
            }),
          { concurrency: "unbounded" },
        );
      });

    if (yield* isDirectory(fileSystem, input.root)) {
      yield* visit(input.root, 0);
    }
    return output.toSorted((left, right) => left.localeCompare(right));
  });
}

function sourceSkillFiles(input: {
  readonly source: CandidateRoot;
}): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const definition = toolDefinition(input.source.tool);
    const files = yield* Effect.forEach(
      definition.skillDirectories,
      (directory) => {
        const root = path.join(input.source.path, directory.relativePath);
        return scanFiles({
          root,
          accept: (filePath) => {
            const basename = path.basename(filePath);
            if (directory.mode === "skillFile") {
              return basename === "SKILL.md";
            }
            return basename.endsWith(".md") || basename.endsWith(".mdc");
          },
        });
      },
      { concurrency: "unbounded" },
    );
    return files.flat().toSorted((left, right) => left.localeCompare(right));
  });
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonObject(contents: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripJsonComments(contents));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseTomlScalar(raw: string): unknown {
  const trimmed = raw.trim();
  const value =
    trimmed.startsWith('"') || trimmed.startsWith("'")
      ? trimmed
      : trimmed.replace(/#.*$/, "").trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const items: string[] = [];
    for (const match of value.matchAll(/"((?:\\"|[^"])*)"|'([^']*)'/g)) {
      items.push((match[1] ?? match[2] ?? "").replaceAll('\\"', '"'));
    }
    return items;
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return Object.fromEntries(
      value
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf("=");
          if (index < 0) return null;
          return [part.slice(0, index).trim(), parseTomlScalar(part.slice(index + 1))] as const;
        })
        .filter((entry): entry is readonly [string, unknown] => entry !== null),
    );
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseCodexMcpToml(contents: string): Record<string, RawMcpServerInput> {
  const servers: Record<
    string,
    RawMcpServerInput & { env?: Record<string, unknown>; headers?: Record<string, unknown> }
  > = {};
  let current: {
    readonly name: string;
    readonly nested: "server" | "env" | "headers";
  } | null = null;

  for (const line of contents.replaceAll("\r\n", "\n").split("\n")) {
    const section = /^\s*\[mcp_servers\.([^\].]+)(?:\.(env|http_headers|headers))?\]\s*$/.exec(
      line,
    );
    if (section) {
      const name = section[1]!;
      const nested = section[2] === "env" ? "env" : section[2] ? "headers" : "server";
      servers[name] ??= {};
      current = { name, nested };
      continue;
    }
    if (!current || !line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = parseTomlScalar(line.slice(separator + 1));
    const server = servers[current.name]!;
    if (current.nested === "env") {
      server.env = { ...server.env, [key]: value };
      continue;
    }
    if (current.nested === "headers") {
      server.headers = { ...server.headers, [key]: value };
      continue;
    }
    if (key === "http_headers") {
      server.headers =
        typeof value === "object" && value && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      continue;
    }
    (server as Record<string, unknown>)[key] = value;
  }
  return servers;
}

function valueMapToSecretMap(input: unknown): Record<string, McpSecretValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .filter(
        ([, value]) =>
          typeof value === "string" || typeof value === "number" || typeof value === "boolean",
      )
      .map(([name, value]) => [
        name,
        // Agent-native MCP files do not describe sensitivity. Default these
        // imported values to secrets so tokens and authorization headers are
        // never copied into T3's settings.json in plaintext.
        { value: String(value), sensitive: true } satisfies McpSecretValue,
      ]),
  );
}

function stringArray(input: unknown): ReadonlyArray<string> {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : [];
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefixed = /^[a-zA-Z]/.test(normalized) ? normalized : `imported_${normalized}`;
  return (prefixed || "imported").slice(0, MCP_ID_MAX_LENGTH);
}

function uniqueMcpServerId(name: string, reservedIds: Set<string>): McpServerId {
  const base = slug(name);
  let candidate = base;
  let suffix = 2;
  while (reservedIds.has(candidate)) {
    const text = `_${suffix}`;
    candidate = `${base.slice(0, MCP_ID_MAX_LENGTH - text.length)}${text}`;
    suffix += 1;
  }
  reservedIds.add(candidate);
  return candidate as McpServerId;
}

function rawMcpServersFromJson(parsed: Record<string, unknown>): Record<string, RawMcpServerInput> {
  const mcpServers = parsed.mcpServers;
  if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
    return mcpServers as Record<string, RawMcpServerInput>;
  }
  const mcp = parsed.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    return mcp as Record<string, RawMcpServerInput>;
  }
  return {};
}

function normalizeMcpServers(input: {
  readonly rawServers: Record<string, RawMcpServerInput>;
  readonly reservedIds: Set<string>;
  readonly providerRouting: McpProviderRouting;
  readonly scope: "global" | "project";
  readonly projectId?: ProjectId | undefined;
  readonly projectCwd?: string | undefined;
}): ReadonlyArray<McpServerDefinition> {
  const servers: McpServerDefinition[] = [];
  for (const [rawName, rawServer] of Object.entries(input.rawServers)) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) continue;
    if (rawServer.enabled === false) continue;
    const id = uniqueMcpServerId(rawName, input.reservedIds);
    const name = rawName.trim() || id;
    const base = {
      id,
      name,
      enabled: true,
      providerRouting: input.providerRouting,
      scope: input.scope,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
    };

    const commandArray = stringArray(rawServer.command);
    const command =
      typeof rawServer.command === "string"
        ? rawServer.command.trim()
        : commandArray.length > 0
          ? commandArray[0]!.trim()
          : "";
    if (command) {
      servers.push({
        ...base,
        transport: "stdio",
        command,
        args: commandArray.length > 0 ? commandArray.slice(1) : stringArray(rawServer.args),
        ...(typeof rawServer.cwd === "string" && rawServer.cwd.trim()
          ? { cwd: rawServer.cwd.trim() }
          : {}),
        env: valueMapToSecretMap(rawServer.env ?? rawServer.environment),
      });
      continue;
    }

    if (typeof rawServer.url === "string" && rawServer.url.trim()) {
      const transport = rawServer.type === "sse" || rawServer.transport === "sse" ? "sse" : "http";
      servers.push({
        ...base,
        transport,
        url: rawServer.url.trim(),
        headers: valueMapToSecretMap(rawServer.headers),
      });
    }
  }
  return servers;
}

function mcpServerSignature(server: McpServerDefinition): string {
  switch (server.transport) {
    case "stdio":
      return ["stdio", server.command, ...server.args, server.cwd ?? ""].join("\u0000");
    case "sse":
    case "http":
      return [server.transport, server.url].join("\u0000");
  }
}

function deduplicateMcpServers(input: {
  readonly importedServers: ReadonlyArray<McpServerDefinition>;
  readonly existingServers?: ReadonlyArray<McpServerDefinition> | undefined;
}): ReadonlyArray<McpServerDefinition> {
  const seen = new Set((input.existingServers ?? []).map(mcpServerSignature));
  const output: McpServerDefinition[] = [];
  for (const server of input.importedServers) {
    const signature = mcpServerSignature(server);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    output.push(server);
  }
  return output;
}

function normalizedSkillBody(body: string | undefined): string {
  return (body ?? "").replaceAll("\r\n", "\n").trim();
}

function skillImportSignature(skill: {
  readonly name: string;
  readonly body?: string | undefined;
}): string {
  return [skill.name.trim().toLowerCase(), normalizedSkillBody(skill.body)].join("\u0000");
}

function deduplicateImportedSkills(input: {
  readonly importedSkills: ReadonlyArray<RawSkillImport>;
  readonly existingSkills?: ReadonlyArray<SkillDescriptor> | undefined;
}): ReadonlyArray<RawSkillImport> {
  const seen = new Set((input.existingSkills ?? []).map(skillImportSignature));
  const output: RawSkillImport[] = [];
  for (const skill of input.importedSkills) {
    const signature = skillImportSignature(skill);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    output.push(skill);
  }
  return output;
}

function readMcpServersFromConfig(input: {
  readonly filePath: string;
  readonly reservedIds: Set<string>;
  readonly providerRouting: McpProviderRouting;
  readonly scope: "global" | "project";
  readonly projectId?: ProjectId | undefined;
  readonly projectCwd?: string | undefined;
}): Effect.Effect<ReadonlyArray<McpServerDefinition>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const contents = yield* fileSystem
      .readFileString(input.filePath)
      .pipe(Effect.orElseSucceed(() => ""));
    if (!contents.trim()) return [];
    const rawServers = path.basename(input.filePath).endsWith(".toml")
      ? parseCodexMcpToml(contents)
      : rawMcpServersFromJson(parseJsonObject(contents) ?? {});
    return normalizeMcpServers({
      rawServers,
      reservedIds: input.reservedIds,
      providerRouting: input.providerRouting,
      scope: input.scope,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
    });
  });
}

function markdownDescription(input: string, fallback: string): string {
  const lines = input.replaceAll("\r\n", "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---" || /^[A-Za-z0-9_-]+:\s*/.test(trimmed)) continue;
    const withoutHeading = trimmed.replace(/^#+\s*/, "");
    return withoutHeading.slice(0, 180) || fallback;
  }
  return fallback;
}

function importedSkillFromContents(input: {
  readonly filePath: string;
  readonly contents: string;
  readonly sourceTool: AgentImportTool;
}): RawSkillImport {
  const parsed = parseSkillFile(input.contents);
  const fallbackName = slug(
    input.filePath.split(/[\\/]/).at(-2) ??
      input.filePath.split(/[\\/]/).at(-1) ??
      "imported_skill",
  );
  const name = isValidSkillName(parsed.name ?? "")
    ? parsed.name!
    : slug(parsed.name ?? fallbackName);
  const fallbackDescription = `Imported from ${toolDefinition(input.sourceTool).displayName}.`;
  return {
    name,
    description: parsed.description ?? markdownDescription(parsed.body, fallbackDescription),
    body: parsed.body,
    ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
    ...(parsed.shortDescription ? { shortDescription: parsed.shortDescription } : {}),
    sourcePath: input.filePath,
    sourceTool: input.sourceTool,
  };
}

function readSkillsFromSource(
  source: ResolvedSource,
): Effect.Effect<ReadonlyArray<RawSkillImport>, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const skills = yield* Effect.forEach(
      source.skillPaths,
      (filePath) =>
        fileSystem.readFileString(filePath).pipe(
          Effect.map((contents) =>
            importedSkillFromContents({
              filePath,
              contents,
              sourceTool: source.tool,
            }),
          ),
          Effect.catch(() => Effect.succeed(null)),
        ),
      { concurrency: "unbounded" },
    );
    return skills.filter((skill): skill is RawSkillImport => skill !== null);
  });
}

function resolveSources(
  input: {
    readonly homeDir?: string | undefined;
    readonly settings?: ServerSettings | undefined;
  } = {},
): Effect.Effect<ReadonlyArray<ResolvedSource>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const candidates = yield* homeDotFolderCandidates({
      homeDir: input.homeDir ?? NodeOS.homedir(),
      settings: input.settings,
    });
    const existing = yield* Effect.forEach(
      candidates,
      (candidate) =>
        isDirectory(fileSystem, candidate.path).pipe(
          Effect.map((exists) => (exists ? candidate : null)),
        ),
      { concurrency: "unbounded" },
    );
    return yield* Effect.forEach(
      existing.filter((candidate): candidate is CandidateRoot => candidate !== null),
      (candidate) =>
        Effect.gen(function* () {
          const [mcpConfigPaths, skillPaths] = yield* Effect.all(
            [
              readExistingConfigFiles({ source: candidate }),
              sourceSkillFiles({ source: candidate }),
            ],
            { concurrency: "unbounded" },
          );
          const reservedIds = new Set<string>();
          const mcpServers = yield* Effect.forEach(
            mcpConfigPaths,
            (filePath) =>
              readMcpServersFromConfig({
                filePath,
                reservedIds,
                providerRouting: { mode: "all" },
                scope: "global",
              }),
            { concurrency: "unbounded" },
          );
          const definition = toolDefinition(candidate.tool);
          return {
            id: sourceId(candidate.tool, candidate.path),
            tool: candidate.tool,
            label: candidate.label || definition.displayName,
            path: candidate.path,
            rootPath: candidate.path,
            mcpConfigPaths,
            skillPaths,
            mcpServerCount: mcpServers.flat().length,
            skillCount: skillPaths.length,
          } satisfies ResolvedSource;
        }),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((sources) =>
        sources.toSorted((left, right) => left.label.localeCompare(right.label)),
      ),
    );
  });
}

function selectedSources(input: {
  readonly sources: ReadonlyArray<ResolvedSource>;
  readonly sourceIds: ReadonlyArray<AgentImportSourceId>;
}): ReadonlyArray<ResolvedSource> {
  const ids = new Set(input.sourceIds);
  return input.sources.filter((source) => ids.has(source.id));
}

export function discoverAgentImportSources(
  input: {
    readonly homeDir?: string | undefined;
    readonly settings?: ServerSettings | undefined;
  } = {},
): Effect.Effect<AgentImportSourcesResult, never, FileSystem.FileSystem | Path.Path> {
  return resolveSources(input).pipe(Effect.map((sources) => ({ sources })));
}

export function importMcpServersFromAgentSources(input: {
  readonly sourceIds: ReadonlyArray<AgentImportSourceId>;
  readonly providerRouting?: McpProviderRouting | undefined;
  readonly scope: "global" | "project";
  readonly projectId?: ProjectId | undefined;
  readonly projectCwd?: string | undefined;
  readonly reservedIds?: ReadonlySet<string> | undefined;
  readonly existingServers?: ReadonlyArray<McpServerDefinition> | undefined;
  readonly deduplicate?: boolean | undefined;
  readonly homeDir?: string | undefined;
  readonly settings?: ServerSettings | undefined;
}): Effect.Effect<
  ReadonlyArray<McpServerDefinition>,
  McpConfigError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    if (input.sourceIds.length === 0) {
      return yield* toMcpError("Select at least one agent import source.");
    }
    const allSources = yield* resolveSources({ homeDir: input.homeDir, settings: input.settings });
    const sources = selectedSources({ sources: allSources, sourceIds: input.sourceIds });
    if (sources.length === 0) {
      return yield* toMcpError("None of the selected agent import sources were found.");
    }
    const reservedIds = new Set(input.reservedIds ?? []);
    const imported = yield* Effect.forEach(
      sources,
      (source) =>
        Effect.forEach(
          source.mcpConfigPaths,
          (filePath) =>
            readMcpServersFromConfig({
              filePath,
              reservedIds,
              providerRouting: input.providerRouting ?? { mode: "all" },
              scope: input.scope,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
            }),
          { concurrency: "unbounded" },
        ),
      { concurrency: "unbounded" },
    );
    const importedServers = imported.flat(2);
    const servers =
      (input.deduplicate ?? true)
        ? deduplicateMcpServers({
            importedServers,
            existingServers: input.existingServers,
          })
        : importedServers;
    if (servers.length === 0) {
      return yield* toMcpError(
        (input.deduplicate ?? true)
          ? "The selected agent import sources do not contain new MCP servers after deduplication."
          : "The selected agent import sources do not contain MCP servers.",
      );
    }
    return servers;
  });
}

export function importSkillsFromAgentSources(input: {
  readonly sourceIds: ReadonlyArray<AgentImportSourceId>;
  readonly existingSkills?: ReadonlyArray<SkillDescriptor> | undefined;
  readonly deduplicate?: boolean | undefined;
  readonly homeDir?: string | undefined;
  readonly settings?: ServerSettings | undefined;
}): Effect.Effect<
  ReadonlyArray<RawSkillImport>,
  SkillEngineError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    if (input.sourceIds.length === 0) {
      return yield* toSkillError("Select at least one agent import source.");
    }
    const allSources = yield* resolveSources({ homeDir: input.homeDir, settings: input.settings });
    const sources = selectedSources({ sources: allSources, sourceIds: input.sourceIds });
    if (sources.length === 0) {
      return yield* toSkillError("None of the selected agent import sources were found.");
    }
    const imported = yield* Effect.forEach(sources, readSkillsFromSource, {
      concurrency: "unbounded",
    });
    const importedSkills = imported.flat();
    const skills =
      (input.deduplicate ?? true)
        ? deduplicateImportedSkills({
            importedSkills,
            existingSkills: input.existingSkills,
          })
        : importedSkills;
    if (skills.length === 0) {
      return yield* toSkillError(
        (input.deduplicate ?? true)
          ? "The selected agent import sources do not contain new skills after deduplication."
          : "The selected agent import sources do not contain skills.",
      );
    }
    return skills;
  });
}

export type { RawSkillImport as AgentImportedSkill };
