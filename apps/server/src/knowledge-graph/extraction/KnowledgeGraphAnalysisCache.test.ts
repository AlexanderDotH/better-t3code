import { expect, it } from "@effect/vitest";

import {
  KNOWLEDGE_GRAPH_ANALYSIS_CACHE_BYTES,
  KnowledgeGraphAnalysisCache,
} from "./KnowledgeGraphAnalysisCache.ts";

const source = {
  path: "src/index.ts",
  content: 'import { Service } from "./service";\nexport const application = new Service();\n',
};

it("reuses unchanged analysis and invalidates it when content changes", () => {
  const cache = new KnowledgeGraphAnalysisCache();
  const first = cache.analyze(source);
  expect(cache.analyze({ ...source })).toBe(first);
  const changed = cache.analyze({
    ...source,
    content: 'import { Worker } from "./worker";\nexport class Application {}\n',
  });

  expect(first.imports).toMatchObject([{ specifier: "./service", line: 1 }]);
  expect(changed.imports).toMatchObject([{ specifier: "./worker", line: 1 }]);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
  expect(cache.stats).toMatchObject({ hits: 1, misses: 2, entries: 2 });
  expect(cache.stats.sizeBytes).toBeLessThanOrEqual(KNOWLEDGE_GRAPH_ANALYSIS_CACHE_BYTES);
});

it("keeps path-dependent source and manifest analysis separate", () => {
  const cache = new KnowledgeGraphAnalysisCache();
  expect(cache.analyze({ path: "same.ts", content: source.content }).symbols).toHaveLength(1);
  expect(cache.analyze({ path: "same.py", content: source.content }).symbols).toHaveLength(0);
  expect(cache.analyze({ path: "one/package.json", content: "{}" }).manifest?.label).toBe("one");
  expect(cache.analyze({ path: "two/package.json", content: "{}" }).manifest?.label).toBe("two");
});

it("evicts the least recently used analysis within its byte budget", () => {
  const probe = new KnowledgeGraphAnalysisCache();
  probe.analyze(source);
  const entryBytes = probe.stats.sizeBytes;
  const cache = new KnowledgeGraphAnalysisCache(entryBytes * 2);
  const first = cache.analyze(source);
  cache.analyze({ ...source, path: "src/other.ts" });
  expect(cache.analyze(source)).toBe(first);
  cache.analyze({ ...source, path: "src/third.ts" });

  expect(cache.stats.sizeBytes).toBeLessThanOrEqual(entryBytes * 2);
  expect(cache.stats.evictions).toBeGreaterThan(0);
  expect(cache.analyze(source)).toBe(first);
  const misses = cache.stats.misses;
  cache.analyze({ ...source, path: "src/other.ts" });
  expect(cache.stats.misses).toBe(misses + 1);
});

it("does not retain an analysis that exceeds the entire cache budget", () => {
  const cache = new KnowledgeGraphAnalysisCache(1);
  cache.analyze(source);
  cache.analyze(source);
  expect(cache.stats).toMatchObject({ hits: 0, misses: 2, entries: 0, sizeBytes: 0 });
});
