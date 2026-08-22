import { describe, expect, it } from "@effect/vitest";

import {
  assistantTextFromCompletedItem,
  buildGeneralSubagentPrompt,
  generalSubagentApprovalAction,
} from "./GeneralSubagentCoordinator.ts";

describe("general subagent policy", () => {
  it("gives implementation agents a focused mutation-capable contract", () => {
    const prompt = buildGeneralSubagentPrompt({
      task: "Implement the parser fix, add focused tests, and run those tests.",
      parentThreadId: "parent-thread",
    });

    expect(prompt).toContain("GENERAL-PURPOSE SUBAGENT");
    expect(prompt).toContain("Implement the parser fix");
    expect(prompt).toContain("inspect, edit, and test");
    expect(prompt).toContain("same workspace");
    expect(prompt).toContain("Do not ask the user");
    expect(prompt).toContain("Do not spawn nested agents");
    expect(prompt).not.toContain("READ-ONLY REPOSITORY EXPLORATION");
    expect(prompt).not.toContain("Do not edit files");
  });

  it("never bypasses an approval-required parent session", () => {
    expect(generalSubagentApprovalAction("file_read_approval")).toBe("accept");
    expect(generalSubagentApprovalAction("tool_user_input")).toBe("fail-agent");
    expect(generalSubagentApprovalAction("file_change_approval")).toBe("decline");
    expect(generalSubagentApprovalAction("command_execution_approval")).toBe("decline");
  });

  it("recovers terminal assistant text from detail and structured provider data", () => {
    const eventBase = {
      type: "item.completed" as const,
      eventId: "event-assistant-completed",
      provider: "gemini",
      threadId: "thread-worker",
      createdAt: "2026-08-22T12:00:00.000Z",
      payload: {
        itemType: "assistant_message" as const,
        status: "completed" as const,
      },
    };

    expect(
      assistantTextFromCompletedItem({
        ...eventBase,
        payload: { ...eventBase.payload, detail: "Claude fallback" },
      }),
    ).toBe("Claude fallback");
    expect(
      assistantTextFromCompletedItem({
        ...eventBase,
        payload: { ...eventBase.payload, data: { text: "Gemini fallback" } },
      }),
    ).toBe("Gemini fallback");
  });
});
