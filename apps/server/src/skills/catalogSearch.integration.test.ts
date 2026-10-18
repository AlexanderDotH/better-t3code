import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import { searchExtensionCatalog } from "./extensionCatalog.ts";

const mcpServer = {
  name: "io.github.microsoft/playwright-mcp",
  title: "Playwright",
  description: "Browser automation",
  version: "1.0.0",
  packages: [{ registryType: "npm", identifier: "@playwright/mcp", transport: { type: "stdio" } }],
};
const provideFetch = (fetcher: (url: URL) => Response) =>
  Effect.provideService(
    FetchHttpClient.Fetch,
    Object.assign(
      async (request: Parameters<typeof fetch>[0]) => fetcher(new URL(String(request))),
      { preconnect: () => {} },
    ),
  );

describe("case insensitive and fuzzy public catalog search", () => {
  it.effect("normalizes skill queries and ranks matches before pagination", () =>
    Effect.gen(function* () {
      const result = yield* searchExtensionCatalog({ kind: "skill", query: "  ReAcT  " });
      expect(result.entries.map((entry) => entry.name)).toEqual(["React", "react-native", "recat"]);
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      provideFetch((url) => {
        expect(url.searchParams.get("q")).toBe("react");
        return Response.json({
          skills: ["recat", "react-native", "React"].map((name) => ({
            id: "example/skills/" + name,
            source: "example/skills",
            skillId: name,
            name,
          })),
        });
      }),
    ),
  );

  it.effect(
    "finds an MCP server even when registries return no results for the misspelled query",
    () => {
      const requests: URL[] = [];
      return Effect.gen(function* () {
        const result = yield* searchExtensionCatalog({ kind: "mcp", query: "  PLAYWRIGTH  " });
        expect(result.entries.some((entry) => entry.name === "Playwright")).toBe(true);
        expect(requests.length).toBeLessThanOrEqual(8);
        expect(
          requests.every(
            (url) =>
              url.searchParams.get("search") === url.searchParams.get("search")?.toLowerCase(),
          ),
        ).toBe(true);
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        provideFetch((url) => {
          requests.push(url);
          const query = url.searchParams.get("search") ?? "";
          return Response.json({
            servers: "playwright".includes(query) ? [{ server: mcpServer }] : [],
          });
        }),
      );
    },
  );

  it.effect(
    "pages through fuzzy matches without repeating registry requests and reuses the cache across letter case",
    () => {
      let requests = 0;
      return Effect.gen(function* () {
        const first = yield* searchExtensionCatalog({ kind: "mcp", query: "KUBERNETS" });
        expect(first.entries).toHaveLength(24);
        expect(first.nextCursor).toBeDefined();
        const requestCount = requests;
        const second = yield* searchExtensionCatalog({
          kind: "mcp",
          query: "kubernets",
          cursor: first.nextCursor!,
        });
        expect(second.entries).toHaveLength(16);
        expect(second.nextCursor).toBeUndefined();
        expect(requests).toBe(requestCount);
        expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(
          40,
        );
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        provideFetch((url) => {
          requests++;
          const query = url.searchParams.get("search") ?? "";
          return Response.json({
            servers: "kubernetes".includes(query)
              ? Array.from({ length: 40 }, (_, index) => ({
                  server: {
                    ...mcpServer,
                    name: "io.example/kubernetes-" + index,
                    title: "kubernetes-" + index,
                    packages: [
                      {
                        registryType: "npm",
                        identifier: "kubernetes-" + index,
                        transport: { type: "stdio" },
                      },
                    ],
                  },
                }))
              : [],
          });
        }),
      );
    },
  );

  it.effect("retains fuzzy matches when one registry is unavailable", () =>
    Effect.gen(function* () {
      const result = yield* searchExtensionCatalog({ kind: "mcp", query: "pythno" });
      expect(result.entries.some((entry) => entry.name === "Python")).toBe(true);
      expect(result.warnings?.join(" ")).toContain("GitHub");
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      provideFetch((url) => {
        const query = url.searchParams.get("search") ?? "";
        if (query === "pythno") return Response.json({ servers: [] });
        if (url.host === "api.mcp.github.com") return new Response(null, { status: 503 });
        return Response.json({
          servers: "python".includes(query)
            ? [
                {
                  server: {
                    ...mcpServer,
                    name: "io.example/python",
                    title: "Python",
                  },
                },
              ]
            : [],
        });
      }),
    ),
  );

  it.effect("expands an irrelevant registry response for a misspelled skill query", () =>
    Effect.gen(function* () {
      const result = yield* searchExtensionCatalog({ kind: "skill", query: "recat" });
      expect(
        result.entries.some(
          (entry) => entry.id === "vercel-labs/agent-skills/vercel-react-best-practices",
        ),
      ).toBe(true);
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      provideFetch(() =>
        Response.json({
          skills: [
            {
              id: "example/skills/bookkeeping",
              name: "bookkeeping",
              source: "example/skills",
              skillId: "bookkeeping",
            },
          ],
        }),
      ),
    ),
  );

  it.effect("finds misspelled skills when the registry's exact query is empty", () =>
    Effect.gen(function* () {
      const result = yield* searchExtensionCatalog({ kind: "skill", query: "PYTHNO" });
      expect(result.entries.some((entry) => entry.name === "python")).toBe(true);
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      provideFetch((url) => {
        const query = url.searchParams.get("q") ?? "";
        return Response.json({
          skills: "python".includes(query)
            ? [
                {
                  id: "example/skills/python",
                  source: "example/skills",
                  skillId: "python",
                  name: "python",
                },
              ]
            : [],
        });
      }),
    ),
  );
});
