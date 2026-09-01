import type {
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  RuntimeMode,
} from "@t3tools/contracts";

import { providerOptionValueLabels } from "../../lib/providerOptions";
import { readAutoReasoningResolution } from "@t3tools/shared/model";
import { RUNTIME_MODE_CHOICES } from "./thread-settings-options";

export type AutoReasoningStatus = {
  readonly enabled: true;
  readonly effectiveEffort?: string;
  readonly fallback?: boolean;
};

/** Reads only the content-free projected decision activity for the latest turn. */
export function readAutoReasoningStatus(
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload">>,
): AutoReasoningStatus | null {
  const resolution = readAutoReasoningResolution(activities);
  return resolution === null
    ? null
    : {
        enabled: true,
        effectiveEffort: resolution.effectiveEffort,
        ...(resolution.fallback ? { fallback: true } : {}),
      };
}

export function threadReasoningValueLabel(input: {
  readonly autoReasoningEnabled: boolean;
  readonly manualLabel: string;
  readonly status: AutoReasoningStatus | null;
  readonly autoLabel?: string;
  readonly fallbackLabel?: string;
}): string {
  if (!input.autoReasoningEnabled) return input.manualLabel;
  return [
    input.autoLabel ?? "Auto",
    input.status?.effectiveEffort
      ? input.status.effectiveEffort.replace(/^./, (letter) => letter.toUpperCase())
      : input.manualLabel,
    input.status?.fallback ? (input.fallbackLabel ?? "Fallback") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function threadSettingsSummaryLabel(input: {
  readonly modelLabel: string;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly fetchEnabled?: boolean;
  readonly autoReasoning?: AutoReasoningStatus | { readonly enabled: false };
}): string {
  const runtime = RUNTIME_MODE_CHOICES.find((choice) => choice.mode === input.runtimeMode);
  return [
    input.modelLabel,
    ...(input.autoReasoning?.enabled
      ? [
          [
            "Auto",
            input.autoReasoning.effectiveEffort
              ? input.autoReasoning.effectiveEffort.replace(/^./, (letter) => letter.toUpperCase())
              : null,
            input.autoReasoning.fallback ? "Fallback" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ]
      : []),
    ...providerOptionValueLabels(input.optionDescriptors),
    ...(runtime ? [runtime.label] : []),
    ...(input.interactionMode === "plan" ? ["Plan"] : []),
    ...(input.fetchEnabled ? ["Fetch"] : []),
  ].join(" · ");
}
