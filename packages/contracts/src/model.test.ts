import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AgentReasoningEffort,
  CLAUDE_DRIVER_KIND,
  CODEX_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  DEFAULT_AGENT_REASONING_EFFORT,
  DEFAULT_MODEL_BY_PROVIDER,
  GEMINI_DRIVER_KIND,
  GROK_DRIVER_KIND,
  ModelCapabilities,
  OPENCODE_DRIVER_KIND,
  PROVIDER_DISPLAY_NAMES,
} from "./model.ts";

const decodeAgentReasoningEffort = Schema.decodeUnknownSync(AgentReasoningEffort);
const decodeModelCapabilities = Schema.decodeUnknownSync(ModelCapabilities);

describe("multi-provider model contracts", () => {
  it("defines defaults for exactly the native provider drivers", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER).toEqual({
      [CODEX_DRIVER_KIND]: "gpt-5.6-sol",
      [CLAUDE_DRIVER_KIND]: "claude-sonnet-5",
      [CURSOR_DRIVER_KIND]: "auto",
      [GROK_DRIVER_KIND]: "grok-build",
      [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
      [GEMINI_DRIVER_KIND]: "gemini-3.6-flash",
    });
  });

  it("defines display names for exactly the native provider drivers", () => {
    expect(PROVIDER_DISPLAY_NAMES).toEqual({
      [CODEX_DRIVER_KIND]: "Codex",
      [CLAUDE_DRIVER_KIND]: "Claude",
      [CURSOR_DRIVER_KIND]: "Cursor",
      [GROK_DRIVER_KIND]: "Grok",
      [OPENCODE_DRIVER_KIND]: "OpenCode",
      [GEMINI_DRIVER_KIND]: "Gemini",
    });
  });

  it("retains provider-independent reasoning effort contracts", () => {
    expect(DEFAULT_AGENT_REASONING_EFFORT).toBe("medium");
    expect(decodeAgentReasoningEffort("minimal")).toBe("minimal");
  });

  it("keeps provider options on the existing select and boolean descriptor surface", () => {
    const capabilities = decodeModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "medium", label: "Medium", isDefault: true },
            { id: "xhigh", label: "Very high" },
          ],
          currentValue: "medium",
        },
        {
          id: "fastMode",
          label: "Fast mode",
          type: "boolean",
          currentValue: false,
        },
      ],
    });

    expect(capabilities.optionDescriptors?.map((descriptor) => descriptor.type)).toEqual([
      "select",
      "boolean",
    ]);
  });

  it("decodes optional model context-window metadata without changing older capabilities", () => {
    expect(
      decodeModelCapabilities({
        contextWindow: {
          defaultTokens: 272_000,
          maxTokens: 872_000,
          effectivePercent: 95,
        },
      }),
    ).toEqual({
      contextWindow: {
        defaultTokens: 272_000,
        maxTokens: 872_000,
        effectivePercent: 95,
      },
    });
    expect(decodeModelCapabilities({})).toEqual({});
  });

  it("decodes optional model modality, pricing, and tool-support metadata", () => {
    expect(
      decodeModelCapabilities({
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        pricing: { promptUsdPerMillion: 2, completionUsdPerMillion: 10 },
        toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
      }),
    ).toEqual({
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      pricing: { promptUsdPerMillion: 2, completionUsdPerMillion: 10 },
      toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
    });
  });
});
