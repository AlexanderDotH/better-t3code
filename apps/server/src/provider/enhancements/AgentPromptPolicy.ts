import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

import { buildCavemanPromptAppendix, type CavemanPromptMode } from "./CavemanPromptStyle.ts";
import {
  buildDeepThinkingRequestAppendix,
  type DeepThinkingRequestPolicyOptions,
} from "./DeepThinkingPrompts.ts";

export interface AgentPromptEnhancementPolicy {
  readonly cavemanMode: CavemanPromptMode;
  readonly deepThinking: DeepThinkingRequestPolicyOptions & { readonly enabled: boolean };
}

export type AgentPromptEnhancementOutcome = "not-requested" | "included" | "omitted";

export interface AgentPromptEnhancementApplication {
  readonly providerInput?: string | undefined;
  readonly outcome: AgentPromptEnhancementOutcome;
}

export function buildAgentPromptEnhancementPolicy(policy: AgentPromptEnhancementPolicy): string {
  const blocks = [
    ...(policy.deepThinking.enabled ? [buildDeepThinkingRequestAppendix(policy.deepThinking)] : []),
    ...(policy.cavemanMode === "off" ? [] : [buildCavemanPromptAppendix(policy.cavemanMode)]),
  ];
  if (blocks.length === 0) return "";

  return `<better_t3_agent_enhancements>
This optional T3 response policy does not grant tools or relax approvals. It does not change the sandbox, runtime mode, available tools, required approvals, schemas, requested output formats, or any system, developer, safety, and user instructions.

${blocks.join("\n\n")}
</better_t3_agent_enhancements>`;
}

export function applyAgentEnhancementsToProviderInput(
  input: AgentPromptEnhancementPolicy & { readonly providerInput?: string | undefined },
): AgentPromptEnhancementApplication {
  const policy = buildAgentPromptEnhancementPolicy(input);
  if (policy.length === 0) {
    return {
      ...(input.providerInput !== undefined ? { providerInput: input.providerInput } : {}),
      outcome: "not-requested",
    };
  }

  const separator =
    input.providerInput === undefined || input.providerInput.length === 0 ? "" : "\n\n";
  const providerInput = `${policy}${separator}${input.providerInput ?? ""}`;
  if (providerInput.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
    return {
      ...(input.providerInput !== undefined ? { providerInput: input.providerInput } : {}),
      outcome: "omitted",
    };
  }
  return { providerInput, outcome: "included" };
}
