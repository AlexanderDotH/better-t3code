import { HarnessChatSessionId, type HarnessChatSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clearHarnessChatSelection,
  createDefaultHarnessChatSelection,
  getHarnessChatSelectionState,
  getSelectedUnresolvedHarnessChats,
  isHarnessChatSelected,
  selectAllHarnessChats,
  setHarnessChatSelected,
  toHarnessChatSelection,
} from "./HarnessChatSyncSettings.logic";

const sessionId = HarnessChatSessionId.make;

describe("harness chat sync selection", () => {
  it("starts with every matching chat selected and keeps exclusions across different pages", () => {
    const initial = createDefaultHarnessChatSelection();
    const firstPageSelection = setHarnessChatSelected(initial, sessionId("chat-2"), false);

    expect(isHarnessChatSelected(firstPageSelection, sessionId("chat-1"))).toBe(true);
    expect(isHarnessChatSelected(firstPageSelection, sessionId("chat-2"))).toBe(false);
    expect(isHarnessChatSelected(firstPageSelection, sessionId("chat-8"))).toBe(true);
    expect(
      getHarnessChatSelectionState(firstPageSelection, [sessionId("chat-7"), sessionId("chat-8")]),
    ).toBe(true);

    const secondPageSelection = setHarnessChatSelected(
      firstPageSelection,
      sessionId("chat-8"),
      false,
    );

    expect(isHarnessChatSelected(secondPageSelection, sessionId("chat-2"))).toBe(false);
    expect(isHarnessChatSelected(secondPageSelection, sessionId("chat-8"))).toBe(false);
    expect(
      getHarnessChatSelectionState(secondPageSelection, [sessionId("chat-1"), sessionId("chat-2")]),
    ).toBe("indeterminate");
  });

  it("clear all switches to explicit-only mode and select all restores all-matching mode", () => {
    const cleared = clearHarnessChatSelection();
    const oneSelected = setHarnessChatSelected(cleared, sessionId("chat-4"), true);

    expect(isHarnessChatSelected(cleared, sessionId("chat-4"))).toBe(false);
    expect(isHarnessChatSelected(oneSelected, sessionId("chat-4"))).toBe(true);
    expect(isHarnessChatSelected(oneSelected, sessionId("chat-5"))).toBe(false);
    expect(
      getHarnessChatSelectionState(oneSelected, [sessionId("chat-4"), sessionId("chat-5")]),
    ).toBe("indeterminate");

    const allSelected = selectAllHarnessChats();
    expect(isHarnessChatSelected(allSelected, sessionId("chat-4"))).toBe(true);
    expect(isHarnessChatSelected(allSelected, sessionId("chat-5"))).toBe(true);
  });

  it("does not duplicate ids while toggling the same chat repeatedly", () => {
    const excludedOnce = setHarnessChatSelected(
      createDefaultHarnessChatSelection(),
      sessionId("chat-3"),
      false,
    );
    const excludedTwice = setHarnessChatSelected(excludedOnce, sessionId("chat-3"), false);
    const includedAgain = setHarnessChatSelected(excludedTwice, sessionId("chat-3"), true);

    expect(excludedTwice).toEqual({ mode: "allMatching", excludedSessionIds: ["chat-3"] });
    expect(includedAgain).toEqual({ mode: "allMatching", excludedSessionIds: [] });
  });

  it("keeps search as a view filter while archived visibility defines all-matching sync scope", () => {
    const selection = setHarnessChatSelected(
      createDefaultHarnessChatSelection(),
      sessionId("chat-3"),
      false,
    );

    expect(toHarnessChatSelection(selection, { includeArchived: true })).toEqual({
      mode: "allMatching",
      query: "",
      includeArchived: true,
      excludedSessionIds: ["chat-3"],
    });
  });

  it("asks for project resolution only for selected chats with an unresolved cwd", () => {
    const chats = [
      { sessionId: sessionId("missing"), targetProject: { kind: "unresolved" } },
      { sessionId: sessionId("matched"), targetProject: { kind: "existing" } },
      { sessionId: sessionId("excluded"), targetProject: { kind: "unresolved" } },
    ] as unknown as ReadonlyArray<HarnessChatSummary>;
    const selection = setHarnessChatSelected(
      createDefaultHarnessChatSelection(),
      sessionId("excluded"),
      false,
    );

    expect(
      getSelectedUnresolvedHarnessChats(chats, selection).map((chat) => chat.sessionId),
    ).toEqual(["missing"]);
  });
});
