import {
  defaultInstanceIdForDriver,
  type ModelSelection,
  type OrchestrationThreadActivity,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  CODEX_CONTEXT_WINDOW_OPTION_ID,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isAutoReasoningEnabled,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
  readAutoReasoningResolution,
} from "@t3tools/shared/model";
import { normalizeClientModelSelection } from "@t3tools/client-runtime/model-options";
import type { ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  ContextWindowMenuContent,
  ContextWindowPicker,
  shouldRenderContextWindowControl,
} from "./ContextWindowPicker";
import {
  type AutoReasoningStatus,
  shouldRenderTraitsControls,
  TraitsMenuContent,
  TraitsPicker,
} from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  promptInjectionState?: ComposerPromptInjectionState;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  planModeEnabled: boolean;
};

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

export function resolveAutoReasoningStatus(
  selection: ModelSelection,
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload">>,
): AutoReasoningStatus | null {
  return isAutoReasoningEnabled(selection) ? readAutoReasoningStatus(activities) : null;
}

export type ComposerPromptInjectionState = "none" | "ultrathink";

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onThreadModelSelectionChange?: (
    threadRef: ScopedThreadRef,
    modelSelection: ModelSelection,
  ) => void;
  planModeEnabled: boolean;
  autoReasoningStatus?: AutoReasoningStatus;
};

export function getComposerPromptInjectionState(prompt: string): ComposerPromptInjectionState {
  return isClaudeUltrathinkPrompt(prompt) ? "ultrathink" : "none";
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const {
    provider,
    model,
    models,
    modelOptions,
    promptInjectionState = "none",
    planModeEnabled,
  } = input;
  if (provider === "opencode") {
    const normalizedModel = normalizeModelSlug(model, provider);
    const modelIsInCatalog = models.some((candidate) => candidate.slug === normalizedModel);
    if (!modelIsInCatalog) {
      const preservedOptions = modelOptions?.filter(
        (option) => planModeEnabled || option.id !== "agent" || option.value !== "plan",
      );
      return {
        provider,
        promptEffort: null,
        modelOptionsForDispatch:
          preservedOptions && preservedOptions.length > 0 ? preservedOptions : undefined,
      };
    }
  }
  const caps = getProviderModelCapabilities(models, model, provider, planModeEnabled);
  const normalizedSelection = normalizeClientModelSelection({
    provider,
    selection: {
      instanceId: defaultInstanceIdForDriver(provider),
      model,
      ...(modelOptions ? { options: modelOptions } : {}),
    },
    capabilities: caps,
  });
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: normalizedSelection.options,
  });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select" &&
      !(provider === "codex" && descriptor.id === CODEX_CONTEXT_WINDOW_OPTION_ID),
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    promptInjectionState === "ultrathink";

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    ...(ultrathinkActive
      ? {
          composerFrameClassName: "ultrathink-frame",
          composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
    planModeEnabled,
    autoReasoningStatus,
  } = input;
  const hasTarget = threadRef !== undefined || draftId !== undefined;
  if (
    !hasTarget ||
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      modelOptions,
      prompt,
      planModeEnabled,
    })
  ) {
    return null;
  }
  return (
    <Component
      provider={provider}
      {...(instanceId ? { instanceId } : {})}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={modelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
      planModeEnabled={planModeEnabled}
      {...(autoReasoningStatus ? { autoReasoningStatus } : {})}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}

function renderContextWindowControl(
  Component: typeof ContextWindowMenuContent | typeof ContextWindowPicker,
  input: TraitsRenderInput,
): ReactNode {
  if (
    (input.threadRef === undefined && input.draftId === undefined) ||
    !shouldRenderContextWindowControl(input)
  ) {
    return null;
  }
  return (
    <Component
      provider={input.provider}
      {...(input.instanceId ? { instanceId: input.instanceId } : {})}
      models={input.models}
      {...(input.threadRef ? { threadRef: input.threadRef } : {})}
      {...(input.draftId ? { draftId: input.draftId } : {})}
      model={input.model}
      modelOptions={input.modelOptions}
      {...(input.onThreadModelSelectionChange
        ? { onThreadModelSelectionChange: input.onThreadModelSelectionChange }
        : {})}
    />
  );
}

export function renderProviderContextWindowPicker(input: TraitsRenderInput): ReactNode {
  return renderContextWindowControl(ContextWindowPicker, input);
}

export function renderProviderContextWindowMenuContent(input: TraitsRenderInput): ReactNode {
  return renderContextWindowControl(ContextWindowMenuContent, input);
}
