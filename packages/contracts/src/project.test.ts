import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ProjectReadFileResult,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteConflictError,
  ProjectWriteFileInput,
  ProjectWriteFileError,
} from "./project.ts";

const decodeProjectReadFileResult = Schema.decodeUnknownSync(ProjectReadFileResult);
const decodeProjectWriteFileInput = Schema.decodeUnknownSync(ProjectWriteFileInput);
const decodeProjectWriteConflict = Schema.decodeUnknownSync(ProjectWriteConflictError);

describe("project RPC errors", () => {
  it("derives stable messages from structured request context while retaining causes", () => {
    const cause = new Error("sensitive platform detail");
    const searchError = new ProjectSearchEntriesError({
      cwd: "/workspace",
      queryLength: "authorization: Bearer secret-token".length,
      limit: 20,
      failure: "search_index_search_failed",
      normalizedCwd: "/workspace",
      detail: "index unavailable",
      cause,
    });
    const readError = new ProjectReadFileError({
      cwd: "/workspace",
      relativePath: "src/index.ts",
      failure: "operation_failed",
      operation: "read",
      operationPath: "/workspace/src/index.ts",
      resolvedPath: "/workspace/src/index.ts",
      cause,
    });

    expect(searchError.message).toBe("Failed to search workspace entries in '/workspace'.");
    expect(searchError.message).not.toContain(cause.message);
    expect(searchError.normalizedCwd).toBe("/workspace");
    expect(searchError.queryLength).toBe("authorization: Bearer secret-token".length);
    expect(searchError).not.toHaveProperty("query");
    expect(searchError.message).not.toMatch(/Bearer|secret-token/);
    expect(searchError.cause).toBe(cause);
    expect(readError.message).toBe("Failed to read workspace file 'src/index.ts' in '/workspace'.");
    expect(readError.message).not.toContain(cause.message);
    expect(readError.cause).toBe(cause);
  });

  it("decodes legacy message-only errors during rolling upgrades", () => {
    const decodeSearchError = Schema.decodeUnknownSync(ProjectSearchEntriesError);
    const decodeWriteError = Schema.decodeUnknownSync(ProjectWriteFileError);

    const searchError = decodeSearchError({
      _tag: "ProjectSearchEntriesError",
      message: "Legacy project search failure.",
      query: "legacy sensitive query",
    });
    const writeError = decodeWriteError({
      _tag: "ProjectWriteFileError",
      message: "Legacy project write failure.",
    });

    expect(searchError.message).toBe("Legacy project search failure.");
    expect(searchError.cwd).toBeUndefined();
    expect(searchError.queryLength).toBeUndefined();
    expect(searchError).not.toHaveProperty("query");
    expect(searchError.failure).toBeUndefined();
    expect(writeError.message).toBe("Legacy project write failure.");
    expect(writeError.relativePath).toBeUndefined();
    expect(writeError.failure).toBeUndefined();
  });

  it("keeps legacy file reads and writes decodable while carrying revisions when available", () => {
    expect(
      decodeProjectReadFileResult({
        relativePath: "src/index.ts",
        contents: "export {};",
        byteLength: 10,
        truncated: false,
      }).revision,
    ).toBeUndefined();
    expect(
      decodeProjectWriteFileInput({
        cwd: "/workspace",
        relativePath: "src/index.ts",
        contents: "export {};",
        expectedRevision: "sha256:012345",
      }).expectedRevision,
    ).toBe("sha256:012345");
  });

  it("decodes a structured compare-and-swap conflict", () => {
    const conflict = decodeProjectWriteConflict({
      _tag: "ProjectWriteConflictError",
      cwd: "/workspace",
      relativePath: "src/index.ts",
      expectedRevision: "sha256:old",
      actualRevision: "sha256:new",
      message: "The file changed before it could be saved.",
    });

    expect(conflict.expectedRevision).toBe("sha256:old");
    expect(conflict.actualRevision).toBe("sha256:new");
  });
});
