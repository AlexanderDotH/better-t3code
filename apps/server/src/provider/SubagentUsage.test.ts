import { expect, it } from "vite-plus/test";
import { readClaudeSubagentUsage } from "./SubagentUsage.ts";

it("preserves counters from native task progress and completion frames", () => {
  expect(
    readClaudeSubagentUsage({
      subtype: "task_progress",
      usage: { total_tokens: 15432, tool_uses: 18, duration_ms: 12345 },
    }),
  ).toEqual({ totalTokens: 15432, toolUses: 18, durationMs: 12345 });
  expect(readClaudeSubagentUsage({ subtype: "task_notification" })).toBeUndefined();
  expect(
    readClaudeSubagentUsage({ usage: { total_tokens: -4, tool_uses: 2.5, duration_ms: 3 } }),
  ).toEqual({ totalTokens: 0, toolUses: 2, durationMs: 3 });
});
