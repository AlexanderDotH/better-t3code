import { describe, expect, it } from "vite-plus/test";

import { applyWorkspaceTextEdits } from "./WorkspaceTextEdit.ts";

describe("applyWorkspaceTextEdits", () => {
  it("applies ordered writes, replacements, line splices, and deletes", () => {
    expect(
      applyWorkspaceTextEdits(undefined, [
        { type: "write", mode: "create", content: "one\ntwo\nthree\n" },
        {
          type: "replace",
          old_text: "one",
          new_text: "ONE",
          occurrence: "one",
        },
        {
          type: "splice",
          range: { type: "lines", start: 2, end: 2 },
          content: "TWO\n",
        },
      ]),
    ).toEqual({ ok: true, contents: "ONE\nTWO\nthree\n", editCount: 3 });

    expect(
      applyWorkspaceTextEdits("obsolete\n", [{ type: "delete", if_missing: "error" }]),
    ).toEqual({ ok: true, contents: undefined, editCount: 1 });
  });

  it("uses Unicode code-point offsets and supports prepend and append", () => {
    expect(
      applyWorkspaceTextEdits("a😀c", [
        {
          type: "splice",
          range: { type: "code_points", start: 1, end: 2 },
          content: "B",
        },
        { type: "splice", range: { type: "start" }, content: "<" },
        { type: "splice", range: { type: "end" }, content: ">" },
      ]),
    ).toEqual({ ok: true, contents: "<aBc>", editCount: 3 });
  });

  it("preserves CRLF outside an inclusive line range and handles a final newline", () => {
    expect(
      applyWorkspaceTextEdits("one\r\ntwo\r\nthree\r\n", [
        {
          type: "splice",
          range: { type: "lines", start: 2, end: 2 },
          content: "TWO\r\n",
        },
      ]),
    ).toEqual({ ok: true, contents: "one\r\nTWO\r\nthree\r\n", editCount: 1 });
  });

  it("rejects missing, ambiguous, count-mismatched, and invalid ranges deterministically", () => {
    expect(
      applyWorkspaceTextEdits("x x", [
        { type: "replace", old_text: "x", new_text: "y", occurrence: "one" },
      ]),
    ).toEqual({ ok: false, reason: "ambiguous_match", editIndex: 0 });
    expect(
      applyWorkspaceTextEdits("x x", [
        {
          type: "replace",
          old_text: "x",
          new_text: "y",
          occurrence: "all",
          expected_count: 3,
        },
      ]),
    ).toEqual({ ok: false, reason: "expected_count_mismatch", editIndex: 0 });
    expect(
      applyWorkspaceTextEdits("one\n", [
        {
          type: "splice",
          range: { type: "lines", start: 2, end: 2 },
          content: "two\n",
        },
      ]),
    ).toEqual({ ok: false, reason: "invalid_range", editIndex: 0 });
    expect(
      applyWorkspaceTextEdits(undefined, [
        { type: "replace", old_text: "x", new_text: "y", occurrence: "one" },
      ]),
    ).toEqual({ ok: false, reason: "not_found", editIndex: 0 });
  });
});
