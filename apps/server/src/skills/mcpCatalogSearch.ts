import {
  SkillEngineError,
  type ExtensionCatalogSearchInput,
  type ExtensionCatalogSearchResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { catalogJson } from "./catalogHttp.ts";
import { normalizeCatalogQuery, rankCatalogEntries } from "./catalogSearch.ts";
import { searchFuzzyCatalog } from "./catalogFuzzySearch.ts";
import { mcpCatalogEntry, RegistryServer } from "./mcpCatalog.ts";

const isSkillEngineError = Schema.is(SkillEngineError);
const CatalogPage = Schema.Struct({
  servers: Schema.Array(
    Schema.Struct({
      server: Schema.Unknown,
      _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  metadata: Schema.optional(Schema.Struct({ nextCursor: Schema.optional(Schema.String) })),
});
const Cursor = Schema.Struct({
  official: Schema.NullOr(Schema.String),
  github: Schema.NullOr(Schema.String),
});
const decodePage = Schema.decodeUnknownEffect(CatalogPage);
const decodeCursor = Schema.decodeUnknownEffect(Schema.fromJsonString(Cursor));
const encodeCursor = Schema.encodeEffect(Schema.fromJsonString(Cursor));
const decodeServer = Schema.decodeUnknownResult(RegistryServer);
const decodeStatus = Schema.decodeUnknownResult(
  Schema.Struct({ status: Schema.optional(Schema.String) }),
);

const registries = [
  {
    key: "official",
    label: "Official MCP Registry",
    base: "https://registry.modelcontextprotocol.io",
  },
  { key: "github", label: "GitHub MCP Registry", base: "https://api.mcp.github.com" },
] as const;

const registryPage = Effect.fn("registryPage")(function* (
  base: string,
  query: string,
  cursor: string,
  timeout: "6 seconds" | "20 seconds" = "20 seconds",
) {
  const params = new URLSearchParams({ limit: "24", version: "latest" });
  if (query.trim()) params.set("search", query.trim());
  if (cursor) params.set("cursor", cursor);
  const raw = yield* catalogJson(base + "/v0.1/servers?" + params).pipe(
    Effect.timeout(timeout),
    Effect.mapError((cause) =>
      isSkillEngineError(cause)
        ? cause
        : new SkillEngineError({
            message: "The MCP registry lookup timed out. Try again.",
            cause,
          }),
    ),
  );
  return yield* decodePage(raw).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "The MCP registry returned an unsupported response.",
          cause,
        }),
    ),
  );
});

const searchMcpPage = Effect.fn("searchMcpPage")(function* (
  input: ExtensionCatalogSearchInput,
  options: { candidateSearch?: boolean } = {},
): Effect.fn.Return<ExtensionCatalogSearchResult, SkillEngineError, HttpClient.HttpClient> {
  // Accept an old official-registry cursor from clients with an in-flight search.
  const cursors = input.cursor
    ? input.cursor.startsWith("{")
      ? yield* decodeCursor(input.cursor).pipe(
          Effect.mapError(
            (cause) =>
              new SkillEngineError({ message: "Invalid catalog page. Start a new search.", cause }),
          ),
        )
      : { official: input.cursor, github: null }
    : { official: "", github: "" };
  const pages = yield* Effect.forEach(
    registries,
    (registry) =>
      cursors[registry.key] === null
        ? Effect.succeed({ registry, page: Result.succeed({ servers: [], metadata: undefined }) })
        : registryPage(
            registry.base,
            input.query,
            cursors[registry.key]!,
            options.candidateSearch ? "6 seconds" : "20 seconds",
          ).pipe(
            Effect.result,
            Effect.map((page) => ({ registry, page })),
          ),
    { concurrency: 2 },
  );
  const servers: (typeof RegistryServer.Type)[] = [];
  const identities = new Set<string>();
  const warnings: string[] = [];
  const next = { official: null as string | null, github: null as string | null };
  for (const { registry, page } of pages) {
    if (Result.isFailure(page)) {
      warnings.push(registry.label + ": " + page.failure.message);
      next[registry.key] = cursors[registry.key];
      continue;
    }
    next[registry.key] = page.success.metadata?.nextCursor ?? null;
    for (const entry of page.success.servers) {
      const status = decodeStatus(entry._meta?.["io.modelcontextprotocol.registry/official"]);
      if (Result.isSuccess(status) && status.success.status && status.success.status !== "active")
        continue;
      const decoded = decodeServer(entry.server);
      if (Result.isFailure(decoded)) continue;
      const server = decoded.success;
      const keys = [
        "name:" + server.name.toLowerCase(),
        ...(server.packages ?? []).map(
          (pkg) => pkg.registryType + ":" + pkg.identifier.toLowerCase(),
        ),
        ...(server.remotes ?? []).map((remote) => "remote:" + remote.url),
      ];
      if (keys.some((key) => identities.has(key))) continue;
      keys.forEach((key) => identities.add(key));
      servers.push(server);
    }
  }
  const successful = pages.some(({ page }) => Result.isSuccess(page));
  if (!successful) {
    const failed = pages.find(({ page }) => Result.isFailure(page))!;
    if (Result.isFailure(failed.page)) return yield* failed.page.failure;
  }
  const nextCursor =
    next.official !== null || next.github !== null
      ? yield* encodeCursor(next).pipe(
          Effect.mapError(
            (cause) =>
              new SkillEngineError({
                message: "Could not prepare the next catalog page.",
                cause,
              }),
          ),
        )
      : undefined;
  return {
    entries: servers.map(mcpCatalogEntry),
    ...(nextCursor ? { nextCursor } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
});

export const searchMcpCatalogs = Effect.fn("searchMcpCatalogs")(function* (
  input: ExtensionCatalogSearchInput,
): Effect.fn.Return<ExtensionCatalogSearchResult, SkillEngineError, HttpClient.HttpClient> {
  const query = normalizeCatalogQuery(input.query);
  const lookup = (part: string) =>
    searchMcpPage({ kind: "mcp", query: part }, { candidateSearch: true });
  if (input.cursor?.startsWith("fuzzy:")) {
    return yield* searchFuzzyCatalog({ ...input, query }, lookup);
  }
  const result = yield* searchMcpPage({ ...input, query });
  if (
    query.length >= 3 &&
    !input.cursor &&
    rankCatalogEntries(result.entries, query).length === 0
  ) {
    const fuzzy = yield* searchFuzzyCatalog({ ...input, query }, lookup);
    const warnings = [...new Set([...(result.warnings ?? []), ...(fuzzy.warnings ?? [])])];
    return { ...(fuzzy.entries.length ? fuzzy : result), ...(warnings.length ? { warnings } : {}) };
  }
  return {
    ...result,
    entries: rankCatalogEntries(result.entries, query, { includeUnmatched: true }),
  };
});
