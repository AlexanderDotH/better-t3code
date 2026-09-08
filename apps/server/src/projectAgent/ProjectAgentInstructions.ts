import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

export const PROJECT_AGENT_COORDINATION_INSTRUCTIONS = `<t3_project_agent_coordination>
Other root chat agents may work in this T3 project. Before changing files, call project_agent_list, then use project_agent_claim to publish a concise summary and path/topic claims. If a claim conflicts, coordinate with project_agent_send and choose non-overlapping work; claims are cooperative, not filesystem locks. A direct message to an offline peer wakes its existing chat; broadcasts reach active peers only. Check project_agent_inbox at safe checkpoints and before finalizing, acknowledge handled messages, and release claims when no longer needed. Provider-native subagents remain part of this root thread and work under its claims.
</t3_project_agent_coordination>`;

export function applyProjectAgentInstructionsToProviderInput(input: {
  readonly providerInput?: string;
  readonly maxInputChars?: number;
}): {
  readonly providerInput?: string;
  readonly outcome: "included" | "omitted";
} {
  const providerInput = input.providerInput ?? "";
  const separator = providerInput.length > 0 ? "\n\n" : "";
  const coordinatedInput = `${PROJECT_AGENT_COORDINATION_INSTRUCTIONS}${separator}${providerInput}`;
  if (coordinatedInput.length > (input.maxInputChars ?? PROVIDER_SEND_TURN_MAX_INPUT_CHARS)) {
    return {
      ...(input.providerInput !== undefined ? { providerInput: input.providerInput } : {}),
      outcome: "omitted",
    };
  }
  return { providerInput: coordinatedInput, outcome: "included" };
}
