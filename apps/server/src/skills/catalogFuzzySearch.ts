import {
  SkillEngineError,
  type ExtensionCatalogEntry,
  type ExtensionCatalogSearchInput,
  type ExtensionCatalogSearchResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import {
  catalogCandidateQueries,
  normalizeCatalogQuery,
  rankCatalogEntries,
} from "./catalogSearch.ts";

const isSkillEngineError = Schema.is(SkillEngineError);
const PAGE_SIZE = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_SEARCHES = 32;
const searches = new Map<string, { expiresAt: number; result: ExtensionCatalogSearchResult }>();

export const searchFuzzyCatalog = Effect.fn("searchFuzzyCatalog")(function* (
  input: ExtensionCatalogSearchInput,
  lookup: (
    query: string,
  ) => Effect.Effect<ExtensionCatalogSearchResult, SkillEngineError, HttpClient.HttpClient>,
  suggestions: readonly ExtensionCatalogEntry[] = [],
) {
  const query = normalizeCatalogQuery(input.query);
  const key = input.kind + ":" + query;
  const now = yield* Clock.currentTimeMillis;
  const cached = searches.get(key);
  let result = cached && cached.expiresAt > now ? cached.result : undefined;
  if (!result) {
    const pages = yield* Effect.forEach(
      catalogCandidateQueries(query),
      (part) =>
        lookup(part).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError((cause) =>
            isSkillEngineError(cause)
              ? cause
              : new SkillEngineError({
                  message: "Could not complete the spelling-tolerant catalog search.",
                  cause,
                }),
          ),
          Effect.result,
        ),
      { concurrency: 3 },
    );
    const entries = new Map(suggestions.map((entry) => [entry.id, entry]));
    const warnings = new Set<string>();
    for (const page of pages) {
      if (Result.isFailure(page)) {
        warnings.add(page.failure.message);
        continue;
      }
      for (const entry of page.success.entries) entries.set(entry.id, entry);
      for (const warning of page.success.warnings ?? []) warnings.add(warning);
    }
    result = {
      entries: rankCatalogEntries([...entries.values()], query),
      ...(warnings.size ? { warnings: [...warnings] } : {}),
    };
    if (searches.size >= MAX_CACHED_SEARCHES) {
      const oldest = searches.keys().next().value;
      if (oldest !== undefined) searches.delete(oldest);
    }
    searches.set(key, { expiresAt: now + CACHE_TTL_MS, result });
  }
  const offset = input.cursor?.startsWith("fuzzy:") ? Number(input.cursor.slice(6)) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return yield* new SkillEngineError({ message: "Invalid catalog page. Start a new search." });
  }
  return {
    entries: result.entries.slice(offset, offset + PAGE_SIZE),
    ...(offset + PAGE_SIZE < result.entries.length
      ? { nextCursor: "fuzzy:" + (offset + PAGE_SIZE) }
      : {}),
    ...(result.warnings ? { warnings: result.warnings } : {}),
  } satisfies ExtensionCatalogSearchResult;
});
