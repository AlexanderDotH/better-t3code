import type { ModelSelection, ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";
import { estimatePlanExecutionTime } from "@t3tools/client-runtime/plan-implementation";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isAutoReasoningEnabled,
} from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import { withImplicitFastModeDefault } from "./composerProviderState";

export function estimatePlanExecution(input: {
  planMarkdown: string;
  modelSelection: ModelSelection;
  models: ReadonlyArray<ServerProviderModel>;
  provider: ProviderDriverKind;
  autoReasoningEffort?: string | null | undefined;
  ultrathink: boolean;
}) {
  const { modelSelection } = input;
  const caps = getProviderModelCapabilities(input.models, modelSelection.model, input.provider);
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: withImplicitFastModeDefault(caps, modelSelection.options),
  });
  const reasoning = descriptors.find(({ id }) => id === "reasoningEffort" || id === "effort");
  const auto = input.provider === "codex" && isAutoReasoningEnabled(modelSelection);
  const effort = input.ultrathink
    ? "ultrathink"
    : auto
      ? input.autoReasoningEffort
      : getProviderOptionCurrentValue(reasoning);
  const effortLabel =
    typeof effort === "string"
      ? reasoning?.type === "select"
        ? (reasoning.options.find(({ id }) => id === effort)?.label ?? effort)
        : effort
      : null;
  const speed = descriptors.find(({ id }) => id === "serviceTier" || id === "fastMode");
  const speedValue = getProviderOptionCurrentValue(speed);
  const estimate = estimatePlanExecutionTime({
    planMarkdown: input.planMarkdown,
    effort,
    speed: speedValue,
  });
  return {
    model:
      input.models.find(({ slug }) => slug === modelSelection.model)?.name ?? modelSelection.model,
    reasoning: auto ? (effortLabel ? `Auto · ${effortLabel}` : "Auto") : effortLabel,
    speed: speed?.type === "select" ? (getProviderOptionCurrentLabel(speed) ?? null) : null,
    ...estimate,
    hasSpeedOption: speed !== undefined,
  };
}
