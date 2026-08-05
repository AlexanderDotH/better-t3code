import { describe, expect, it } from "vitest";

import { buildSelectedPatch, parseGitNumstatZ, parseUnifiedChangePatch } from "./GitChangeDiff.ts";

describe("parseGitNumstatZ", () => {
  it("preserves odd paths and parses the two-path rename form", () => {
    const result = parseGitNumstatZ(
      "2\t1\tsrc/line\nname.ts\x00-\t-\tasset.bin\x004\t3\t\x00old\tname.ts\x00new\tname.ts\x00",
    );

    expect(result).toEqual([
      {
        path: "src/line\nname.ts",
        insertions: 2,
        deletions: 1,
        binary: false,
      },
      {
        path: "asset.bin",
        insertions: 0,
        deletions: 0,
        binary: true,
      },
      {
        path: "new\tname.ts",
        oldPath: "old\tname.ts",
        insertions: 4,
        deletions: 3,
        binary: false,
      },
    ]);
  });
});

describe("parseUnifiedChangePatch", () => {
  const rawPatch = [
    "diff --git a/example.txt b/example.txt",
    "index 4cb29ea..7f8f011 100644",
    "--- a/example.txt",
    "+++ b/example.txt",
    "@@ -1,3 +1,4 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "+four",
    "",
  ].join("\n");

  it("assigns deterministic file, hunk, and selectable line identifiers", () => {
    const first = parseUnifiedChangePatch({
      path: "example.txt",
      source: "unstaged",
      rawPatch,
      truncated: false,
    });
    const second = parseUnifiedChangePatch({
      path: "example.txt",
      source: "unstaged",
      rawPatch,
      truncated: false,
    });

    expect(first).toEqual(second);
    expect(first.patchId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hunks).toHaveLength(1);
    expect(first.hunks[0]?.lines.map((line) => [line.type, line.content, line.selectable])).toEqual(
      [
        ["context", "one", false],
        ["deletion", "two", true],
        ["addition", "TWO", true],
        ["context", "three", false],
        ["addition", "four", true],
      ],
    );
    expect(
      parseUnifiedChangePatch({
        path: "example.txt",
        source: "unstaged",
        rawPatch,
        truncated: false,
        identitySalt: "different binary identity",
      }).patchId,
    ).not.toBe(first.patchId);
  });

  it("builds a valid server-derived patch containing only selected replacement lines", () => {
    const parsed = parseUnifiedChangePatch({
      path: "example.txt",
      source: "unstaged",
      rawPatch,
      truncated: false,
    });
    const replacementIds = parsed.hunks[0]?.lines
      .filter((line) => line.content === "two" || line.content === "TWO")
      .map((line) => line.id);

    const selected = buildSelectedPatch(parsed, {
      kind: "lines",
      ids: replacementIds ?? [],
    });

    expect(selected).toContain("-two\n+TWO");
    expect(selected).not.toContain("+four");
    expect(selected).toContain("@@ -2,1 +2,1 @@");
  });

  it("includes complete selected hunks and rejects unknown selection identifiers", () => {
    const parsed = parseUnifiedChangePatch({
      path: "example.txt",
      source: "unstaged",
      rawPatch,
      truncated: false,
    });

    expect(buildSelectedPatch(parsed, { kind: "hunks", ids: [parsed.hunks[0]?.id ?? ""] })).toBe(
      rawPatch,
    );
    expect(() => buildSelectedPatch(parsed, { kind: "lines", ids: ["missing"] })).toThrow(
      /no longer exists/i,
    );
  });
});
