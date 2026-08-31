import { useEffect, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
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

const STATUS_MESSAGE_KEYS = {
  ready: "settings.projects.memory.status.ready",
  fallback: "settings.projects.memory.status.fallback",
  unavailable: "settings.projects.memory.status.unavailable",
} as const satisfies Record<ProjectMemoryViewModel["status"], string>;

function isProjectMemoryMode(value: string | null): value is ProjectMemoryMode {
  return value === "project" || value === "provider" || value === "off";
}

export function ProjectMemorySettings(props: ProjectMemorySettingsProps) {
  const translator = useInterfaceTranslator();
  const viewModel = props.viewModel ?? DEFAULT_PROJECT_MEMORY_VIEW_MODEL;
  const [content, setContent] = useState(viewModel.content);
  const [clearOpen, setClearOpen] = useState(false);
  const unavailable = viewModel.status === "unavailable";
  const editable = canEditProjectMemory(viewModel) && !props.busy;

  useEffect(() => setContent(viewModel.content), [viewModel.content]);

  return (
    <>
      <SettingsSection title={translator.message("settings.projects.memory.title")}>
        <SettingsRow
          title={translator.message("settings.projects.memory.source")}
          description={translator.message("settings.projects.memory.sourceDescription")}
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
              <SelectTrigger
                aria-label={translator.message("settings.projects.memory.source")}
                className="w-full sm:w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="project">
                  {translator.message("settings.projects.memory.source.project")}
                </SelectItem>
                <SelectItem value="provider">
                  {translator.message("settings.projects.memory.source.provider")}
                </SelectItem>
                <SelectItem value="off">
                  {translator.message("settings.projects.memory.source.off")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title={translator.message("settings.projects.memory.allowAgentWrites")}
          description={translator.message("settings.projects.memory.allowAgentWritesDescription")}
          control={
            <Switch
              aria-label={translator.message("settings.projects.memory.allowAgentWrites")}
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
          title={translator.message("settings.projects.memory.effectiveFile")}
          description={
            viewModel.effectivePath ? (
              <code className="break-all font-mono text-xs">{viewModel.effectivePath}</code>
            ) : (
              translator.message("settings.projects.memory.noFile")
            )
          }
          status={translator.message(STATUS_MESSAGE_KEYS[viewModel.status])}
        />
        <SettingsRow
          title={translator.message("settings.projects.memory.contentTitle")}
          description={translator.message("settings.projects.memory.contentDescription")}
        >
          <div className="space-y-3 pt-3">
            <Textarea
              aria-label={translator.message("settings.projects.memory.content")}
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
                {translator.message("settings.projects.memory.import")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={props.busy || unavailable}
                onClick={() => void props.onExport()}
              >
                {translator.message("settings.projects.memory.export")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={props.busy || unavailable || viewModel.mode !== "project"}
                onClick={() => setClearOpen(true)}
              >
                {translator.message("settings.projects.memory.clear")}
              </Button>
              <Button
                type="button"
                disabled={!editable || content === viewModel.content}
                onClick={() => void props.onSaveContent(content)}
              >
                {translator.message("settings.projects.memory.save")}
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {translator.message("settings.projects.memory.clearTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {translator.message("settings.projects.memory.clearDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {translator.message("common.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setClearOpen(false);
                void props.onClear();
              }}
            >
              {translator.message("settings.projects.memory.clearAction")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
