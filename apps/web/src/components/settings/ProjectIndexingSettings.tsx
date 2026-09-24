import type { ProjectIndexSettings, ProjectIndexStatusV1 } from "@t3tools/contracts";
import { useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  ProjectIndexDiagnostics,
  ProjectIndexProgress,
} from "../project-indexing/ProjectIndexProgress";
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
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export interface ProjectIndexingSettingsProps {
  readonly status: ProjectIndexStatusV1 | null;
  readonly supported: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly readOnly?: boolean;
  readonly error: string | null;
  readonly projectLabel: string;
  readonly environmentLabel: string;
  readonly workspaceRoot?: string;
  readonly canStart: boolean;
  readonly canRebuild: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly canClear: boolean;
  readonly onUpdateSettings: (patch: Partial<ProjectIndexSettings>) => void;
  readonly onStart: (rebuild: boolean) => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
  readonly onRetry: () => void;
}

export function ProjectIndexingSettings(props: ProjectIndexingSettingsProps) {
  const { message } = useInterfaceTranslator();
  const [confirmation, setConfirmation] = useState<"rebuild" | "clear" | null>(null);
  const settings = props.status?.settings;
  const disabled =
    props.readOnly === true ||
    props.busy ||
    props.loading ||
    !props.supported ||
    settings === undefined;
  const startDisabled = disabled || !props.canStart;

  return (
    <>
      <SettingsSection
        id="knowledge.projectIndexing"
        title={message("projectIndexing.title")}
        aria-busy={props.loading || props.busy}
      >
        <SettingsRow
          title={message("projectIndexing.scope")}
          description={
            <>
              {props.projectLabel} · {props.environmentLabel}
            </>
          }
        />
        {!props.supported ? (
          <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
            {message("projectIndexing.updateServer")}
          </p>
        ) : (
          <>
            {props.status?.defaults?.enabled === false ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {message("projectIndexing.masterOff")}
              </p>
            ) : null}
            {props.readOnly ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {message("projectIndexing.readOnly")}
              </p>
            ) : null}
            <SettingsRow
              id="project-indexing-enabled"
              title={message("projectIndexing.enabled")}
              description={message("projectIndexing.enabledDescription")}
              control={
                <Switch
                  aria-label={message("projectIndexing.enabled")}
                  checked={settings?.enabled ?? false}
                  disabled={disabled}
                  onCheckedChange={(enabled) => props.onUpdateSettings({ enabled })}
                />
              }
            />
            <div className="space-y-4 px-3 py-4 sm:px-4">
              {props.status ? <ProjectIndexProgress status={props.status} /> : null}
              {props.loading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {message("projectIndexing.loading")}
                </p>
              ) : null}
              {props.error ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p className="break-words text-destructive">{props.error}</p>
                  <Button size="xs" variant="outline" disabled={props.busy} onClick={props.onRetry}>
                    {message("projectIndexing.retry")}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {!props.canPause && !props.canResume ? (
                  <Button size="sm" disabled={startDisabled} onClick={() => props.onStart(false)}>
                    {message(
                      props.status?.state === "failed"
                        ? "projectIndexing.retryIndexing"
                        : "projectIndexing.analyze",
                    )}
                  </Button>
                ) : null}
                {props.canPause ? (
                  <Button size="sm" variant="outline" disabled={disabled} onClick={props.onPause}>
                    {message("projectIndexing.pause")}
                  </Button>
                ) : null}
                {props.canResume ? (
                  <Button size="sm" disabled={disabled} onClick={props.onResume}>
                    {message("projectIndexing.resumeIndexing")}
                  </Button>
                ) : null}
                {props.canCancel ? (
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    disabled={disabled}
                    onClick={props.onCancel}
                  >
                    {message("projectIndexing.cancel")}
                  </Button>
                ) : null}
              </div>
              {props.status ? <ProjectIndexDiagnostics status={props.status} /> : null}
              <details className="rounded-lg border border-border/60 px-3 py-2">
                <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  {message("projectIndexing.maintenance")}
                </summary>
                {props.workspaceRoot ? (
                  <code className="mt-2 block break-all font-mono text-xs text-muted-foreground">
                    {props.workspaceRoot}
                  </code>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={startDisabled || !props.canRebuild}
                    onClick={() => setConfirmation("rebuild")}
                  >
                    {message("projectIndexing.rebuild")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    disabled={disabled || !props.canClear}
                    onClick={() => setConfirmation("clear")}
                  >
                    {message("projectIndexing.clear")}
                  </Button>
                </div>
              </details>
            </div>
          </>
        )}
      </SettingsSection>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {message(
                confirmation === "clear"
                  ? "projectIndexing.clearTitle"
                  : "projectIndexing.rebuildTitle",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {message(
                confirmation === "clear"
                  ? "projectIndexing.clearDescription"
                  : "projectIndexing.rebuildDescription",
                {
                  project: props.projectLabel,
                  environment: props.environmentLabel,
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {message("common.cancel")}
            </AlertDialogClose>
            <Button
              variant={confirmation === "clear" ? "destructive" : "default"}
              disabled={disabled}
              onClick={() => {
                if (confirmation === "clear") props.onClear();
                if (confirmation === "rebuild") props.onStart(true);
                setConfirmation(null);
              }}
            >
              {message(
                confirmation === "clear" ? "projectIndexing.clear" : "projectIndexing.rebuild",
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
