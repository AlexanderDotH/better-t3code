import * as Schema from "effect/Schema";

import type { ProjectIndexModelCapabilities } from "../runtime/ProjectIndexingBridge.ts";

const MESSAGE_OVERHEAD_TOKENS = 1_024;
const MINIMUM_OUTPUT_TOKENS = 2_048;
const PREFERRED_OUTPUT_TOKENS = 16_384;

export class ProjectIndexContextBudgetError extends Schema.TaggedError<ProjectIndexContextBudgetError>()(
  "ProjectIndexContextBudgetError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ProjectIndexContextBudget {
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly maximumPromptTokens: number;
}

// UTF-8 bytes bound byte-level tokenizers conservatively, including non-ASCII source.
export function estimateProjectIndexTokens(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function projectIndexContextBudget(
  capabilities: ProjectIndexModelCapabilities,
): ProjectIndexContextBudget {
  const promptOverheadTokens = capabilities.promptOverheadTokens ?? 0;
  if (
    !Number.isSafeInteger(capabilities.contextWindowTokens) ||
    !Number.isSafeInteger(capabilities.maxOutputTokens) ||
    !Number.isSafeInteger(promptOverheadTokens) ||
    promptOverheadTokens < 0 ||
    capabilities.maxOutputTokens < MINIMUM_OUTPUT_TOKENS ||
    capabilities.contextWindowTokens <=
      MINIMUM_OUTPUT_TOKENS + MESSAGE_OVERHEAD_TOKENS + promptOverheadTokens
  ) {
    throw new ProjectIndexContextBudgetError({
      detail: "The selected model does not expose a usable context and output capacity.",
    });
  }
  const maxOutputTokens = Math.min(
    capabilities.maxOutputTokens,
    PREFERRED_OUTPUT_TOKENS,
    Math.floor(capabilities.contextWindowTokens / 4),
    capabilities.contextWindowTokens - MESSAGE_OVERHEAD_TOKENS - promptOverheadTokens - 1,
  );
  return {
    contextWindowTokens: capabilities.contextWindowTokens,
    maxOutputTokens,
    maximumPromptTokens:
      capabilities.contextWindowTokens -
      maxOutputTokens -
      MESSAGE_OVERHEAD_TOKENS -
      promptOverheadTokens,
  };
}

export function assertProjectIndexPromptFits(
  prompt: string,
  budget: ProjectIndexContextBudget,
): void {
  const promptTokens = estimateProjectIndexTokens(prompt);
  if (promptTokens > budget.maximumPromptTokens) {
    throw new ProjectIndexContextBudgetError({
      detail: `The complete source needs up to ${promptTokens} input tokens; the selected model permits ${budget.maximumPromptTokens}. Split the source unit or explicitly select a model with a larger context.`,
    });
  }
}

export function selectProjectIndexContextBudget(
  prompt: string,
  capabilities: ProjectIndexModelCapabilities,
): ProjectIndexContextBudget {
  const largest = projectIndexContextBudget(capabilities);
  const capacities = [
    ...new Set([...(capabilities.supportedContextWindows ?? []), capabilities.contextWindowTokens]),
  ]
    .filter((capacity) => capacity <= capabilities.contextWindowTokens)
    .sort((left, right) => left - right);
  for (const contextWindowTokens of capacities) {
    if (
      !Number.isSafeInteger(contextWindowTokens) ||
      contextWindowTokens <=
        MINIMUM_OUTPUT_TOKENS + MESSAGE_OVERHEAD_TOKENS + (capabilities.promptOverheadTokens ?? 0)
    )
      continue;
    const budget = projectIndexContextBudget({ ...capabilities, contextWindowTokens });
    if (estimateProjectIndexTokens(prompt) <= budget.maximumPromptTokens) return budget;
  }
  assertProjectIndexPromptFits(prompt, largest);
  return largest;
}
