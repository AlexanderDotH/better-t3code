import type { ProviderInteractionMode } from "@t3tools/contracts";
import {
  buildDeepPlanInstructions,
  type DeepPlanInstructionContext,
} from "./DeepPlanInstructions.ts";
import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface CodexT3ToolAvailability {
  readonly preview: boolean;
  readonly device?: boolean;
  readonly workspace: boolean;
  readonly workspaceWrite: boolean;
  readonly coordination: boolean;
  readonly threadContext: boolean;
  readonly projectMemory: boolean;
  readonly knowledgeGraph: boolean;
  readonly deepPlan?: DeepPlanInstructionContext;
}

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
  readonly deepPlan?: DeepPlanInstructionContext;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability | CodexT3ToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean"
    ? { browser: availability, device: false }
    : "preview" in availability
      ? {
          browser: availability.preview,
          device: availability.device ?? false,
          ...(availability.deepPlan === undefined ? {} : { deepPlan: availability.deepPlan }),
        }
      : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (
  availability: boolean | T3CodeToolAvailability | CodexT3ToolAvailability,
): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability | CodexT3ToolAvailability = true,
  interactionMode: ProviderInteractionMode = "default",
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  const deepPlan = buildDeepPlanInstructions(
    interactionMode === "chat" ? undefined : normalizeAvailability(toolsAvailable).deepPlan,
  );
  const deepPlanChunks: Array<string> = [];
  let chunk = "";
  for (const character of deepPlan) {
    if (Buffer.byteLength(chunk + character, "utf8") > CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES) {
      deepPlanChunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) deepPlanChunks.push(chunk);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    ...Object.fromEntries(
      Array.from({ length: Math.max(4, deepPlanChunks.length) }, (_, index) => [
        index === 0
          ? "t3_code_deep_plan"
          : `t3_code_deep_plan_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: deepPlanChunks[index] ?? "" },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime, interactionMode }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
  };
}
