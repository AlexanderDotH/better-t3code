import { describe, expect, it } from "vite-plus/test";

import { normalizeMcpSettingsSearch } from "../components/settings/McpServersSettings.logic";

describe("settings MCP route search", () => {
  it("keeps exact environment, provider, session, and server deep links", () => {
    expect(
      normalizeMcpSettingsSearch({
        environment: " remote ",
        provider: "claude_work",
        thread: "thread-42",
        runtime: "runtime-3",
        server: "notion",
        ignored: "value",
      }),
    ).toEqual({
      environment: "remote",
      provider: "claude_work",
      thread: "thread-42",
      runtime: "runtime-3",
      server: "notion",
    });
  });

  it("drops malformed and unbounded search values", () => {
    expect(
      normalizeMcpSettingsSearch({
        environment: " ",
        provider: 12,
        thread: "x".repeat(513),
      }),
    ).toEqual({});
  });
});
