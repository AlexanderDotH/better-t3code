import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import {
  resolveProjectIndexSettings,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProjectIndexEntityBrowser } from "../project-indexing/ProjectIndexEntityBrowser";
import { ProjectIndexProgress } from "../project-indexing/ProjectIndexProgress";
import { useProjectIndexController } from "../project-indexing/useProjectIndexController";
import { Button } from "../ui/button";

export function ProjectIndexGraphPanelController(props: {
  readonly api: ProjectIndexClientApi;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly onOpenSource: (path: string, line: number | null) => void;
  readonly onOpenSettings?: (() => void) | undefined;
}) {
  const { message } = useInterfaceTranslator();
  const scope = useMemo(
    () => ({
      projectId: props.projectId,
      ...(props.threadId ? { threadId: props.threadId } : {}),
    }),
    [props.projectId, props.threadId],
  );
  const { controller, snapshot } = useProjectIndexController(props.api, scope);
  const status = snapshot.status;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{message("projectIndexing.graph")}</h2>
          <p className="text-xs text-muted-foreground">
            {message("projectIndexing.graphDescription")}
          </p>
        </div>
        {props.onOpenSettings ? (
          <Button size="xs" variant="outline" onClick={props.onOpenSettings}>
            {message("projectIndexing.openSettings")}
          </Button>
        ) : null}
      </div>
      {snapshot.error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="break-words text-destructive">{snapshot.error}</p>
          <Button
            size="xs"
            variant="outline"
            disabled={snapshot.loading}
            onClick={() => void controller.refresh().catch(() => undefined)}
          >
            {message("projectIndexing.retry")}
          </Button>
        </div>
      ) : null}
      {status === null && snapshot.error === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message("projectIndexing.loading")}
        </p>
      ) : null}
      {status ? <ProjectIndexProgress status={status} /> : null}
      {status && resolveProjectIndexSettings(status.settings, status.defaults).enabled ? (
        <ProjectIndexEntityBrowser
          api={props.api}
          query={controller.query}
          environmentId={props.environmentId}
          scope={scope}
          revision={status.revision}
          workspaceFingerprint={status.scope.workspaceFingerprint}
          invalidationEpoch={snapshot.invalidationEpoch}
          onRefresh={() => void controller.refresh().catch(() => undefined)}
          onOpenSource={props.onOpenSource}
        />
      ) : status ? (
        <p className="py-4 text-sm text-muted-foreground">
          {message(
            status.defaults?.enabled === false
              ? "projectIndexing.masterOff"
              : "projectIndexing.graphDisabled",
          )}
        </p>
      ) : null}
    </div>
  );
}
