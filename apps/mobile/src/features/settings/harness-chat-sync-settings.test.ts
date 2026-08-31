import {
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyHarnessChatTarget,
  buildHarnessChatSyncRunInput,
  clearHarnessChatSelection,
  createHarnessChatSelection,
  harnessChatSelectedCount,
  harnessChatNeedsTargetResolution,
  harnessChatStatusState,
  harnessChatSyncOutcome,
  HARNESS_CHAT_SYNC_PAGE_SIZE,
  isHarnessChatSelected,
  selectAllHarnessChats,
  supportsHarnessChatSync,
  toggleHarnessChatSelection,
} from "./harness-chat-sync-settings";

describe("harness chat sync settings", () => {
  const sessionId = HarnessChatSessionId.make;
  const projectId = ProjectId.make;

  it("only enables the surface when the environment advertises version 1", () => {
    expect(supportsHarnessChatSync(undefined)).toBe(false);
    expect(supportsHarnessChatSync(0)).toBe(false);
    expect(supportsHarnessChatSync(1)).toBe(true);
    expect(supportsHarnessChatSync(2)).toBe(true);
  });

  it("keeps manual history review pages bounded", () => {
    expect(HARNESS_CHAT_SYNC_PAGE_SIZE).toBe(10);
  });

  it("selects every matching chat by default and keeps exclusions across pages", () => {
    const initial = createHarnessChatSelection();
    const withoutSecondPageChat = toggleHarnessChatSelection(initial, sessionId("session-42"));

    expect(isHarnessChatSelected(withoutSecondPageChat, sessionId("session-1"))).toBe(true);
    expect(isHarnessChatSelected(withoutSecondPageChat, sessionId("session-42"))).toBe(false);
    expect(harnessChatSelectedCount(withoutSecondPageChat, 80)).toBe(79);
  });

  it("clear all switches to an explicit selection until select all is restored", () => {
    const cleared = clearHarnessChatSelection();
    const oneSelected = toggleHarnessChatSelection(cleared, sessionId("session-7"));

    expect(isHarnessChatSelected(oneSelected, sessionId("session-7"))).toBe(true);
    expect(isHarnessChatSelected(oneSelected, sessionId("session-8"))).toBe(false);
    expect(harnessChatSelectedCount(oneSelected, 80)).toBe(1);
    expect(selectAllHarnessChats(oneSelected)).toEqual(createHarnessChatSelection());
  });

  it("does not subtract exclusions that are outside the current search results", () => {
    const firstSearch = toggleHarnessChatSelection(
      createHarnessChatSelection(),
      sessionId("old-result"),
    );

    expect(harnessChatSelectedCount(firstSearch, 1, [sessionId("current-result")])).toBe(1);
  });

  it("applies one project target to one missing workspace or every unresolved chat", () => {
    const targetedOne = applyHarnessChatTarget({
      current: new Map(),
      sessionId: sessionId("missing-1"),
      unresolvedSessionIds: [sessionId("missing-1"), sessionId("missing-2")],
      projectId: projectId("project-a"),
      applyToAll: false,
    });
    const targetedAll = applyHarnessChatTarget({
      current: targetedOne,
      sessionId: sessionId("missing-2"),
      unresolvedSessionIds: [
        sessionId("missing-1"),
        sessionId("missing-2"),
        sessionId("missing-3"),
      ],
      projectId: projectId("project-b"),
      applyToAll: true,
    });

    expect([...targetedOne]).toEqual([["missing-1", "project-a"]]);
    expect([...targetedAll]).toEqual([
      ["missing-1", "project-b"],
      ["missing-2", "project-b"],
      ["missing-3", "project-b"],
    ]);
  });

  it("requires an explicit target only for selected unresolved chats", () => {
    const unresolvedChat = {
      sessionId: sessionId("missing"),
      targetProject: { kind: "unresolved" as const, sourceCwd: "/missing" },
    };
    expect(
      harnessChatNeedsTargetResolution({
        chat: unresolvedChat,
        selection: createHarnessChatSelection(),
        targetResolutions: new Map(),
        unresolvedTargetProjectId: null,
      }),
    ).toBe(true);
    expect(
      harnessChatNeedsTargetResolution({
        chat: unresolvedChat,
        selection: createHarnessChatSelection(),
        targetResolutions: new Map([[sessionId("missing"), projectId("target")]]),
        unresolvedTargetProjectId: null,
      }),
    ).toBe(false);
  });

  it("models active, linked, changed, archived, and partial-result states", () => {
    expect(
      harnessChatStatusState({
        activity: "active",
        link: { threadId: ThreadId.make("linked-thread") },
        hasChanges: true,
        archived: true,
      }),
    ).toEqual({
      activeElsewhere: true,
      linkedThreadId: "linked-thread",
      changesAvailable: true,
      archived: true,
    });
    expect(
      harnessChatSyncOutcome({ syncedCount: 2, failedCount: 1, messagesImported: 14 }),
    ).toEqual({
      kind: "partial",
      syncedCount: 2,
      failedCount: 1,
      messagesImported: 14,
    });
  });

  it("builds the authoritative all-matching run after workspace resolution", () => {
    expect(
      buildHarnessChatSyncRunInput({
        sourceId: HarnessChatSyncSourceId.make("codex-history"),
        preferredInstanceId: ProviderInstanceId.make("codex-work"),
        selection: {
          mode: "allMatching",
          excludedSessionIds: new Set([sessionId("excluded")]),
        },
        query: "release",
        includeArchived: true,
        targetResolutions: new Map([
          [sessionId("missing-1"), projectId("project-a")],
          [sessionId("missing-2"), projectId("project-b")],
        ]),
        unresolvedTargetProjectId: projectId("project-fallback"),
      }),
    ).toEqual({
      sourceId: "codex-history",
      providerInstanceId: "codex-work",
      selection: {
        mode: "allMatching",
        query: "release",
        includeArchived: true,
        excludedSessionIds: ["excluded"],
      },
      targetResolutions: [
        { sessionId: "missing-1", projectId: "project-a" },
        { sessionId: "missing-2", projectId: "project-b" },
      ],
      unresolvedTargetProjectId: "project-fallback",
    });
  });

  it("builds an explicit manual selection without optional routing fields", () => {
    expect(
      buildHarnessChatSyncRunInput({
        sourceId: HarnessChatSyncSourceId.make("claude-history"),
        preferredInstanceId: null,
        selection: { mode: "only", sessionIds: new Set([sessionId("selected")]) },
        query: "ignored for explicit selections",
        includeArchived: false,
        targetResolutions: new Map(),
        unresolvedTargetProjectId: null,
      }),
    ).toEqual({
      sourceId: "claude-history",
      selection: { mode: "only", sessionIds: ["selected"] },
      targetResolutions: [],
    });
  });
});
