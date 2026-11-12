import { describe, expect, it } from "vite-plus/test";
import {
  createThreadFindIndex,
  findMatchLineOffset,
  findTextMatches,
  nextFindMatchIndex,
  reconcileFindMatchIndex,
} from "./threadFind";
import { MessageId, ThreadId } from "@t3tools/contracts";
import type { ThreadFeedEntry } from "./threadActivity";

describe("thread find", () => {
  it("matches literal text case-insensitively without changing source offsets", () => {
    expect(findTextMatches("İgnore [a] and [A] 🐈", "[a]")).toEqual([
      { start: 7, end: 10 },
      { start: 15, end: 18 },
    ]);
    expect(findTextMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(findTextMatches("a", "")).toEqual([]);
    expect(findTextMatches("A\nB", "A\nB")).toEqual([{ start: 0, end: 3 }]);
  });

  it("wraps navigation and keeps the selected occurrence when older history is prepended", () => {
    expect(nextFindMatchIndex(0, -1, 3)).toBe(2);
    expect(nextFindMatchIndex(2, 1, 3)).toBe(0);
    expect(nextFindMatchIndex(-1, -1, 3)).toBe(2);
    expect(nextFindMatchIndex(0, 1, 0)).toBe(-1);
    const selected = { entryId: "new", start: 2, end: 5 };
    expect(
      reconcileFindMatchIndex([{ entryId: "old", start: 0, end: 3 }, selected], selected),
    ).toBe(1);
    expect(reconcileFindMatchIndex([], selected)).toBe(-1);
    expect(
      findMatchLineOffset("first wrapped line needle", 19, [
        { text: "first wrapped", y: 0 },
        { text: "line needle", y: 24 },
      ]),
    ).toBe(24);
    expect(
      findMatchLineOffset("needle then needle", 12, [
        { text: "needle then", y: 0 },
        { text: "needle", y: 24 },
      ]),
    ).toBe(24);
  });

  it("searches rendered text across loaded history without matching hidden link destinations", () => {
    const entry = (id: string, text: string): ThreadFeedEntry => ({
      type: "message",
      id,
      createdAt: "2026-01-01T00:00:00Z",
      message: {
        id: MessageId.make(id),
        role: "assistant",
        text,
        attachments: [],
        runId: null,
        streaming: false,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread"),
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
    const recent = entry("recent", "**Needle** [label](https://example.com/hidden)");
    const earlier = entry("earlier", "Older needle");
    const index = createThreadFindIndex();
    const selected = index([recent], "needle")[0]!;
    const withHistory = index([earlier, recent], "needle");
    expect(withHistory.map((match) => match.entryId)).toEqual(["earlier", "recent"]);
    expect(reconcileFindMatchIndex(withHistory, selected)).toBe(1);
    expect(index([recent], "hidden")).toEqual([]);
    expect(index.text(recent)).toBe("Needle label");
    expect(
      index(
        [
          entry(
            "folded",
            "<details><summary>Notes</summary>\n\nA hidden **needle**.\n\n</details>",
          ),
        ],
        "needle",
      ),
    ).toMatchObject([{ entryId: "folded" }]);
  });
});
