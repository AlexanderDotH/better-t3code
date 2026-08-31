import { describe, expect, it } from "vite-plus/test";

import { hasDurableClaudeSessionId, readClaudeResumeState } from "./ClaudeResumeState.ts";

describe("Claude resume state", () => {
  it("accepts mixed-version sessionId cursors but rejects synthetic thread ids", () => {
    expect(
      readClaudeResumeState({
        threadId: "thread-real",
        sessionId: "123e4567-e89b-42d3-a456-426614174000",
        resumeSessionAt: "2026-08-30T00:00:00.000Z",
        turnCount: 3,
      }),
    ).toEqual({
      threadId: "thread-real",
      resume: "123e4567-e89b-42d3-a456-426614174000",
      resumeSessionAt: "2026-08-30T00:00:00.000Z",
      turnCount: 3,
    });
    expect(
      readClaudeResumeState({
        threadId: "claude-thread-temporary",
        resume: "not-a-session-id",
        turnCount: -1,
      }),
    ).toEqual({});
  });

  it("does not let hook telemetry replace the durable SDK session id", () => {
    expect(hasDurableClaudeSessionId({ type: "system", subtype: "hook_started" } as never)).toBe(
      false,
    );
    expect(hasDurableClaudeSessionId({ type: "system", subtype: "hook_progress" } as never)).toBe(
      false,
    );
    expect(hasDurableClaudeSessionId({ type: "assistant" } as never)).toBe(true);
  });
});
