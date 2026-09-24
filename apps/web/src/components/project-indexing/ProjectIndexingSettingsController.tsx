import {
  deriveProjectIndexActions,
  projectIndexingSupported,
  projectIndexScopeKey,
  type ProjectIndexClientApi,
} from "@t3tools/client-runtime/project-indexing";
import {
  resolveProjectIndexSettings,
  type EnvironmentId,
  type ProjectId,
  type ProjectIndexDefaults,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { RotateCwIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { ProjectIndexingSettings } from "../settings/ProjectIndexingSettings";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ProjectIndexEntityBrowser } from "./ProjectIndexEntityBrowser";
import { ProjectIndexModelPicker } from "./ProjectIndexModelPicker";
import { ProjectIndexReview } from "./ProjectIndexReview";
import { useProjectIndexController } from "./useProjectIndexController";
import { useProjectIndexModelCheck } from "./useProjectIndexModelCheck";

export interface ProjectIndexingSettingsControllerProps {
  readonly api: ProjectIndexClientApi;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly projectIndexingVersion?: number;
  readonly projectLabel: string;
  readonly environmentLabel: string;
  readonly workspaceRoot?: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly canOperate?: boolean;
  readonly defaults?: ProjectIndexDefaults;
  readonly onOpenSource: (path: string, line: number | null) => void;
}

function ConnectedProjectIndexingSettings(props: ProjectIndexingSettingsControllerProps) {
  const { message } = useInterfaceTranslator();
  const environmentSettings = useEnvironmentSettings(props.environmentId);
  const scope = useMemo(
    () => ({
      projectId: props.projectId,
      ...(props.threadId ? { threadId: props.threadId } : {}),
    }),
    [props.projectId, props.threadId],
  );
  const { controller, snapshot } = useProjectIndexController(props.api, scope);
  const status = useMemo(
    () =>
      snapshot.status && props.defaults
        ? { ...snapshot.status, defaults: props.defaults }
        : snapshot.status,
    [props.defaults, snapshot.status],
  );
  const effectiveSettings = status
    ? resolveProjectIndexSettings(status.settings, status.defaults)
    : null;
  const selection = effectiveSettings?.modelSelection ?? null;
  const [modelCheckAttempt, setModelCheckAttempt] = useState(0);
  const modelCheck = useProjectIndexModelCheck(
    controller.checkModel,
    status?.settings.reviewEnabled ? selection : null,
    modelCheckAttempt,
  );
  const actions = deriveProjectIndexActions(status);
  const busy = snapshot.pendingAction !== null;
  const canOperate = props.canOperate !== false;
  const reviewModelUnavailableReason =
    selection === null
      ? message(
          status?.defaults ? "projectIndexing.noDefaultModel" : "projectIndexing.modelRequired",
        )
      : modelCheck === null
        ? message("projectIndexing.checkingModel")
        : modelCheck.supported
          ? null
          : (modelCheck.reason ?? message("projectIndexing.modelUnsupported"));
  const run = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };

  if (status === null)
    return (
      <SettingsSection id="knowledge.projectIndexing" title={message("projectIndexing.title")}>
        <div className="space-y-2 px-3 py-4 sm:px-4">
          <p role={snapshot.error ? "alert" : "status"} className="text-sm text-muted-foreground">
            {snapshot.error ?? message("projectIndexing.loading")}
          </p>
          {snapshot.error ? (
            <Button
              size="xs"
              variant="outline"
              disabled={snapshot.loading}
              onClick={() => run(controller.refresh())}
            >
              {message("projectIndexing.retry")}
            </Button>
          ) : null}
        </div>
      </SettingsSection>
    );

  return (
    <div className="space-y-6">
      <ProjectIndexingSettings
        status={status}
        supported
        loading={snapshot.loading}
        busy={busy}
        readOnly={!canOperate}
        error={snapshot.error}
        projectLabel={props.projectLabel}
        environmentLabel={props.environmentLabel}
        {...(props.workspaceRoot === undefined ? {} : { workspaceRoot: props.workspaceRoot })}
        canStart={actions.canStart}
        canRebuild={actions.canRebuild}
        canPause={actions.canPause}
        canResume={actions.canResume}
        canCancel={actions.canCancel}
        canClear={actions.canClear}
        onUpdateSettings={(patch) => {
          if (canOperate) run(controller.updateSettings(patch));
        }}
        onStart={(rebuild) => {
          if (
            canOperate &&
            effectiveSettings?.enabled &&
            (rebuild ? actions.canRebuild : actions.canStart)
          )
            run(controller.start(rebuild));
        }}
        onPause={() => {
          if (canOperate) run(controller.control("pause"));
        }}
        onResume={() => {
          if (canOperate && actions.canResume) run(controller.control("resume"));
        }}
        onCancel={() => {
          if (canOperate) run(controller.control("cancel"));
        }}
        onClear={() => {
          if (canOperate) run(controller.control("clear"));
        }}
        onRetry={() => {
          run(controller.refresh());
        }}
      />
      {effectiveSettings?.enabled ? (
        <div className="px-3 sm:px-4">
          <ProjectIndexEntityBrowser
            api={props.api}
            query={controller.query}
            environmentId={props.environmentId}
            scope={scope}
            revision={status.revision}
            workspaceFingerprint={status.scope.workspaceFingerprint}
            invalidationEpoch={snapshot.invalidationEpoch}
            onRefresh={() => run(controller.refresh())}
            onOpenSource={props.onOpenSource}
          />
        </div>
      ) : null}
      <SettingsSection id="project-ai-diff-review" title={message("projectIndexing.reviewEnabled")}>
        <SettingsRow
          id="knowledge.projectIndexingReview"
          title={message("projectIndexing.enableReview")}
          description={message("projectIndexing.reviewEnabledDescription")}
          control={
            <Switch
              aria-label={message("projectIndexing.reviewEnabled")}
              checked={status.settings.reviewEnabled}
              disabled={!canOperate || busy || snapshot.loading || !effectiveSettings?.enabled}
              onCheckedChange={(reviewEnabled) => {
                if (canOperate && effectiveSettings?.enabled)
                  run(controller.updateSettings({ reviewEnabled }));
              }}
            />
          }
        />
        {effectiveSettings?.enabled && status.settings.reviewEnabled ? (
          <div className="px-3 py-4 sm:px-4">
            <ProjectIndexReview
              api={props.api}
              scope={scope}
              disabled={!canOperate || busy || modelCheck?.supported !== true}
              modelStatus={reviewModelUnavailableReason}
              modelControl={
                <div className="flex flex-wrap items-center gap-2">
                  <ProjectIndexModelPicker
                    selection={selection}
                    settings={environmentSettings}
                    providers={props.providers}
                    disabled={!canOperate || busy}
                    onChange={(modelSelection) => {
                      if (canOperate) run(controller.updateSettings({ modelSelection }));
                    }}
                  />
                  {status.defaults && status.settings.modelSelection !== null ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canOperate || busy}
                      onClick={() => run(controller.updateSettings({ modelSelection: null }))}
                    >
                      {message("projectIndexing.useDefaultModel")}
                    </Button>
                  ) : null}
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={message("projectIndexing.checkModelAgain")}
                    disabled={busy || selection === null || modelCheck === null}
                    onClick={() => setModelCheckAttempt((attempt) => attempt + 1)}
                  >
                    <RotateCwIcon aria-hidden className="size-3.5" />
                  </Button>
                </div>
              }
              onOpenSource={props.onOpenSource}
            />
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );
}

export function ProjectIndexingSettingsController(props: ProjectIndexingSettingsControllerProps) {
  const { message } = useInterfaceTranslator();
  if (!projectIndexingSupported(props)) {
    return (
      <SettingsSection id="project-indexing" title={message("projectIndexing.title")}>
        <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
          {message("projectIndexing.updateServer")}
        </p>
      </SettingsSection>
    );
  }
  return (
    <ConnectedProjectIndexingSettings
      key={projectIndexScopeKey(props, props.environmentId)}
      {...props}
    />
  );
}
