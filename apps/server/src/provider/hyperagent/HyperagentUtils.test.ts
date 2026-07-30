import { describe, expect, it } from "vite-plus/test";

import {
  HYPERAGENT_T3_CHAT_FLAGS,
  hyperagentCookieHeader,
  hyperagentSseStatusLabel,
  mapHyperagentUsageToTokenUsage,
  normalizeHyperagentBaseUrl,
  parseHyperagentSseChunk,
  wrapHyperagentSystemPrompt,
} from "./HyperagentUtils.ts";

describe("HyperagentUtils", () => {
  it("parses streamed text, thinking, status, and remainder", () => {
    const parsed = parseHyperagentSseChunk(
      [
        'data: {"type":"thinking","content":"plan"}',
        'data: {"type":"sandbox_status","content":"working"}',
        'data: {"type":"text","content":"hello"}',
        "data: [DONE]",
        "data:",
      ].join("\n"),
      "pre-",
      "",
    );

    expect(parsed.result.text).toBe("pre-hello");
    expect(parsed.result.thinking).toBe("plan");
    expect(parsed.result.done).toBe(true);
    expect(hyperagentSseStatusLabel(parsed.result.events[1])).toBe("working");
    expect(parsed.remainder).toBe("data:");
  });

  it("normalizes cookie header and usage totals without exposing raw cookie details", () => {
    expect(hyperagentCookieHeader("__Host-hyperagent_session=abc123; other=value")).toBe(
      "__Host-hyperagent_session=abc123; hyperagent_logged_in=1",
    );
    expect(
      mapHyperagentUsageToTokenUsage({
        lastCapture: { input_tokens: "10", output_tokens: 4 },
        totals: { total_cost_usd: 0.25 },
      }),
    ).toEqual({
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      costUsd: 0.25,
    });
  });

  it("keeps T3 embedded sessions isolated from account-level Hyperagent state", () => {
    expect(normalizeHyperagentBaseUrl(" https://hyperagent.example/ ")).toBe(
      "https://hyperagent.example",
    );
    expect(HYPERAGENT_T3_CHAT_FLAGS.integrationMode).toBe("disabled");
    expect(HYPERAGENT_T3_CHAT_FLAGS.enableThreadSearch).toBe(false);
    expect(HYPERAGENT_T3_CHAT_FLAGS.enablePersistentSandbox).toBe(false);
    expect(wrapHyperagentSystemPrompt("Workspace: /tmp/project")).toContain("isolated session");
  });
});
