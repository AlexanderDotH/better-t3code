import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  DEFAULT_PROJECT_MEMORY_VIEW_MODEL,
  canEditProjectMemory,
  updateProjectMemoryPreferences,
  type ProjectMemoryMode,
  type ProjectMemoryPreferences,
  type ProjectMemoryViewModel,
} from "./ProjectMemorySettings.logic";

export type { ProjectMemoryPreferences, ProjectMemoryViewModel };

type ProjectMemorySettingsProps = {
  readonly viewModel?: ProjectMemoryViewModel;
  readonly busy?: boolean;
  readonly onSavePreferences: (preferences: ProjectMemoryPreferences) => void | Promise<void>;
  readonly onSaveContent: (content: string) => void | Promise<void>;
  readonly onImport: () => void | Promise<void>;
  readonly onExport: () => void | Promise<void>;
  readonly onClear: () => void | Promise<void>;
};

const STATUS_LABELS: Record<ProjectMemoryViewModel["status"], string> = {
  ready: "Ready",
  fallback: "Using T3 home fallback",
  unavailable: "Unavailable",
};

function isProjectMemoryMode(value: string | null): value is ProjectMemoryMode {
  return value === "project" || value === "provider" || value === "off";
}

export function ProjectMemorySettings(props: ProjectMemorySettingsProps) {
  const viewModel = props.viewModel ?? DEFAULT_PROJECT_MEMORY_VIEW_MODEL;
  const [content, setContent] = useState(viewModel.content);
  const [clearOpen, setClearOpen] = useState(false);
  const unavailable = viewModel.status === "unavailable";
  const editable = canEditProjectMemory(viewModel) && !props.busy;

  useEffect(() => setContent(viewModel.content), [viewModel.content]);

  return (
    <>
      <SettingsSection title="Project memory">
        <SettingsRow
          title="Memory source"
          description="Choose the project file, provider-native memory, or disable memory."
          control={
            <Select
              value={viewModel.mode}
              disabled={props.busy || unavailable}
              onValueChange={(value) => {
                if (!isProjectMemoryMode(value)) return;
                void props.onSavePreferences(
                  updateProjectMemoryPreferences(viewModel, { memoryMode: value }),
                );
              }}
            >
              <SelectTrigger aria-label="Memory source" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="project">Project file</SelectItem>
                <SelectItem value="provider">Provider memory</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Allow agent writes"
          description="Let agents update this project's memory file."
          control={
            <Switch
              aria-label="Allow agent writes"
              checked={viewModel.allowAgentWrites}
              disabled={props.busy || unavailable}
              onCheckedChange={(allowAgentWrites) =>
                void props.onSavePreferences(
                  updateProjectMemoryPreferences(viewModel, { allowAgentWrites }),
                )
              }
            />
          }
        />
        <SettingsRow
          title="Effective memory file"
          description={
            viewModel.effectivePath ? (
              <code className="break-all font-mono text-xs">{viewModel.effectivePath}</code>
            ) : (
              "No memory file is available."
            )
          }
          status={STATUS_LABELS[viewModel.status]}
        />
        <SettingsRow
          title="Memory content"
          description="Edit the context shared by future threads in this project."
        >
          <div className="space-y-3 pt-3">
            <Textarea
              aria-label="Project memory content"
              className="min-h-52 font-mono text-sm"
              disabled={!editable}
              value={content}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={props.busy || unavailable || viewModel.mode !== "project"}
                onClick={() => void props.onImport()}
              >
                Import
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={props.busy || unavailable}
                onClick={() => void props.onExport()}
              >
                Export
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={props.busy || unavailable || viewModel.mode !== "project"}
                onClick={() => setClearOpen(true)}
              >
                Clear
              </Button>
              <Button
                type="button"
                disabled={!editable || content === viewModel.content}
                onClick={() => void props.onSaveContent(content)}
              >
                Save
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear project memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the current project memory content and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setClearOpen(false);
                void props.onClear();
              }}
            >
              Clear memory
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
