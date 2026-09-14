import type { ModelSelection, ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";
import { estimatePlanImplementationWorkUnits } from "@t3tools/client-runtime/plan-implementation";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isAutoReasoningEnabled,
} from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import { withImplicitFastModeDefault } from "./composerProviderState";

const REASONING_TIME_FACTOR = new Map([
  ["none", 0.75],
  ["minimal", 0.75],
  ["low", 0.85],
  ["medium", 1],
  ["high", 1.25],
  ["xhigh", 1.5],
  ["max", 1.5],
  ["ultra", 1.75],
  ["ultrathink", 1.75],
]);

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
  const fast = speedValue === true || speedValue === "priority" || speedValue === "fast";
  const workUnits = estimatePlanImplementationWorkUnits(input.planMarkdown);
  // ponytail: uncalibrated planning heuristic; replace with per-model execution history when available.
  // Tool/test time remains even in Fast mode; no model-name-based benchmark assumptions.
  const factor =
    (typeof effort === "string" ? (REASONING_TIME_FACTOR.get(effort) ?? 1) : 1) *
    (fast ? 0.85 : speedValue === "flex" ? 1.25 : 1);
  const minutesPerUnit = 3;
  const baseline = workUnits * minutesPerUnit * factor;
  return {
    model:
      input.models.find(({ slug }) => slug === modelSelection.model)?.name ?? modelSelection.model,
    reasoning: auto ? (effortLabel ? `Auto · ${effortLabel}` : "Auto") : effortLabel,
    speed: speed?.type === "select" ? (getProviderOptionCurrentLabel(speed) ?? null) : null,
    fast,
    hasSpeedOption: speed !== undefined,
    workUnits,
    minMinutes: Math.max(2, Math.round(baseline * 0.6)),
    maxMinutes: Math.max(5, Math.round(baseline * 1.8)),
  };
}
