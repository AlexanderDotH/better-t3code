import { describe, expect, it } from "vite-plus/test";

import {
  advanceChatTurnFoldRetention,
  CHAT_LIST_ANCHOR_OFFSET,
  createChatTurnFoldRetention,
  forgetRetainedChatTurn,
  resolveChatListAnchoredEndSpace,
} from "./chatList.js";

interface Row {
  readonly id: string;
  readonly anchorable: boolean;
}

const rows: ReadonlyArray<Row> = [
  { id: "first", anchorable: true },
  { id: "ignored", anchorable: false },
  { id: "latest", anchorable: true },
];

const getAnchorId = (row: Row) => (row.anchorable ? row.id : null);

describe("resolveChatListAnchoredEndSpace", () => {
  it("anchors only the first eligible row", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "first", getAnchorId)).toEqual({
      anchorIndex: 0,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("allows a surface to keep the anchor below its own header", () => {
    expect(
      resolveChatListAnchoredEndSpace(rows, "first", getAnchorId, {
        anchorOffset: 132,
      }),
    ).toEqual({
      anchorIndex: 0,
      anchorOffset: 132,
    });
  });

  it("does not reserve end space for later eligible rows", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "latest", getAnchorId)).toBeUndefined();
  });

  it("skips ineligible rows before the first anchor", () => {
    expect(resolveChatListAnchoredEndSpace(rows.slice(1), "latest", getAnchorId)).toEqual({
      anchorIndex: 1,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("ignores ineligible rows and missing anchors", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "ignored", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, "missing", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, null, getAnchorId)).toBeUndefined();
  });
});

describe("chat turn fold retention", () => {
  const running = { turnId: "turn-1", state: "running" } as const;
  const completed = { turnId: "turn-1", state: "completed" } as const;

  it("keeps a settling turn expanded while reading history and releases it at the live edge", () => {
    const initial = createChatTurnFoldRetention(running);
    const retained = advanceChatTurnFoldRetention(initial, completed, false);

    expect([...retained.retainedTurnIds]).toEqual(["turn-1"]);
    expect(advanceChatTurnFoldRetention(retained, completed, false)).toBe(retained);
    expect(advanceChatTurnFoldRetention(retained, completed, true).retainedTurnIds.size).toBe(0);
  });

  it("does not retain the turn for a reader following the end", () => {
    const initial = createChatTurnFoldRetention(running);
    expect(advanceChatTurnFoldRetention(initial, completed, true).retainedTurnIds.size).toBe(0);
  });

  it("keeps a replaced running turn visible and permits manual collapse", () => {
    const initial = createChatTurnFoldRetention(running);
    const retained = advanceChatTurnFoldRetention(
      initial,
      { turnId: "turn-2", state: "running" },
      false,
    );

    expect([...retained.retainedTurnIds]).toEqual(["turn-1"]);
    expect(forgetRetainedChatTurn(retained, "turn-1").retainedTurnIds.size).toBe(0);
  });
});
