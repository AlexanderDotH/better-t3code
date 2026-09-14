import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

import { buildCavemanPromptAppendix, type CavemanPromptMode } from "./CavemanPromptStyle.ts";
import {
  buildDeepThinkingRequestAppendix,
  type DeepThinkingRequestPolicyOptions,
} from "./DeepThinkingPrompts.ts";

export interface AgentPromptEnhancementPolicy {
  readonly cavemanMode: CavemanPromptMode;
  readonly deepThinking: DeepThinkingRequestPolicyOptions & { readonly enabled: boolean };
  readonly visualizationsEnabled?: boolean;
}

export type AgentPromptEnhancementOutcome = "not-requested" | "included" | "omitted";

export interface AgentPromptEnhancementApplication {
  readonly providerInput?: string | undefined;
  readonly outcome: AgentPromptEnhancementOutcome;
}

const visualizationPromptAppendix = `### Diagrams and data visualization
For this turn, proactively visualize when it materially helps understanding, comparison, or decisions. Respect explicit text, code, and other requested output formats; simple answers need no diagram.
Use closed fenced code blocks: prefer mermaid for explanations and vega-lite for data; plantuml, dot (alias graphviz), and vega are also bundled for suitable specialist diagrams. Explain the takeaway briefly beside the diagram and give verifiable sources.
Learning: start with a small overview and a concrete example, one question per diagram, clear names and labeled connections. State simplifications, then offer step-by-step detail. Optional understanding checks should ask for a prediction or application; wait for the learner's answer before explaining the solution.
Data analysis: use an informative title, units, period, comparison baseline, sources, and limitations. Distinguish measurements, examples, and forecasts. Never invent real business data or turn missing values into zero. Without supplied or already accessible data, ask for the needed data; label any illustrative values as examples.
For vega and vega-lite JSON, include usermeta.t3 with purpose ("learning" or "analysis"), summary (string), sources (string array), asOf (data date/period string), kind ("measurement", "example", or "forecast"), and limitations (string array). Do not fabricate source or date metadata. Embed the source rows; if aggregated, disclose the aggregation and uncertainty.
Prepare large datasets before charting: each block must fit 64 KiB and at most 5,000 inline data rows. The renderer cannot fetch URLs, files, external PlantUML includes, symbol libraries, or map services, and cannot execute arbitrary JavaScript. Use self-contained diagrams and data.`;

function buildAgentPromptEnhancementPolicy(policy: AgentPromptEnhancementPolicy): string {
  const blocks = [
    ...(policy.deepThinking.enabled ? [buildDeepThinkingRequestAppendix(policy.deepThinking)] : []),
    ...(policy.cavemanMode === "off" ? [] : [buildCavemanPromptAppendix(policy.cavemanMode)]),
    ...(policy.visualizationsEnabled ? [visualizationPromptAppendix] : []),
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
