import type {
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  RuntimeMode,
} from "@t3tools/contracts";

import { providerOptionValueLabels } from "../../lib/providerOptions";
import { RUNTIME_MODE_CHOICES } from "./thread-settings-options";

export function threadReasoningValueLabel(input: {
  readonly autoReasoningEnabled: boolean;
  readonly manualLabel: string;
  readonly autoLabel?: string;
  readonly resolvedEffortLabel?: string | null;
}): string {
  if (!input.autoReasoningEnabled) return input.manualLabel;
  const autoLabel = input.autoLabel ?? "Auto";
  return input.resolvedEffortLabel ? `${autoLabel} · ${input.resolvedEffortLabel}` : autoLabel;
}

export function threadSettingsSummaryLabel(input: {
  readonly modelLabel: string;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly fetchEnabled?: boolean;
  readonly autoReasoning?: { readonly enabled: boolean; readonly effectiveEffort?: string };
}): string {
  const runtime = RUNTIME_MODE_CHOICES.find((choice) => choice.mode === input.runtimeMode);
  const autoReasoningLabel = input.autoReasoning?.enabled
    ? threadReasoningValueLabel({
        autoReasoningEnabled: true,
        manualLabel: "",
        resolvedEffortLabel: input.autoReasoning.effectiveEffort?.replace(/^./, (letter) =>
          letter.toUpperCase(),
        ),
      })
    : null;
  return [
    input.modelLabel,
    ...(autoReasoningLabel ? [autoReasoningLabel] : []),
    ...providerOptionValueLabels(input.optionDescriptors),
    ...(runtime ? [runtime.label] : []),
    ...(input.interactionMode === "plan" ? ["Plan"] : []),
    ...(input.fetchEnabled ? ["Fetch"] : []),
  ].join(" · ");
}
