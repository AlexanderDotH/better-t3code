import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  WORKSPACE_CONTEXT_MAX_CONTEXT_LINES,
  WORKSPACE_CONTEXT_MAX_PATH_LENGTH,
  WORKSPACE_CONTEXT_MAX_QUERIES,
  WORKSPACE_CONTEXT_MAX_QUERY_LENGTH,
  WORKSPACE_CONTEXT_MAX_READS,
  WORKSPACE_CONTEXT_MAX_RESULTS_PER_QUERY,
  WorkspaceContextInput,
  WorkspaceContextPathError,
  WorkspaceContextResult,
  WorkspaceContextSearchError,
  WorkspaceContextUnavailableError,
  WorkspaceFindInput,
  WorkspaceReadInput,
} from "./workspaceContext.ts";

const decodeInput = Schema.decodeUnknownSync(WorkspaceContextInput);
const decodeFind = Schema.decodeUnknownSync(WorkspaceFindInput);
const decodeRead = Schema.decodeUnknownSync(WorkspaceReadInput);

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

  it("requires at least one operation in mixed and focused inputs", () => {
    expect(() => decodeInput({})).toThrow();
    expect(() => decodeInput({ queries: [], reads: [] })).toThrow();
    expect(() => decodeFind({ queries: [] })).toThrow();
    expect(() => decodeRead({ reads: [] })).toThrow();

    expect(decodeFind({ queries: [{ text: "  tools.ts  ", mode: "path" }] })).toEqual({
      queries: [{ text: "tools.ts", mode: "path" }],
    });
    expect(decodeRead({ reads: [{ path: "  src/index.ts  ", startLine: 2 }] })).toEqual({
      reads: [{ path: "src/index.ts", startLine: 2 }],
    });
  });

  it("accepts common large batches and clampable preferences within hard input limits", () => {
    expect(
      decodeFind({
        queries: Array.from({ length: 14 }, (_, index) => ({ text: `q${index}` })),
        contextLines: WORKSPACE_CONTEXT_MAX_CONTEXT_LINES + 1,
        maxResultsPerQuery: WORKSPACE_CONTEXT_MAX_RESULTS_PER_QUERY + 30,
      }).queries,
    ).toHaveLength(14);

    expect(() =>
      decodeInput({
        queries: Array.from({ length: WORKSPACE_CONTEXT_MAX_QUERIES + 1 }, (_, index) => ({
          text: `q${index}`,
        })),
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        reads: Array.from({ length: WORKSPACE_CONTEXT_MAX_READS + 1 }, (_, index) => ({
          path: `f${index}.ts`,
        })),
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        queries: [{ text: "x".repeat(WORKSPACE_CONTEXT_MAX_QUERY_LENGTH + 1) }],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        reads: [{ path: "x".repeat(WORKSPACE_CONTEXT_MAX_PATH_LENGTH + 1) }],
      }),
    ).toThrow();
    expect(() => decodeInput({ queries: [{ text: "x" }], contextLines: -1 })).toThrow();
    expect(() => decodeInput({ queries: [{ text: "x" }], maxResultsPerQuery: 0 })).toThrow();
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
