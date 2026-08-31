import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  WorkspaceContextInput,
  WorkspaceContextPathError,
  WorkspaceContextResult,
  WorkspaceContextSearchError,
  WorkspaceContextUnavailableError,
} from "./workspaceContext.ts";

const decodeInput = Schema.decodeUnknownSync(WorkspaceContextInput);

describe("WorkspaceContextInput", () => {
  it("accepts bounded batched queries and reads while trimming user text", () => {
    const decoded = decodeInput({
      queries: [{ text: "  WorkspaceContext  ", mode: "content" }],
      reads: [{ path: "  src/index.ts  ", startLine: 10, endLine: 25 }],
      contextLines: 4,
      maxResultsPerQuery: 12,
    });

    expect(decoded).toEqual({
      queries: [{ text: "WorkspaceContext", mode: "content" }],
      reads: [{ path: "src/index.ts", startLine: 10, endLine: 25 }],
      contextLines: 4,
      maxResultsPerQuery: 12,
    });
  });

  it("requires at least one query or read", () => {
    expect(() => decodeInput({})).toThrow();
    expect(() => decodeInput({ queries: [], reads: [] })).toThrow();
  });

  it("rejects requests beyond public count and scalar limits", () => {
    expect(() =>
      decodeInput({ queries: Array.from({ length: 9 }, (_, index) => ({ text: `q${index}` })) }),
    ).toThrow();
    expect(() =>
      decodeInput({ reads: Array.from({ length: 13 }, (_, index) => ({ path: `f${index}.ts` })) }),
    ).toThrow();
    expect(() => decodeInput({ queries: [{ text: "x".repeat(257) }] })).toThrow();
    expect(() => decodeInput({ reads: [{ path: "x".repeat(513) }] })).toThrow();
    expect(() => decodeInput({ queries: [{ text: "x" }], contextLines: 9 })).toThrow();
    expect(() => decodeInput({ queries: [{ text: "x" }], maxResultsPerQuery: 21 })).toThrow();
  });

  it("rejects non-positive and reversed read ranges but accepts ranges that will be clamped", () => {
    expect(() => decodeInput({ reads: [{ path: "a.ts", startLine: 0 }] })).toThrow();
    expect(() => decodeInput({ reads: [{ path: "a.ts", startLine: 10, endLine: 9 }] })).toThrow();
    expect(decodeInput({ reads: [{ path: "a.ts", startLine: 1, endLine: 900 }] })).toEqual({
      reads: [{ path: "a.ts", startLine: 1, endLine: 900 }],
    });
  });
});

describe("WorkspaceContextResult", () => {
  it("decodes successful and partial read results", () => {
    const decodeResult = Schema.decodeUnknownSync(WorkspaceContextResult);
    const decoded = decodeResult({
      queries: [
        {
          text: "context",
          mode: "auto",
          matches: [
            {
              path: "src/context.ts",
              kind: "content",
              matchLine: 4,
              lineStart: 2,
              lineEnd: 6,
              excerpt: "export const context = true;",
            },
          ],
          truncated: false,
          warnings: [],
        },
      ],
      reads: [
        {
          status: "ok",
          path: "src/context.ts",
          lineStart: 1,
          lineEnd: 4,
          text: "export const context = true;",
          truncated: false,
          revision: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        {
          status: "error",
          path: "missing.ts",
          error: "not_found",
          message: "File is missing.",
        },
      ],
      truncated: false,
      warnings: [],
    });

    expect(decoded.reads).toHaveLength(2);
  });
});

describe("workspace context errors", () => {
  it("exposes stable typed root, path, and search failures", () => {
    const unavailable = new WorkspaceContextUnavailableError({
      reason: "workspace_root_not_found",
    });
    const path = new WorkspaceContextPathError({
      relativePath: "../secret",
      reason: "path_outside_root",
    });
    const search = new WorkspaceContextSearchError({
      backend: "git",
      operation: "content-search",
      reason: "command_failed",
    });

    expect(unavailable.message).toBe("Workspace context is unavailable.");
    expect(path.message).toBe("Workspace context path is not readable.");
    expect(search.message).toBe("Workspace context search failed.");
  });
});
