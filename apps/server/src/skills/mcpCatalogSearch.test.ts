import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import { searchExtensionCatalog } from "./extensionCatalog.ts";

const server = (name: string) => ({
  name,
  description: "Public browser tools",
  version: "1.0.0",
  packages: [
    { registryType: "npm", identifier: name.replace("/", "-"), transport: { type: "stdio" } },
  ],
});
const withFetch = (fetcher: (url: URL) => Response) =>
  Effect.provideService(
    FetchHttpClient.Fetch,
    Object.assign(
      async (request: Parameters<typeof fetch>[0]) => fetcher(new URL(String(request))),
      { preconnect: () => {} },
    ),
  );

describe("public MCP catalogs", () => {
  it.effect(
    "searches both registries without credentials and advances each independent cursor",
    () => {
      const requests: URL[] = [];
      return Effect.gen(function* () {
        const first = yield* searchExtensionCatalog({ kind: "mcp", query: "browser" });
        expect(first.entries.map((entry) => entry.source).toSorted()).toEqual([
          "example/github",
          "example/official",
        ]);
        expect(first.nextCursor).toBeDefined();
        requests.length = 0;
        const second = yield* searchExtensionCatalog({
          kind: "mcp",
          query: "browser",
          cursor: first.nextCursor!,
        });
        expect(second.entries).toHaveLength(2);
        expect(requests.map((url) => url.searchParams.get("cursor")).toSorted()).toEqual([
          "github-page-2",
          "official-page-2",
        ]);
        expect(second.nextCursor).toBeUndefined();
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        withFetch((url) => {
          requests.push(url);
          const github = url.host === "api.mcp.github.com";
          expect(["api.mcp.github.com", "registry.modelcontextprotocol.io"]).toContain(url.host);
          expect(url.searchParams.get("search")).toBe("browser");
          return Response.json({
            servers: [{ server: server(github ? "example/github" : "example/official") }],
            metadata: url.searchParams.has("cursor")
              ? {}
              : { nextCursor: github ? "github-page-2" : "official-page-2" },
          });
        }),
      );
    },
  );

  it.effect("keeps healthy registry results and reports the unavailable source", () =>
    Effect.gen(function* () {
      const result = yield* searchExtensionCatalog({ kind: "mcp", query: "browser" });
      expect(result.entries).toHaveLength(1);
      expect(result.warnings?.join(" ")).toContain("GitHub");
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      withFetch((url) =>
        url.host === "api.mcp.github.com"
          ? new Response(null, { status: 503 })
          : Response.json({ servers: [{ server: server("example/official") }] }),
      ),
    ),
  );

  it.effect("does not restart an exhausted catalog while another catalog has more results", () => {
    const requests: URL[] = [];
    return Effect.gen(function* () {
      const first = yield* searchExtensionCatalog({ kind: "mcp", query: "" });
      requests.length = 0;
      yield* searchExtensionCatalog({ kind: "mcp", query: "", cursor: first.nextCursor! });
      expect(requests.map((url) => url.host)).toEqual(["registry.modelcontextprotocol.io"]);
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      withFetch((url) => {
        requests.push(url);
        return Response.json({
          servers: [{ server: server(url.host) }],
          metadata: url.host === "api.mcp.github.com" ? {} : { nextCursor: "official-page-2" },
        });
      }),
    );
  });

  it.effect(
    "deduplicates the same package across registries and retains its official installation ID",
    () =>
      Effect.gen(function* () {
        const result = yield* searchExtensionCatalog({ kind: "mcp", query: "browser" });
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]?.source).toBe("io.example/browser");
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        withFetch((url) =>
          Response.json({
            servers: [
              {
                server: {
                  ...server(
                    url.host === "api.mcp.github.com" ? "example/browser" : "io.example/browser",
                  ),
                  packages: [
                    {
                      registryType: "npm",
                      identifier: "@example/browser",
                      transport: { type: "stdio" },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ),
  );
});
