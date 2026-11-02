import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useState } from "react";
import { ProjectMemorySettings, type ProjectMemoryViewModel } from "./ProjectMemorySettings";
import { useSettingsCommand, useSettingsMutation } from "./useSettingsMutation";

export function ProjectMemorySettingsController({
  project,
  readOnly = false,
}: {
  readonly project: { readonly environmentId: EnvironmentId; readonly id: ProjectId };
  readonly readOnly?: boolean;
}) {
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const query = useEnvironmentQuery(serverEnvironment.projectMemoryView(target));
  const updateSettings = useSettingsCommand(serverEnvironment.updateProjectMemorySettings);
  const replace = useSettingsCommand(serverEnvironment.replaceProjectMemory);
  const importMemory = useSettingsCommand(serverEnvironment.importProjectMemory);
  const clear = useSettingsCommand(serverEnvironment.clearProjectMemory);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mutation = useSettingsMutation({
    mutationFn: async (operation: () => Promise<unknown>) => {
      if (!readOnly) await operation();
    },
    onMutate: () => setMutationError(null),
    onSuccess: () => query.refresh(),
    onError: (error) =>
      setMutationError(error instanceof Error ? error.message : "Could not update project memory."),
  });
  const viewModel: ProjectMemoryViewModel | undefined = query.data
    ? {
        mode: query.data.settings.memoryMode,
        allowAgentWrites: query.data.settings.allowAgentWrites,
        effectivePath: query.data.effectivePath ?? "",
        content: query.data.rawMarkdown,
        status:
          query.data.status === "active" && query.data.storage === "fallback"
            ? "fallback"
            : "ready",
      }
    : undefined;

  return (
    <>
      {query.error || mutationError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutationError ?? query.error}
        </p>
      ) : null}
      <ProjectMemorySettings
        key={`${project.environmentId}:${project.id}:${query.dataUpdatedAt}`}
        {...(viewModel ? { viewModel } : {})}
        busy={readOnly || mutation.isPending || query.isPending}
        onSavePreferences={(preferences) =>
          mutation.mutate(() =>
            updateSettings({
              ...target,
              input: { ...target.input, ...preferences },
            }),
          )
        }
        onSaveContent={(markdown) =>
          mutation.mutate(() =>
            replace({
              ...target,
              input: { ...target.input, markdown },
            }),
          )
        }
        onImport={() => mutation.mutate(() => importMemory(target))}
        onClear={() => mutation.mutate(() => clear(target))}
        onExport={() => {
          if (!viewModel) return;
          const url = URL.createObjectURL(new Blob([viewModel.content], { type: "text/markdown" }));
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "MEMORY.md";
          anchor.click();
          URL.revokeObjectURL(url);
        }}
      />
    </>
  );
}
