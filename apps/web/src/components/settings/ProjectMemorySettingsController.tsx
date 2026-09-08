import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectMemorySettings, type ProjectMemoryViewModel } from "./ProjectMemorySettings";
import { useSettingsMutation } from "./useSettingsMutation";

export function ProjectMemorySettingsController({
  project,
}: {
  readonly project: { readonly environmentId: EnvironmentId; readonly id: ProjectId };
}) {
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const query = useEnvironmentQuery(serverEnvironment.projectMemoryView(target));
  const updateSettings = useAtomCommand(serverEnvironment.updateProjectMemorySettings);
  const replace = useAtomCommand(serverEnvironment.replaceProjectMemory);
  const importMemory = useAtomCommand(serverEnvironment.importProjectMemory);
  const clear = useAtomCommand(serverEnvironment.clearProjectMemory);
  const mutation = useSettingsMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
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
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      ) : null}
      <ProjectMemorySettings
        {...(viewModel ? { viewModel } : {})}
        busy={mutation.isPending || query.isPending}
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
