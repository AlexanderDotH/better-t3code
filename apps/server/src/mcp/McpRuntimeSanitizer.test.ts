import { describe, expect, it } from "@effect/vitest";

import { sanitizeMcpRuntimeText } from "./McpRuntimeSanitizer.ts";

describe("sanitizeMcpRuntimeText", () => {
  it("redacts bearer tokens, secret assignments, and sensitive headers", () => {
    const message = [
      "request failed",
      "Authorization: Bearer abc.def.ghi",
      "NOTION_TOKEN=notion-secret",
      'x-api-key: "api-secret"',
    ].join("\n");

    const sanitized = sanitizeMcpRuntimeText(message);

    expect(sanitized).not.toContain("abc.def.ghi");
    expect(sanitized).not.toContain("notion-secret");
    expect(sanitized).not.toContain("api-secret");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("preserves useful non-secret provider context and bounds its size", () => {
    expect(sanitizeMcpRuntimeText("Notion requires authorization")).toBe(
      "Notion requires authorization",
    );
    expect(sanitizeMcpRuntimeText("x".repeat(4_000)).length).toBeLessThanOrEqual(1_024);
  });

  it("does not serialize arbitrary provider defects", () => {
    expect(sanitizeMcpRuntimeText({ token: "secret" })).toBe("Provider runtime request failed.");
  });
});
