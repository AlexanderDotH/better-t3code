import { describe, expect, it } from "vite-plus/test";
import type { ExtensionCatalogEntry } from "@t3tools/contracts";
import {
  catalogCandidateQueries,
  levenshteinDistance,
  normalizeCatalogQuery,
  rankCatalogEntries,
} from "./catalogSearch.ts";

function entry(name: string, description = ""): ExtensionCatalogEntry {
  return {
    id: "example/skills/" + name,
    kind: "skill",
    name,
    description,
    source: "example/skills",
    sourceUrl: "https://github.com/example/skills",
    connections: [],
  };
}

describe("catalog search", () => {
  it("normalizes case and whitespace without changing repository punctuation", () => {
    expect(normalizeCatalogQuery("  ReAcT   Native  ")).toBe("react native");
    expect(normalizeCatalogQuery("OWNER/Repository")).toBe("owner/repository");
  });

  it("calculates Levenshtein distance for insertion, deletion and substitution", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("react", "recat")).toBe(2);
    expect(levenshteinDistance("mcp", "mcp")).toBe(0);
    expect(levenshteinDistance("abcdef", "uvwxyz", 2)).toBeGreaterThan(2);
  });

  it("ranks exact names ahead of prefixes, substrings, typos and description matches", () => {
    const entries = [
      entry("unrelated", "Use React for interfaces"),
      entry("recat"),
      entry("my-react-tools"),
      entry("react-native"),
      entry("React"),
    ];
    expect(rankCatalogEntries(entries, "rEaCt").map((item) => item.name)).toEqual([
      "React",
      "react-native",
      "my-react-tools",
      "recat",
      "unrelated",
    ]);
  });

  it("tolerates misspellings and matches multiple words across separators", () => {
    expect(
      rankCatalogEntries([entry("playwright"), entry("postgres")], "Playwrigth").map(
        (item) => item.name,
      ),
    ).toEqual(["playwright"]);
    expect(
      rankCatalogEntries([entry("react-best-practices"), entry("python")], "RECAT practices").map(
        (item) => item.name,
      ),
    ).toEqual(["react-best-practices"]);
    expect(rankCatalogEntries([entry("code-review")], "CODE REVIEW")).toHaveLength(1);
    expect(rankCatalogEntries([entry("react")], "xy")).toEqual([]);
  });

  it("preserves upstream relevance order for ties and semantic matches when requested", () => {
    const entries = [entry("react-b"), entry("react-a"), entry("unrelated")];
    expect(
      rankCatalogEntries(entries, "react", { includeUnmatched: true }).map((item) => item.name),
    ).toEqual(["react-b", "react-a", "unrelated"]);
  });

  it("does not match opaque MCP installation identifiers", () => {
    expect(
      rankCatalogEntries(
        [{ ...entry("postgres"), kind: "mcp", id: "mcp-abcdef", source: "io.example/postgres" }],
        "abc",
      ),
    ).toEqual([]);
  });

  it("uses a small set of distinct fragments for typo candidate retrieval", () => {
    const queries = catalogCandidateQueries("PLAYWRIGTH");
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries.every((query) => query.length >= 2 && query === query.toLowerCase())).toBe(true);
    expect(queries.some((query) => "playwright".includes(query))).toBe(true);
    expect(catalogCandidateQueries("A")).toEqual([]);
  });
});
