import type { ModelSelection } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";

export type GeminiReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export const GEMINI_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies ReadonlyArray<GeminiReasoningEffort>;

export const GEMINI3_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
] as const satisfies ReadonlyArray<GeminiReasoningEffort>;

export const GEMINI_REASONING_EFFORT_LABELS: Readonly<Record<GeminiReasoningEffort, string>> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export const GeminiThinkingLevel = {
  MINIMAL: "MINIMAL",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type GeminiThinkingLevel = (typeof GeminiThinkingLevel)[keyof typeof GeminiThinkingLevel];

export interface GeminiThinkingConfig {
  readonly thinkingLevel?: GeminiThinkingLevel;
  readonly thinkingBudget?: number;
  readonly includeThoughts: boolean;
}

export function isGemini3ModelId(apiModelId: string): boolean {
  return apiModelId.trim().toLowerCase().startsWith("gemini-3");
}

export function isGemini25ModelId(apiModelId: string): boolean {
  return apiModelId.trim().toLowerCase().startsWith("gemini-2.5");
}

export function geminiDirectModelSupportsReasoningUi(apiModelId: string): boolean {
  return isGemini3ModelId(apiModelId) || isGemini25ModelId(apiModelId);
}

export function normalizeGeminiReasoningEffort(
  value: string | null | undefined,
): GeminiReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return normalized;
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

export function reasoningEffortToGeminiThinkingLevel(
  effort: GeminiReasoningEffort,
): GeminiThinkingLevel {
  switch (effort) {
    case "minimal":
      return GeminiThinkingLevel.MINIMAL;
    case "low":
      return GeminiThinkingLevel.LOW;
    case "medium":
      return GeminiThinkingLevel.MEDIUM;
    case "high":
    case "xhigh":
      return GeminiThinkingLevel.HIGH;
  }
}

const BUDGET_FLASH_BY_EFFORT: Readonly<Record<GeminiReasoningEffort, number>> = {
  minimal: 512,
  low: 4096,
  medium: 10240,
  high: 18432,
  xhigh: 24576,
};

const BUDGET_PRO_BY_EFFORT: Readonly<Record<GeminiReasoningEffort, number>> = {
  minimal: 256,
  low: 4096,
  medium: 12288,
  high: 24576,
  xhigh: 32768,
};

function isGemini25ProLike(apiModelId: string): boolean {
  return /gemini-2\.5.*pro/i.test(apiModelId.trim());
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function reasoningEffortToGeminiThinkingBudget(
  apiModelId: string,
  effort: GeminiReasoningEffort,
): number {
  const pro = isGemini25ProLike(apiModelId);
  const raw = pro ? BUDGET_PRO_BY_EFFORT[effort] : BUDGET_FLASH_BY_EFFORT[effort];
  return pro ? clamp(raw, 128, 32768) : clamp(raw, 0, 24576);
}

export function buildGeminiThinkingConfig(
  apiModelId: string,
  effort: GeminiReasoningEffort,
): GeminiThinkingConfig | undefined {
  const id = apiModelId.trim();
  if (!geminiDirectModelSupportsReasoningUi(id)) {
    return undefined;
  }

  if (isGemini3ModelId(id)) {
    return {
      thinkingLevel: reasoningEffortToGeminiThinkingLevel(effort),
      includeThoughts: true,
    };
  }

  if (isGemini25ModelId(id)) {
    return {
      thinkingBudget: reasoningEffortToGeminiThinkingBudget(id, effort),
      includeThoughts: true,
    };
  }

  return undefined;
}

export function deriveGeminiReasoningEffortSteps(
  apiModelId: string,
): ReadonlyArray<GeminiReasoningEffort> {
  if (!geminiDirectModelSupportsReasoningUi(apiModelId)) {
    return [];
  }
  return isGemini3ModelId(apiModelId) ? GEMINI3_REASONING_EFFORTS : GEMINI_REASONING_EFFORTS;
}

export function buildGeminiThinkingConfigForModelSelection(
  modelSelection: ModelSelection,
): GeminiThinkingConfig | undefined {
  const effort =
    normalizeGeminiReasoningEffort(
      getModelSelectionStringOptionValue(modelSelection, "reasoningEffort"),
    ) ?? "medium";
  return buildGeminiThinkingConfig(modelSelection.model, effort);
}
