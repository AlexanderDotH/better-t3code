export type ProjectCheckpointSettingState = "enabled" | "disabled" | "mixed";

export interface ProjectCheckpointSetting {
  readonly state: ProjectCheckpointSettingState;
  readonly effectiveEnabled: boolean;
}

export function resolveProjectCheckpointSetting(
  projects: ReadonlyArray<{ readonly checkpointsEnabled: boolean }>,
): ProjectCheckpointSetting {
  const enabledCount = projects.filter((project) => project.checkpointsEnabled).length;
  if (enabledCount === projects.length) {
    return { state: "enabled", effectiveEnabled: true };
  }
  if (enabledCount === 0) {
    return { state: "disabled", effectiveEnabled: false };
  }
  return { state: "mixed", effectiveEnabled: false };
}
