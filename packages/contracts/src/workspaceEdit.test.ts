import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  WORKSPACE_EDIT_MAX_CHANGES,
  WORKSPACE_EDIT_MAX_EDITS,
  WORKSPACE_EDIT_MAX_PATH_LENGTH,
  WorkspaceEditError,
  WorkspaceEditInput,
  WorkspaceEditResult,
} from "./workspaceEdit.ts";

const decodeInput = Schema.decodeUnknownSync(WorkspaceEditInput);
const decodeResult = Schema.decodeUnknownSync(WorkspaceEditResult);
const isWorkspaceEditError = Schema.is(WorkspaceEditError);

describe("WorkspaceEditInput", () => {
  it("decodes ordered write, replace, splice, and delete changes", () => {
    expect(
      decodeInput({
        changes: [
          {
            path: "  src/example.ts  ",
            expected_revision:
              "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            edits: [
              {
                type: "replace",
                old_text: "const oldValue = 1;",
                new_text: "const newValue = 2;",
              },
              {
                type: "splice",
                range: { type: "lines", start: 2, end: 4 },
                content: "replacement\n",
              },
              {
                type: "splice",
                range: { type: "code_points", start: 0, end: 0 },
                content: "// inserted\n",
              },
              {
                type: "splice",
                range: { type: "start" },
                content: "// prepended\n",
              },
              {
                type: "splice",
                range: { type: "end" },
                content: "// appended\n",
              },
            ],
          },
          {
            path: "src/generated.ts",
            edits: [{ type: "write", mode: "upsert", content: "export {};\n" }],
          },
          {
            path: "src/obsolete.ts",
            edits: [{ type: "delete", if_missing: "ignore" }],
          },
        ],
      }),
    ).toEqual({
      changes: [
        {
          path: "src/example.ts",
          expected_revision:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          edits: [
            {
              type: "replace",
              old_text: "const oldValue = 1;",
              new_text: "const newValue = 2;",
            },
            {
              type: "splice",
              range: { type: "lines", start: 2, end: 4 },
              content: "replacement\n",
            },
            {
              type: "splice",
              range: { type: "code_points", start: 0, end: 0 },
              content: "// inserted\n",
            },
            {
              type: "splice",
              range: { type: "start" },
              content: "// prepended\n",
            },
            {
              type: "splice",
              range: { type: "end" },
              content: "// appended\n",
            },
          ],
        },
        {
          path: "src/generated.ts",
          edits: [{ type: "write", mode: "upsert", content: "export {};\n" }],
        },
        {
          path: "src/obsolete.ts",
          edits: [{ type: "delete", if_missing: "ignore" }],
        },
      ],
    });
  });

  it("normalizes common MCP write calls without risking an overwrite", () => {
    expect(
      decodeInput({
        changes: [
          {
            path: "explicit-create.ts",
            edits: [{ type: "write", mode: "create", text: "created" }],
          },
          {
            path: "default-create.ts",
            edits: [{ type: "write", text: "created" }],
          },
          {
            path: "explicit-overwrite.ts",
            edits: [{ type: "write", mode: "overwrite", text: "replaced" }],
          },
          {
            path: "canonical.ts",
            edits: [{ type: "write", content: "canonical" }],
          },
        ],
      }),
    ).toEqual({
      changes: [
        {
          path: "explicit-create.ts",
          edits: [{ type: "write", mode: "create", content: "created" }],
        },
        {
          path: "default-create.ts",
          edits: [{ type: "write", mode: "create", content: "created" }],
        },
        {
          path: "explicit-overwrite.ts",
          edits: [{ type: "write", mode: "overwrite", content: "replaced" }],
        },
        {
          path: "canonical.ts",
          edits: [{ type: "write", mode: "create", content: "canonical" }],
        },
      ],
    });
  });

  it("accepts all write modes and all-match replacement with an expected count", () => {
    expect(
      decodeInput({
        changes: [
          {
            path: "modes.ts",
            edits: [
              { type: "write", mode: "create", content: "one" },
              { type: "write", mode: "overwrite", content: "two" },
              {
                type: "replace",
                old_text: "two",
                new_text: "three",
                occurrence: "all",
                expected_count: 1,
              },
            ],
          },
        ],
      }).changes[0]?.edits,
    ).toHaveLength(3);
  });

  it("rejects empty changes, empty edit lists, duplicate paths, and count overflows", () => {
    expect(() => decodeInput({ changes: [] })).toThrow();
    expect(() => decodeInput({ changes: [{ path: "a.ts", edits: [] }] })).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          { path: "same.ts", edits: [{ type: "delete" }] },
          { path: " same.ts ", edits: [{ type: "delete" }] },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: Array.from({ length: WORKSPACE_EDIT_MAX_CHANGES + 1 }, (_, index) => ({
          path: `${index}.ts`,
          edits: [{ type: "delete" }],
        })),
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "many.ts",
            edits: Array.from({ length: WORKSPACE_EDIT_MAX_EDITS + 1 }, () => ({
              type: "delete",
            })),
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects malformed replacements, revisions, and reversed ranges", () => {
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            edits: [{ type: "replace", old_text: "", new_text: "x" }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            edits: [
              {
                type: "replace",
                old_text: "x",
                new_text: "y",
                occurrence: "one",
                expected_count: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            expected_revision: "not-a-revision",
            edits: [{ type: "delete" }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            edits: [
              {
                type: "splice",
                range: { type: "lines", start: 3, end: 2 },
                content: "",
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            edits: [
              {
                type: "splice",
                range: { type: "code_points", start: 2, end: 1 },
                content: "",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects aggregate edit overflow across files and oversized paths", () => {
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "a.ts",
            edits: Array.from({ length: 128 }, () => ({ type: "delete" })),
          },
          {
            path: "b.ts",
            edits: Array.from({ length: 129 }, () => ({ type: "delete" })),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        changes: [
          {
            path: "x".repeat(WORKSPACE_EDIT_MAX_PATH_LENGTH + 1),
            edits: [{ type: "delete" }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("workspace edit outcomes", () => {
  it("decodes compact results without file contents", () => {
    const decoded = decodeResult({
      changes: [
        {
          path: "src/example.ts",
          action: "updated",
          edit_count: 2,
          revision: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        { path: "src/obsolete.ts", action: "deleted", edit_count: 1 },
      ],
    });

    expect(decoded.changes).toHaveLength(2);
    expect(decoded.changes[0]).not.toHaveProperty("content");
  });

  it("exposes stable typed failures with bounded rollback uncertainty", () => {
    const error = new WorkspaceEditError({
      reason: "rollback_incomplete",
      path: "src/example.ts",
      change_index: 0,
      edit_index: 1,
      uncertain_paths: ["src/example.ts"],
    });

    expect(error.message).toBe("Workspace edit failed: rollback_incomplete (change 0, edit 1).");
    expect(isWorkspaceEditError(error)).toBe(true);
  });
});
