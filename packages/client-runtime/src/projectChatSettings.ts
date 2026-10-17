import type {
  ComposerMode,
  ModelSelection,
  OrchestrationThreadShell,
  ProjectChatSettings,
  RuntimeMode,
  ScopedProjectRef,
} from "@t3tools/contracts";

export interface ResolvedProjectChatSettings {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly composerMode: ComposerMode;
}

export interface ProjectChatSettingsDefaults extends Omit<
  ResolvedProjectChatSettings,
  "modelSelection"
> {
  readonly modelSelection: ModelSelection | null;
}

export interface ProjectChatSettingsThread extends Pick<
  OrchestrationThreadShell,
  | "id"
  | "projectId"
  | "modelSelection"
  | "runtimeMode"
  | "interactionMode"
  | "latestUserMessageAt"
  | "createdAt"
> {
  readonly environmentId: ScopedProjectRef["environmentId"];
  readonly composerMode?: ComposerMode;
}

/** Copies only reusable composer choices, never the source thread's context. */
export function projectChatSettingsSnapshot(
  settings: ResolvedProjectChatSettings,
): ResolvedProjectChatSettings;
export function projectChatSettingsSnapshot(
  settings: ProjectChatSettingsDefaults,
): ProjectChatSettingsDefaults;
export function projectChatSettingsSnapshot(
  settings: ProjectChatSettingsDefaults,
): ProjectChatSettingsDefaults {
  return {
    modelSelection:
      settings.modelSelection === null
        ? null
        : {
            instanceId: settings.modelSelection.instanceId,
            model: settings.modelSelection.model,
            ...(settings.modelSelection.options === undefined
              ? {}
              : {
                  options: settings.modelSelection.options.map(({ id, value }) => ({ id, value })),
                }),
          },
    runtimeMode: settings.runtimeMode,
    composerMode: settings.composerMode,
  };
}

function isMoreRecentlyUsed(
  candidate: ProjectChatSettingsThread,
  current: ProjectChatSettingsThread,
): boolean {
  const candidateOrder = [candidate.latestUserMessageAt ?? "", candidate.createdAt, candidate.id];
  const currentOrder = [current.latestUserMessageAt ?? "", current.createdAt, current.id];
  for (let index = 0; index < candidateOrder.length; index += 1) {
    if (candidateOrder[index] !== currentOrder[index]) {
      return candidateOrder[index]! > currentOrder[index]!;
    }
  }
  return false;
}

interface ResolveProjectChatSettingsInput {
  readonly target: ScopedProjectRef;
  readonly remembered: ProjectChatSettings | undefined;
  readonly threads: ReadonlyArray<ProjectChatSettingsThread>;
  readonly defaults: ProjectChatSettingsDefaults;
}

export function resolveProjectChatSettings(
  input: ResolveProjectChatSettingsInput & { readonly defaults: ResolvedProjectChatSettings },
): ResolvedProjectChatSettings;
export function resolveProjectChatSettings(
  input: ResolveProjectChatSettingsInput,
): ProjectChatSettingsDefaults;
export function resolveProjectChatSettings(
  input: ResolveProjectChatSettingsInput,
): ProjectChatSettingsDefaults {
  let remembered = input.remembered;
  if (remembered === undefined) {
    let mostRecentlyUsed: ProjectChatSettingsThread | undefined;
    for (const thread of input.threads) {
      if (
        thread.environmentId !== input.target.environmentId ||
        thread.projectId !== input.target.projectId ||
        thread.latestUserMessageAt === null
      ) {
        continue;
      }
      if (mostRecentlyUsed === undefined || isMoreRecentlyUsed(thread, mostRecentlyUsed)) {
        mostRecentlyUsed = thread;
      }
    }
    if (mostRecentlyUsed !== undefined) {
      remembered = {
        modelSelection: mostRecentlyUsed.modelSelection,
        runtimeMode: mostRecentlyUsed.runtimeMode,
        composerMode: mostRecentlyUsed.composerMode ?? mostRecentlyUsed.interactionMode,
      };
    }
  }
  return projectChatSettingsSnapshot({
    modelSelection: remembered?.modelSelection ?? input.defaults.modelSelection,
    runtimeMode: remembered?.runtimeMode ?? input.defaults.runtimeMode,
    composerMode: remembered?.composerMode ?? input.defaults.composerMode,
  });
}
