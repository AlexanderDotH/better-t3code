export type ProjectMemoryMode = "project" | "provider" | "off";

export type ProjectMemoryPreferences = {
  readonly memoryMode: ProjectMemoryMode;
  readonly allowAgentWrites: boolean;
};

export type ProjectMemoryViewModel = {
  readonly mode: ProjectMemoryMode;
  readonly allowAgentWrites: boolean;
  readonly effectivePath: string;
  readonly content: string;
  readonly status: "ready" | "fallback" | "unavailable";
};

export const DEFAULT_PROJECT_MEMORY_VIEW_MODEL: ProjectMemoryViewModel = {
  mode: "project",
  allowAgentWrites: false,
  effectivePath: "",
  content: "",
  status: "unavailable",
};

export function updateProjectMemoryPreferences(
  viewModel: ProjectMemoryViewModel,
  patch: Partial<ProjectMemoryPreferences>,
): ProjectMemoryPreferences {
  return {
    memoryMode: patch.memoryMode ?? viewModel.mode,
    allowAgentWrites: patch.allowAgentWrites ?? viewModel.allowAgentWrites,
  };
}

export function canEditProjectMemory(viewModel: ProjectMemoryViewModel): boolean {
  return viewModel.status !== "unavailable" && viewModel.mode === "project";
}

export function projectMemoryClearActions(onClear: () => void | Promise<void>) {
  return [
    { text: "Cancel", style: "cancel" as const },
    {
      text: "Clear memory",
      style: "destructive" as const,
      onPress: () => void onClear(),
    },
  ];
}
