import type {
  ProviderAdapterCapabilities,
  ProviderDeepPlanSupport,
} from "./Services/ProviderAdapter.ts";

export const DEEP_PLAN_PROVIDER_SUPPORT = {
  codex: { supported: true, readOnlyPlan: "native" },
  claude: { supported: true, readOnlyPlan: "native" },
  cursor: { supported: true, readOnlyPlan: "native" },
  openai: { supported: true, readOnlyPlan: "harness" },
  chatgpt: { supported: true, readOnlyPlan: "harness" },
  openrouter: { supported: true, readOnlyPlan: "harness" },
  openaiCompatible: { supported: true, readOnlyPlan: "harness" },
  lmstudio: { supported: true, readOnlyPlan: "harness" },
  opencode: {
    supported: false,
    reason: "OpenCode does not guarantee a read-only planning agent with the Deep Plan toolkit.",
  },
  grok: {
    supported: false,
    reason: "Grok does not support the run-bound Deep Plan MCP toolkit.",
  },
  antigravity: {
    supported: false,
    reason: "Antigravity does not support the run-bound Deep Plan MCP toolkit.",
  },
  gemini: {
    supported: false,
    reason: "Gemini does not support the run-bound Deep Plan MCP toolkit.",
  },
} as const satisfies Readonly<Record<string, ProviderDeepPlanSupport>>;

export function providerDeepPlanSupport(
  capabilities: ProviderAdapterCapabilities,
): ProviderDeepPlanSupport {
  if (capabilities.deepPlan?.supported !== true) {
    return (
      capabilities.deepPlan ?? {
        supported: false,
        reason: "This provider does not declare read-only planning with the Deep Plan toolkit.",
      }
    );
  }
  return capabilities.mcp === "nativeConfig" || capabilities.mcp === "sessionConfig"
    ? capabilities.deepPlan
    : {
        supported: false,
        reason: "This provider cannot attach the run-bound Deep Plan MCP toolkit.",
      };
}
