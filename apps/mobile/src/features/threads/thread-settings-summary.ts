import type {
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  RuntimeMode,
} from "@t3tools/contracts";

import { providerOptionValueLabels } from "../../lib/providerOptions";
import { RUNTIME_MODE_CHOICES } from "./thread-settings-options";

export function threadSettingsSummaryLabel(input: {
  readonly modelLabel: string;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly fetchEnabled?: boolean;
}): string {
  const runtime = RUNTIME_MODE_CHOICES.find((choice) => choice.mode === input.runtimeMode);
  return [
    input.modelLabel,
    ...providerOptionValueLabels(input.optionDescriptors),
    ...(runtime ? [runtime.label] : []),
    ...(input.interactionMode === "plan" ? ["Plan"] : []),
    ...(input.fetchEnabled ? ["Fetch"] : []),
  ].join(" · ");
}
