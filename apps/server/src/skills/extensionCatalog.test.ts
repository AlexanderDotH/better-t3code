import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  searchExtensionCatalog,
  validateRegistrySkillFiles,
  previewRegistrySkill,
} from "./extensionCatalog.ts";
import { mcpCatalogEntry } from "./mcpCatalog.ts";

const files = [
  {
    path: "SKILL.md",
    contents: "---\nname: review\ndescription: Review changes\n---\nRead references/checks.md",
  },
  { path: "references/checks.md", contents: "Check error handling." },
];

describe("extension registry packages", () => {
  it.effect("preserves the registry rate-limit message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        searchExtensionCatalog({ kind: "mcp", query: "playwright" }),
      );
      expect(error.message).toBe("The registry is rate limited. Please try again later.");
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(
        FetchHttpClient.Fetch,
        Object.assign(async () => new Response(null, { status: 429 }), {
          preconnect: () => {},
        }),
      ),
    ),
  );

  it("hashes all skill files and rejects paths that escape or collide", () => {
    const valid = validateRegistrySkillFiles(files);
    expect(valid.name).toBe("review");
    expect(valid.contentHash).toBe(validateRegistrySkillFiles(files.toReversed()).contentHash);
    expect(valid.contentHash).not.toBe(
      validateRegistrySkillFiles([files[0]!, { ...files[1]!, contents: "changed" }]).contentHash,
    );
    for (const path of [
      "../outside",
      "/absolute",
      "refs/../outside",
      "refs\\outside",
      "C:/outside",
      "refs//file",
      ".git/config",
      "skill.md",
    ]) {
      expect(() => validateRegistrySkillFiles([...files, { path, contents: "bad" }])).toThrow();
    }
    expect(() => validateRegistrySkillFiles([{ path: "other.md", contents: "no skill" }])).toThrow(
      "SKILL.md",
    );
    expect(() =>
      validateRegistrySkillFiles([
        ...files,
        { path: "large", contents: "x".repeat(4 * 1024 * 1024) },
      ]),
    ).toThrow("4 MB");
  });

  it("maps pinned npm packages and prompts for required values without inventing a command", () => {
    const entry = mcpCatalogEntry({
      name: "io.github.example/files",
      description: "File tools",
      version: "1.2.3",
      packages: [
        {
          registryType: "npm",
          identifier: "@example/files",
          version: "1.2.3",
          transport: { type: "stdio" },
          runtimeArguments: [{ type: "positional", value: "-y" }],
          packageArguments: [{ type: "named", name: "--root", isRequired: true }],
          environmentVariables: [{ name: "API_KEY", isSecret: true, isRequired: true }],
        },
      ],
    });
    expect(entry.id).toMatch(/^mcp-[a-f0-9]{32}$/);
    expect(entry.connections[0]?.args).toEqual([
      { value: "-y" },
      { value: "@example/files@1.2.3" },
      { name: "--root", value: "{--root}" },
    ]);
    expect(entry.connections[0]?.inputs).toContainEqual({
      key: "API_KEY",
      label: "API_KEY",
      description: "",
      secret: true,
      required: true,
      defaultValue: "",
    });
    expect(
      mcpCatalogEntry({
        name: "test",
        description: "test",
        version: "1",
        packages: [{ registryType: "npm", identifier: "--eval=bad", transport: { type: "stdio" } }],
      }).connections,
    ).toEqual([]);
  });

  it("retains remote URL variables and treats authorization inputs as secrets", () => {
    const entry = mcpCatalogEntry({
      name: "test",
      description: "test",
      version: "1",
      remotes: [
        {
          type: "streamable-http",
          url: "https://{tenant}.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer {token}" }],
        },
      ],
    });
    expect(entry.connections[0]?.url).toBe("https://{tenant}.example.com/mcp");
    expect(entry.connections[0]?.inputs.find((input) => input.key === "token")).toMatchObject({
      required: true,
      secret: true,
    });
  });

  it.effect("searches the public APIs and previews a complete skill package", () =>
    Effect.gen(function* () {
      const mcp = yield* searchExtensionCatalog({ kind: "mcp", query: "playwright" });
      expect(mcp.entries).toHaveLength(1);
      expect(mcp.entries[0]?.sourceUrl).toContain("registry.modelcontextprotocol.io");
      const searched = yield* searchExtensionCatalog({ kind: "skill", query: "review" });
      expect(searched.entries).toMatchObject([{ id: "example/skills/review", kind: "skill" }]);
      const preview = yield* previewRegistrySkill({ source: "example/skills/review" });
      expect(preview.fileCount).toBe(2);
      expect(preview.contentHash).toBe(validateRegistrySkillFiles(files).contentHash);
      expect(preview.body).toContain("references/checks.md");
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(
        FetchHttpClient.Fetch,
        Object.assign(
          async (request: Parameters<typeof fetch>[0]) => {
            const url = String(request);
            if (url.includes("registry.modelcontextprotocol.io"))
              return Response.json({
                servers: [
                  {
                    server: {
                      name: "playwright",
                      description: "Browser tools",
                      version: "1",
                      repository: {},
                    },
                  },
                ],
              });
            if (url.includes("/api/search?"))
              return Response.json({
                skills: [
                  {
                    id: "example/skills/review",
                    name: "review",
                    source: "example/skills",
                    skillId: "review",
                    installs: 123,
                  },
                ],
              });
            expect(url).toBe("https://skills.sh/api/download/example/skills/review");
            return Response.json({ files });
          },
          { preconnect: () => {} },
        ),
      ),
    ),
  );
});
