import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { discoverNativeMcpServers } from "./McpNativeConfig.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const writeFile = Effect.fn("writeNativeMcpConfig")(function* (file: string, contents: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, contents);
});

it.layer(NodeServices.layer)("native MCP configuration discovery", (it) => {
  it.effect("reads the selected account, preserves disabled servers, and exposes no secrets", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-mcp-native-" });
      const accountHome = path.join(homeDir, "work");
      const file = path.join(accountHome, "config.toml");
      const provider = {
        instanceId: ProviderInstanceId.make("codex_work"),
        driver: ProviderDriverKind.make("codex"),
      };
      const settings: ServerSettings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          [provider.instanceId]: {
            driver: provider.driver,
            enabled: true,
            config: { homePath: accountHome },
          },
        },
      };
      yield* writeFile(
        path.join(homeDir, ".codex/config.toml"),
        '[mcp_servers.personal]\ncommand = "personal-only"',
      );
      yield* writeFile(
        file,
        [
          '[mcp_servers."docs.example"]',
          'url = "https://example.com/mcp?key=never-send-this"',
          '[mcp_servers."docs.example".http_headers]',
          'Authorization = "Bearer private-token"',
          "[mcp_servers.off]",
          'command = "private-command"',
          'args = ["--token=private-argument"]',
          "enabled = false",
          "[unrelated]",
          "enabled = true",
        ].join("\n"),
      );

      const input = { provider, settings, homeDir, environment: {} };
      const discovered = yield* discoverNativeMcpServers(input);
      assert.deepEqual(discovered, [
        {
          name: "docs.example",
          transport: "http",
          enabled: true,
          scope: "global",
          configPath: file,
        },
        { name: "off", transport: "stdio", enabled: false, scope: "global", configPath: file },
      ]);
      assert.notInclude(encodeJson(discovered), "private");
      assert.notInclude(encodeJson(discovered), "never-send-this");
      yield* writeFile(file, '[mcp_servers.replacement]\ncommand = "new-server"');
      assert.deepEqual(
        (yield* discoverNativeMcpServers(input)).map((server) => server.name),
        ["replacement"],
      );
      assert.deepEqual(
        yield* discoverNativeMcpServers({
          ...input,
          settings: {
            ...settings,
            providerInstances: {
              [provider.instanceId]: {
                driver: provider.driver,
                enabled: false,
                config: { homePath: accountHome },
              },
            },
          },
        }),
        [],
      );
    }),
  );

  it.effect("discovers each provider's direct configuration without a runtime session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-mcp-native-" });
      for (const [driver, relativePath, contents] of [
        ["codex", ".codex/config.toml", '[mcp_servers.docs]\ncommand = "docs"'],
        ["claudeAgent", ".claude.json", '{"mcpServers":{"docs":{"url":"https://example.com"}}}'],
        ["cursor", ".cursor/mcp.json", '{"mcpServers":{"docs":{"command":"docs"}}}'],
        ["grok", ".grok/config.toml", '[mcp_servers.docs]\nurl = "https://example.com"'],
        [
          "opencode",
          ".config/opencode/opencode.jsonc",
          '{// comment\n"mcp":{"docs":{"type":"local","command":["docs"],},},}',
        ],
      ] as const) {
        yield* writeFile(path.join(homeDir, relativePath), contents);
        const provider = {
          instanceId: ProviderInstanceId.make(driver),
          driver: ProviderDriverKind.make(driver),
        };
        const settings = {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [provider.instanceId]: { driver: provider.driver, enabled: true, config: {} },
          },
        };
        const discovered = yield* discoverNativeMcpServers({
          provider,
          settings,
          homeDir,
          environment: {},
        });
        assert.deepEqual(
          discovered.map((server) => server.name),
          ["docs"],
          driver,
        );
        assert.equal(discovered[0]?.configPath, path.join(homeDir, relativePath));
      }
    }),
  );

  it.effect(
    "separates global and project config, with Claude local overrides taking precedence",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-mcp-native-" });
        const projectCwd = path.join(homeDir, "project");
        const configDir = path.join(homeDir, "claude-work");
        const configFile = path.join(configDir, ".claude.json");
        yield* writeFile(
          configFile,
          encodeJson({
            mcpServers: { global: { command: "global" } },
            projects: {
              [projectCwd]: { mcpServers: { docs: { command: "local-override" } } },
              "/unrelated": { mcpServers: { other: { command: "other" } } },
            },
          }),
        );
        yield* writeFile(
          path.join(projectCwd, ".mcp.json"),
          '{"mcpServers":{"docs":{"url":"https://example.com"},"project":{"command":"project"}}}',
        );
        const provider = {
          instanceId: ProviderInstanceId.make("claude_work"),
          driver: ProviderDriverKind.make("claudeAgent"),
        };
        const settings = {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [provider.instanceId]: {
              driver: provider.driver,
              enabled: true,
              config: { homePath: configDir },
            },
          },
        };
        const input = { provider, settings, homeDir, projectCwd, environment: {} };
        assert.deepEqual(
          (yield* discoverNativeMcpServers(input)).map((server) => server.name),
          ["global"],
        );
        const project = yield* discoverNativeMcpServers({ ...input, scope: "project" });
        assert.deepEqual(
          project.map((server) => [server.name, server.scope]),
          [
            ["docs", "project"],
            ["project", "project"],
          ],
        );
        assert.equal(project[0]?.transport, "stdio");
        assert.equal(project[0]?.configPath, configFile);
      }),
  );

  it.effect(
    "keeps missing files and external OpenCode environments separate from local servers",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-mcp-native-" });
        yield* writeFile(
          path.join(homeDir, ".config/opencode/opencode.json"),
          '{"mcp":{"local":{"command":["local"]}}}',
        );
        for (const driver of [
          "cursor",
          "opencode",
          "antigravity",
          "openaiCompatible",
          "lmstudio",
        ]) {
          const provider = {
            instanceId: ProviderInstanceId.make(driver),
            driver: ProviderDriverKind.make(driver),
          };
          const settings = {
            ...DEFAULT_SERVER_SETTINGS,
            providerInstances: {
              [provider.instanceId]: {
                driver: provider.driver,
                enabled: true,
                config: { serverUrl: "https://remote.example" },
              },
            },
          };
          assert.deepEqual(
            yield* discoverNativeMcpServers({ provider, settings, homeDir, environment: {} }),
            [],
            driver,
          );
        }
      }),
  );
});
