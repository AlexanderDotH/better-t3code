import {
  resolveProjectChatSettings,
  type ProjectChatSettingsDefaults,
  type ProjectChatSettingsThread,
} from "@t3tools/client-runtime/project-chat-settings";
import {
  resolveComposerMode,
  resolveDeepPlanningAvailability,
} from "@t3tools/client-runtime/deep-planning";
import type {
  ComposerMode,
  ModelSelection,
  ProjectChatSettings,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedProjectRef,
  ServerConfig,
} from "@t3tools/contracts";

import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
} from "./modelOptions";

type ComposerChatSettings = {
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly composerMode?: ComposerMode;
};

/** Captures configuration without carrying a conversation or its context into another draft. */
export function resolveMobileComposerChatSettings(
  draft: ComposerChatSettings,
  defaults: ProjectChatSettingsDefaults,
): ProjectChatSettingsDefaults {
  return {
    modelSelection: draft.modelSelection ?? defaults.modelSelection,
    runtimeMode: draft.runtimeMode ?? defaults.runtimeMode,
    composerMode:
      draft.composerMode !== undefined || draft.interactionMode !== undefined
        ? resolveComposerMode(draft.composerMode, draft.interactionMode)
        : defaults.composerMode,
  };
}

export function resolveMobileNewTaskChatSettings(input: {
  readonly target: ScopedProjectRef | null;
  readonly remembered: ProjectChatSettings | undefined;
  readonly threads: ReadonlyArray<ProjectChatSettingsThread>;
  readonly config: ServerConfig | null;
  readonly defaults: ProjectChatSettingsDefaults;
  readonly draft: ComposerChatSettings;
}) {
  const supported = input.config?.environment.capabilities.projectChatSettings === true;
  const inherited =
    supported && input.target !== null
      ? resolveProjectChatSettings({
          target: input.target,
          remembered: input.remembered,
          threads: input.threads,
          defaults: input.defaults,
        })
      : input.defaults;
  const preferredSettings = resolveMobileComposerChatSettings(input.draft, inherited);
  const selectableSelection = resolveSelectableModelSelection(
    input.config,
    preferredSettings.modelSelection,
  );
  const defaultSelection = resolveDefaultableModelSelection(
    input.config,
    input.defaults.modelSelection,
  );
  const modelOptions = buildModelOptions(input.config, selectableSelection ?? defaultSelection);
  const selection = resolveNewTaskModelSelection({
    draftSelection: selectableSelection,
    projectDefaultSelection: defaultSelection,
    stickySelection: null,
    modelOptions,
  });
  const modelSelection =
    (supported && selection
      ? modelOptions.find(
          (option) =>
            option.selection.instanceId === selection.instanceId &&
            option.selection.model === selection.model,
        )?.selection
      : null) ?? selection;
  const provider = input.config?.providers.find(
    (candidate) => candidate.instanceId === modelSelection?.instanceId,
  );
  const modeUnavailable =
    (preferredSettings.composerMode === "plan" && provider?.showInteractionModeToggle === false) ||
    (preferredSettings.composerMode === "deep-plan" &&
      !resolveDeepPlanningAvailability({
        capabilities: input.config?.environment.capabilities,
        provider,
      }).supported);
  const composerMode = supported && modeUnavailable ? "default" : preferredSettings.composerMode;
  return { ...preferredSettings, modelSelection, composerMode, modelOptions, preferredSettings };
}
