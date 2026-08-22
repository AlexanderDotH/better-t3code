import { describe, expect, it } from "vite-plus/test";

import { resolveOpenCodeConfigContent } from "./opencodeRuntime.ts";

describe("resolveOpenCodeConfigContent", () => {
  it("prefers the caller environment over the inherited environment", () => {
    expect(
      resolveOpenCodeConfigContent(
        { OPENCODE_CONFIG_CONTENT: '{"source":"caller"}' },
        { OPENCODE_CONFIG_CONTENT: '{"source":"process"}' },
      ),
    ).toBe('{"source":"caller"}');
  });

  it("falls back to the inherited environment and then an empty config", () => {
    expect(
      resolveOpenCodeConfigContent(undefined, {
        OPENCODE_CONFIG_CONTENT: '{"source":"process"}',
      }),
    ).toBe('{"source":"process"}');
    expect(resolveOpenCodeConfigContent(undefined, {})).toBe("{}");
  });

  it("adds managed MCP servers without dropping inherited OpenCode configuration", () => {
    expect(
      JSON.parse(
        resolveOpenCodeConfigContent(
          {
            OPENCODE_CONFIG_CONTENT:
              '{"source":"caller","mcp":{"existing":{"type":"remote","url":"https://existing.example"}}}',
          },
          {},
          {
            "t3-code": {
              type: "remote",
              url: "http://127.0.0.1/mcp/workspace",
            },
          },
        ),
      ),
    ).toEqual({
      source: "caller",
      mcp: {
        existing: { type: "remote", url: "https://existing.example" },
        "t3-code": { type: "remote", url: "http://127.0.0.1/mcp/workspace" },
      },
    });
  });
});
