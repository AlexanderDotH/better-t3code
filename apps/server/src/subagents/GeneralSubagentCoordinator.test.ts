import { describe, expect, it } from "@effect/vitest";

import {
  assistantTextFromCompletedItem,
  buildGeneralSubagentPrompt,
  generalSubagentApprovalAction,
  parseGeneralSubagentFinalResult,
} from "./GeneralSubagentCoordinator.ts";

describe("general subagent policy", () => {
  it("gives implementation agents a focused mutation-capable contract", () => {
    const prompt = buildGeneralSubagentPrompt({
      task: "Implement the parser fix, add focused tests, and run those tests.",
      parentThreadId: "parent-thread",
      agentId: "general:parent-thread:worker-1",
    });

    expect(prompt).toContain("GENERAL-PURPOSE SUBAGENT");
    expect(prompt).toContain("Implement the parser fix");
    expect(prompt).toContain("inspect, edit, and test");
    expect(prompt).toContain("same workspace");
    expect(prompt).toContain("Do not ask the user");
    expect(prompt).toContain("Do not spawn nested agents");
    expect(prompt).toContain('"changesOrFindings"');
    expect(prompt).toContain('"verification"');
    expect(prompt).toContain('"risksOrBlockers"');
    expect(prompt).toContain('"transcriptRef": "subagent:general:parent-thread:worker-1"');
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

  it("parses a valid final result and falls back to the entire malformed message", () => {
    const agentId = "general:parent-thread:worker-1";
    const valid = {
      outcome: "Implemented the parser fix.",
      changesOrFindings: [
        { path: "apps/server/src/parser.ts", details: "Handled the missing delimiter." },
      ],
      verification: [{ command: "vp test run parser.test.ts", result: "1 test passed" }],
      risksOrBlockers: [],
      transcriptRef: `subagent:${agentId}`,
    };

    expect(parseGeneralSubagentFinalResult(JSON.stringify(valid), agentId)).toEqual(valid);

    const malformed = "Final result without the required sections.\nSecond line is retained.";
    expect(parseGeneralSubagentFinalResult(malformed, agentId)).toEqual({
      outcome: malformed,
      changesOrFindings: [],
      verification: [],
      risksOrBlockers: [],
      transcriptRef: `subagent:${agentId}`,
    });

    const extraSection = JSON.stringify({ ...valid, commentary: "not part of the contract" });
    expect(parseGeneralSubagentFinalResult(extraSection, agentId)).toEqual({
      outcome: extraSection,
      changesOrFindings: [],
      verification: [],
      risksOrBlockers: [],
      transcriptRef: `subagent:${agentId}`,
    });
  });
});
