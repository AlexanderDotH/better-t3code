import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  discoverAgentImportSources,
  importMcpServersFromAgentSources,
  importSkillsFromAgentSources,
} from "./agentImportSources.ts";

function writeFile(filePath: string, contents: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

it.layer(NodeServices.layer)("agent import sources", (it) => {
  it.effect("discovers agent dotfolders with MCP servers and skills", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-agent-import-home-",
      });
      const codexRoot = path.join(homeDir, ".codex");
      const cursorRoot = path.join(homeDir, ".cursor");
      const reviewSkillContents = [
        "---",
        'name: "review"',
        'description: "Review changed code."',
        "---",
        "",
        "# Guidance",
      ].join("\n");
      const explainSkillContents = [
        "---",
        'name: "explain"',
        'description: "Explain unfamiliar code."',
        "---",
        "",
        "# Instructions",
      ].join("\n");

      yield* writeFile(
        path.join(codexRoot, "config.toml"),
        [
          "[mcp_servers.github]",
          'command = "npx"',
          'args = ["-y", "@modelcontextprotocol/server-github"]',
          "[mcp_servers.github.env]",
          'GITHUB_TOKEN = "secret"',
        ].join("\n"),
      );
      yield* writeFile(path.join(codexRoot, "skills", "review", "SKILL.md"), reviewSkillContents);
      yield* writeFile(
        path.join(cursorRoot, "mcp.json"),
        [
          "{",
          '  "mcpServers": {',
          '    "docs": {',
          '      "type": "sse",',
          '      "url": "https://example.com/sse"',
          "    },",
          '    "github_copy": {',
          '      "command": "npx",',
          '      "args": ["-y", "@modelcontextprotocol/server-github"],',
          '      "env": { "GITHUB_TOKEN": "secret" }',
          "    }",
          "  }",
          "}",
        ].join("\n"),
      );
      yield* writeFile(path.join(cursorRoot, "skills", "review", "SKILL.md"), reviewSkillContents);
      yield* writeFile(
        path.join(cursorRoot, "skills", "explain", "SKILL.md"),
        explainSkillContents,
      );

      const discovered = yield* discoverAgentImportSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
      });
      assert.deepEqual(
        discovered.sources.map((source) => ({
          tool: source.tool,
          mcpServerCount: source.mcpServerCount,
          skillCount: source.skillCount,
        })),
        [
          { tool: "codex", mcpServerCount: 1, skillCount: 1 },
          { tool: "cursor", mcpServerCount: 2, skillCount: 2 },
        ],
      );

      const importedMcp = yield* importMcpServersFromAgentSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
        sourceIds: discovered.sources.map((source) => source.id),
        scope: "global",
      });
      assert.deepEqual(
        importedMcp.map((server) => ({ id: server.id, transport: server.transport })),
        [
          { id: "github", transport: "stdio" },
          { id: "docs", transport: "sse" },
        ],
      );

      const importedWithoutDedupe = yield* importMcpServersFromAgentSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
        sourceIds: discovered.sources.map((source) => source.id),
        scope: "global",
        deduplicate: false,
      });
      assert.deepEqual(
        importedWithoutDedupe.map((server) => ({ id: server.id, transport: server.transport })),
        [
          { id: "github", transport: "stdio" },
          { id: "docs", transport: "sse" },
          { id: "github_copy", transport: "stdio" },
        ],
      );

      const importedSkills = yield* importSkillsFromAgentSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
        sourceIds: discovered.sources.map((source) => source.id),
      });
      assert.deepEqual(
        importedSkills.map((skill) => ({
          name: skill.name,
          description: skill.description,
        })),
        [
          { name: "review", description: "Review changed code." },
          { name: "explain", description: "Explain unfamiliar code." },
        ],
      );

      const importedSkillsWithoutDedupe = yield* importSkillsFromAgentSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
        sourceIds: discovered.sources.map((source) => source.id),
        deduplicate: false,
      });
      assert.deepEqual(
        importedSkillsWithoutDedupe.map((skill) => ({
          name: skill.name,
          description: skill.description,
        })),
        [
          { name: "review", description: "Review changed code." },
          { name: "explain", description: "Explain unfamiliar code." },
          { name: "review", description: "Review changed code." },
        ],
      );

      const importedAgainstExisting = yield* importSkillsFromAgentSources({
        homeDir,
        settings: DEFAULT_SERVER_SETTINGS,
        sourceIds: discovered.sources.map((source) => source.id),
        existingSkills: [
          {
            id: "global:/tmp/review/SKILL.md",
            name: "review",
            path: "/tmp/review/SKILL.md",
            scope: "global",
            enabled: true,
            readOnly: false,
            providerSupport: [],
            body: "# Guidance",
          },
        ],
      });
      assert.deepEqual(
        importedAgainstExisting.map((skill) => skill.name),
        ["explain"],
      );
    }),
  );
});
