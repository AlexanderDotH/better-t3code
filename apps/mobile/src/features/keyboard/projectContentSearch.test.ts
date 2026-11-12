import { describe, expect, it } from "vite-plus/test";
import { buildProjectContentSearchQuery } from "./projectContentSearch";

describe("repository content search queries", () => {
  it("preserves significant whitespace and passes all search switches", () => {
    expect(
      buildProjectContentSearchQuery({
        cwd: "/repo",
        query: "  const value = ",
        caseSensitive: true,
        wholeWord: true,
        useRegex: true,
      }),
    ).toMatchObject({
      cwd: "/repo",
      query: "  const value = ",
      caseSensitive: true,
      wholeWord: true,
      useRegex: true,
    });
  });
  it("does not send blank or oversized queries", () => {
    const base = { cwd: "/repo", caseSensitive: false, wholeWord: false, useRegex: false };
    expect(buildProjectContentSearchQuery({ ...base, query: " \n " })).toBeNull();
    expect(buildProjectContentSearchQuery({ ...base, query: "x".repeat(257) })).toBeNull();
    expect(buildProjectContentSearchQuery({ ...base, query: "a.*b" })?.useRegex).toBe(false);
  });
});
