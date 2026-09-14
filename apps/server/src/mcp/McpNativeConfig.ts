import * as NodeOS from "node:os";

import {
  McpNativeServer,
  type McpServerScope,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { isProviderInstanceEnabled } from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readMcpServersFromConfig } from "../agentImportSources.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";

const NativeConfigSettings = Schema.Struct({
  homePath: Schema.optionalKey(Schema.String),
  shadowHomePath: Schema.optionalKey(Schema.String),
  serverUrl: Schema.optionalKey(Schema.String),
});
const decodeNativeConfigSettings = Schema.decodeUnknownOption(NativeConfigSettings);
const decodeNativeServer = Schema.decodeUnknownOption(McpNativeServer);

export const discoverNativeMcpServers = Effect.fn("discoverNativeMcpServers")(function* (input: {
  readonly provider: Pick<ServerProvider, "instanceId" | "driver">;
  readonly settings: ServerSettings;
  readonly scope?: McpServerScope;
  readonly projectCwd?: string;
  readonly homeDir?: string;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  const { provider, settings } = input;
  if (!isProviderInstanceEnabled(settings, provider.instanceId)) return [];
  const path = yield* Path.Path;
  const instance = settings.providerInstances[provider.instanceId];
  const legacy = settings.providers[provider.driver as keyof ServerSettings["providers"]];
  const decoded = decodeNativeConfigSettings(instance ? (instance.config ?? {}) : legacy);
  if (Option.isNone(decoded)) return [];
  const config = decoded.value;
  const environment = mergeProviderInstanceEnvironment(instance?.environment, input.environment);
  const home = input.homeDir ?? environment.HOME ?? NodeOS.homedir();
  const scope = input.scope ?? "global";
  const projectCwd = input.projectCwd ? path.resolve(input.projectCwd) : undefined;
  if (scope === "project" && !projectCwd) return [];
  const configuredHome = config.homePath?.trim();
  const files: Array<{ filePath: string; claudeProjectCwd?: string; contents?: string }> = [];
  const add = (...segments: string[]) => files.push({ filePath: path.join(...segments) });

  // ponytail: discover direct config files; plugin and compatibility overlays come from live runtime reports.
  switch (provider.driver) {
    case "codex":
      if (scope === "project") {
        add(projectCwd!, ".codex", "config.toml");
      } else {
        add(
          path.resolve(
            expandHomePath(configuredHome || environment.CODEX_HOME || path.join(home, ".codex")),
          ),
          "config.toml",
        );
        if (config.shadowHomePath?.trim())
          add(path.resolve(expandHomePath(config.shadowHomePath)), "config.toml");
      }
      break;
    case "claudeAgent": {
      const configDir = configuredHome
        ? path.resolve(expandHomePath(configuredHome))
        : environment.CLAUDE_CONFIG_DIR
          ? path.resolve(projectCwd ?? ".", environment.CLAUDE_CONFIG_DIR)
          : path.join(home, ".claude");
      const configFile =
        configuredHome || environment.CLAUDE_CONFIG_DIR
          ? path.join(configDir, ".claude.json")
          : path.join(home, ".claude.json");
      if (scope === "project") {
        add(projectCwd!, ".mcp.json");
        files.push({ filePath: configFile, claudeProjectCwd: projectCwd! });
      } else {
        add(configFile);
      }
      break;
    }
    case "cursor":
      add(scope === "project" ? projectCwd! : home, ".cursor", "mcp.json");
      break;
    case "grok":
      add(
        scope === "project"
          ? path.join(projectCwd!, ".grok")
          : environment.GROK_HOME || path.join(home, ".grok"),
        "config.toml",
      );
      break;
    case "opencode": {
      if (config.serverUrl?.trim()) return [];
      const root =
        scope === "project"
          ? projectCwd!
          : path.join(environment.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
      add(root, "opencode.json");
      add(root, "opencode.jsonc");
      if (scope === "project") {
        add(root, ".opencode", "opencode.json");
        add(root, ".opencode", "opencode.jsonc");
      } else {
        if (environment.OPENCODE_CONFIG) add(environment.OPENCODE_CONFIG);
        if (environment.OPENCODE_CONFIG_CONTENT)
          files.push({
            filePath: "OPENCODE_CONFIG_CONTENT",
            contents: environment.OPENCODE_CONFIG_CONTENT,
          });
      }
      break;
    }
    // Antigravity isolates its MCP configuration; endpoint providers use T3's definitions.
    default:
      return [];
  }

  const servers = new Map<string, McpNativeServer>();
  for (const file of files) {
    const discovered = yield* readMcpServersFromConfig({
      ...file,
      scope,
      ...(projectCwd ? { projectCwd } : {}),
      reservedIds: new Set(),
      providerRouting: { mode: "selected", instanceIds: [provider.instanceId] },
      includeDisabled: true,
    });
    for (const server of discovered) {
      const summary = decodeNativeServer({
        name: server.name,
        transport: server.transport,
        enabled: server.enabled,
        scope,
        configPath: file.filePath,
      });
      if (Option.isSome(summary)) servers.set(summary.value.name, summary.value);
    }
  }
  return [...servers.values()];
});
