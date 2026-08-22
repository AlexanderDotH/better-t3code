import { describe, expect, it } from "vite-plus/test";
import {
  EventId,
  ProviderInstanceId,
  ProviderDriverKind,
  SubagentId,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";

import {
  CLOSED_MOBILE_SUBAGENT_HISTORY_STATE,
  deriveMobileSubagentGroups,
  mobileSubagentHistoryIsVisible,
  mobileSubagentTranscriptEntryKey,
  mobileSubagentDisplayName,
  mobileSubagentTranscriptMetadata,
  nextRecentSubagentExpiryDelayMs,
  reduceMobileSubagentHistory,
} from "./subagent-presentation";

function agent(
  input: Partial<OrchestrationSubagentSummary> &
    Pick<OrchestrationSubagentSummary, "id" | "status" | "updatedAt">,
): OrchestrationSubagentSummary {
  return {
    origin: "provider-native",
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerDriver: ProviderDriverKind.make("codex"),
    providerThreadId: `provider-${input.id}`,
    parentId: null,
    path: null,
    name: String(input.id),
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: input.updatedAt,
    completedAt: null,
    ...input,
  };
}

describe("mobile subagent presentation", () => {
  it("keeps active agents visible and completed agents recent for thirty seconds", () => {
    const now = Date.parse("2026-08-13T10:00:30.000Z");
    const running = agent({
      id: SubagentId.make("running"),
      status: "running",
      updatedAt: "2026-08-13T10:00:20.000Z",
    });
    const recent = agent({
      id: SubagentId.make("recent"),
      status: "completed",
      completedAt: "2026-08-13T10:00:05.000Z",
      updatedAt: "2026-08-13T10:00:05.000Z",
    });
    const old = agent({
      id: SubagentId.make("old"),
      status: "error",
      completedAt: "2026-08-13T09:59:00.000Z",
      updatedAt: "2026-08-13T09:59:00.000Z",
    });

    expect(deriveMobileSubagentGroups([old, recent, running], now)).toEqual({
      active: [running],
      recent: [recent],
      history: [recent, old],
    });
    expect(nextRecentSubagentExpiryDelayMs([recent], now)).toBe(5_001);
  });

  it("sorts agents without ES2023 array methods unavailable in Hermes", () => {
    const earlier = agent({
      id: SubagentId.make("earlier"),
      status: "running",
      updatedAt: "2026-08-13T10:00:00.000Z",
    });
    const later = agent({
      id: SubagentId.make("later"),
      status: "running",
      updatedAt: "2026-08-13T10:00:01.000Z",
    });
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toSorted");

    try {
      expect(deriveMobileSubagentGroups([later, earlier]).active).toEqual([earlier, later]);
    } finally {
      if (descriptor !== undefined) {
        Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
      }
    }
  });

  it("prefers a nickname and falls back to the provider name", () => {
    const base = agent({
      id: SubagentId.make("agent-1"),
      status: "running",
      updatedAt: "2026-08-13T10:00:00.000Z",
      name: "Contracts",
    });
    expect(mobileSubagentDisplayName(base)).toBe("Contracts");
    expect(mobileSubagentDisplayName({ ...base, nickname: "Idefix" })).toBe("Idefix");
  });

  it("shows the selected provider and model traits for T3-managed agents", () => {
    const managed = agent({
      id: SubagentId.make("general:security-review"),
      origin: "t3-managed",
      providerInstanceId: ProviderInstanceId.make("codex-security"),
      providerDriver: ProviderDriverKind.make("codex"),
      status: "running",
      model: "gpt-daybreak-blue-latest",
      reasoningEffort: "max",
      updatedAt: "2026-08-22T12:00:00.000Z",
    });

    expect(mobileSubagentTranscriptMetadata(managed)).toEqual([
      "running",
      "codex-security",
      "gpt-daybreak-blue-latest",
      "max",
    ]);
  });

  it("releases the selected transcript whenever history closes", () => {
    const subagentId = SubagentId.make("agent-1");
    const opened = reduceMobileSubagentHistory(CLOSED_MOBILE_SUBAGENT_HISTORY_STATE, {
      type: "open",
      subagentId,
    });

    expect(opened).toEqual({ visible: true, selectedSubagentId: subagentId });
    expect(reduceMobileSubagentHistory(opened, { type: "close" })).toBe(
      CLOSED_MOBILE_SUBAGENT_HISTORY_STATE,
    );
  });

  it("hides agent history as soon as its chat route loses focus", () => {
    const opened = reduceMobileSubagentHistory(CLOSED_MOBILE_SUBAGENT_HISTORY_STATE, {
      type: "open",
      subagentId: SubagentId.make("agent-1"),
    });

    expect(mobileSubagentHistoryIsVisible(opened, true)).toBe(true);
    expect(mobileSubagentHistoryIsVisible(opened, false)).toBe(false);
  });

  it("namespaces transcript row keys by event type", () => {
    const sharedId = EventId.make("shared-id");
    expect(
      mobileSubagentTranscriptEntryKey({
        type: "activity",
        id: sharedId,
        createdAt: "2026-08-13T10:00:00.000Z",
        activity: {
          id: sharedId,
          kind: "tool.completed",
          tone: "tool",
          summary: "Done",
          payload: null,
          turnId: null,
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      }),
    ).toBe("activity:shared-id");
  });
});
