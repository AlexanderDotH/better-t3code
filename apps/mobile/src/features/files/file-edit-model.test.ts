import { describe, expect, it } from "vite-plus/test";
import {
  createFileEdit,
  reconcileFileEdit,
  markdownTasks,
  toggleMarkdownTask,
} from "./file-edit-model";

describe("file edit reconciliation", () => {
  it("adopts external updates only when pristine or when they acknowledge the draft", () => {
    const initial = createFileEdit({ contents: "base", revision: "1" });
    expect(reconcileFileEdit(initial, { contents: "agent", revision: "2" }).draft).toBe("agent");
    const dirty = { ...initial, draft: "mine" };
    expect(reconcileFileEdit(dirty, { contents: "mine", revision: "2" }).conflict).toBe(false);
    const conflict = reconcileFileEdit(dirty, { contents: "agent", revision: "2" });
    expect(conflict).toMatchObject({
      base: "base",
      draft: "mine",
      revision: "1",
      remote: "agent",
      remoteRevision: "2",
      conflict: true,
    });
    expect(reconcileFileEdit(conflict, { contents: "agent", revision: "2" })).toBe(conflict);
    expect(reconcileFileEdit(conflict, { contents: "third version", revision: "3" })).toMatchObject(
      { draft: "mine", remoteRevision: "3", conflict: true },
    );
  });
  it("preserves draft after a concurrent deletion and needs a revision for saves", () => {
    const draft = { ...createFileEdit({ contents: "base", revision: "1" }), draft: "mine" };
    expect(reconcileFileEdit(draft, { contents: "", revision: undefined })).toMatchObject({
      draft: "mine",
      conflict: true,
      remoteRevision: null,
    });
    expect(createFileEdit({ contents: "legacy" }).revision).toBeNull();
  });
});

describe("writable Markdown tasks", () => {
  it("toggles only actual task markers and preserves CRLF and fenced examples", () => {
    const source = "- [ ] first\r\n```md\r\n- [ ] example\r\n```\r\n  * [x] second\r\n";
    const tasks = markdownTasks(source);
    expect(tasks.map((task) => [task.label, task.checked])).toEqual([
      ["first", false],
      ["second", true],
    ]);
    expect(toggleMarkdownTask(source, tasks[0]!.offset)).toBe(
      source.replace("[ ] first", "[x] first"),
    );
    expect(toggleMarkdownTask(source, 0)).toBe(source);
  });
});
