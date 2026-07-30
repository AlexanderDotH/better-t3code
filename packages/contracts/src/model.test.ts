import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AGENT_MODEL_ID_PREFIX_BY_PROVIDER,
  AgentLlmSlotState,
  AgentLlmTransportKind,
  AgentModelCatalogProviderId,
  AgentReasoningEffort,
  DEFAULT_AGENT_REASONING_EFFORT,
  DEFAULT_MODEL_BY_PROVIDER,
  GEMINI_DRIVER_KIND,
  HYPERAGENT_DRIVER_KIND,
  ModelCapabilities,
} from "./model.ts";

const decodeAgentLlmSlotState = Schema.decodeUnknownSync(AgentLlmSlotState);
const decodeAgentModelCatalogProviderId = Schema.decodeUnknownSync(AgentModelCatalogProviderId);
const decodeAgentLlmTransportKind = Schema.decodeUnknownSync(AgentLlmTransportKind);
const decodeAgentReasoningEffort = Schema.decodeUnknownSync(AgentReasoningEffort);
const decodeModelCapabilities = Schema.decodeUnknownSync(ModelCapabilities);

describe("multi-provider model contracts", () => {
  it("exports stable stored model prefixes for provider routing", () => {
    expect(AGENT_MODEL_ID_PREFIX_BY_PROVIDER).toEqual({
      gemini: "gemini-direct:",
      nvidia: "nvidia:",
      local: "local:",
      zen: "zen:",
      go: "go:",
      kiro: "kiro:",
      cursor: "cursor:",
      hyperagent: "hyperagent:",
    });
  });

  it("accepts every provider id and transport kind used by model selections", () => {
    expect(decodeAgentModelCatalogProviderId("openrouter")).toBe("openrouter");
    expect(decodeAgentModelCatalogProviderId("nvidia")).toBe("nvidia");
    expect(decodeAgentModelCatalogProviderId("hyperagent")).toBe("hyperagent");
    expect(decodeAgentLlmTransportKind("openai-compatible")).toBe("openai-compatible");
    expect(decodeAgentLlmTransportKind("hyperagent-agent")).toBe("hyperagent-agent");
  });

  it("decodes reasoning and per-slot model overrides", () => {
    const decoded = decodeAgentLlmSlotState({
      storedModelId: "  hyperagent:sonnet-latest  ",
      label: "  Latest Sonnet  ",
      overrides: {
        reasoningEffort: "xhigh",
        supportsReasoningEffort: true,
        openRouterContextCompression: false,
      },
    });

    expect(DEFAULT_AGENT_REASONING_EFFORT).toBe("medium");
    expect(decodeAgentReasoningEffort("minimal")).toBe("minimal");
    expect(decoded.storedModelId).toBe("hyperagent:sonnet-latest");
    expect(decoded.label).toBe("Latest Sonnet");
    expect(decoded.overrides?.reasoningEffort).toBe("xhigh");
  });

  it("defines defaults for direct Gemini and Hyperagent runtimes", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[GEMINI_DRIVER_KIND]).toBe("gemini-2.5-flash");
    expect(DEFAULT_MODEL_BY_PROVIDER[HYPERAGENT_DRIVER_KIND]).toBe("sonnet-latest");
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
});
