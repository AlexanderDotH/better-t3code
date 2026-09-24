import {
  projectIndexingSupported,
  projectIndexingDefaultsSupported,
  projectIndexScopeKey,
} from "@t3tools/client-runtime/project-indexing";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { useState } from "react";

import { isElectron } from "../../env";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useProjects, useThreadShells } from "../../state/entities";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { bindProjectIndexApi } from "../../state/projectIndexing";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { environmentShell } from "../../state/shell";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ProjectIndexSourceDialog } from "./ProjectIndexSourceDialog";
import { ProjectIndexingSettingsController } from "./ProjectIndexingSettingsController";
import { initialProjectIndexScope, projectIndexWorktrees } from "./projectIndexingScope";

export interface ProjectIndexingSettingsSectionProps {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly threadId?: ThreadId;
}

const PROJECT_WORKSPACE = "project-root";

function SelectedProjectIndexing(props: {
  readonly environment: EnvironmentPresentation;
  readonly project: EnvironmentProject;
  readonly thread: EnvironmentThreadShell | null;
}) {
  const { message } = useInterfaceTranslator();
  const shell = useAtomValue(environmentShell.stateValueAtom(props.environment.environmentId));
  const localDesktop =
    isElectron && props.environment.entry.target._tag === "PrimaryConnectionTarget";
  const session = useEnvironmentQuery(
    localDesktop ? null : environmentSession.sessionStateAtom(props.environment.environmentId),
  );
  const canRead =
    localDesktop ||
    (session.data?.authenticated === true &&
      session.data.scopes?.includes(AuthOrchestrationReadScope) === true);
  const canOperate =
    localDesktop ||
    (session.data?.authenticated === true &&
      session.data.scopes?.includes(AuthOrchestrationOperateScope) === true);
  const [source, setSource] = useState<{
    readonly path: string;
    readonly line: number | null;
  } | null>(null);
  // Preserve searches and picker state while this authorized scope revalidates.
  const [initialized, setInitialized] = useState(false);
  const workspaceRoot = props.thread?.worktreePath ?? props.project.workspaceRoot;
  const shellError = Option.getOrNull(shell.error);
  const accessError = localDesktop ? null : session.error;
  const accessDenied = !localDesktop && session.data !== null && !canRead;
  const refreshing = shell.status !== "live" || (!localDesktop && session.data === null);

  if (accessDenied || accessError !== null || shellError !== null) {
    if (initialized) setInitialized(false);
    if (source !== null) setSource(null);
    return (
      <div className="space-y-2 px-3 text-sm text-muted-foreground sm:px-4">
        <p role="alert">
          {accessError ?? shellError ?? message("projectIndexing.readUnavailable")}
        </p>
        {accessError ? (
          <Button size="xs" variant="outline" onClick={session.refresh}>
            {message("projectIndexing.retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!initialized && refreshing) {
    return (
      <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
        {message("common.loading")}
      </p>
    );
  }
  if (!initialized) setInitialized(true);

  return (
    <>
      {refreshing ? (
        <p role="status" className="px-3 text-xs text-muted-foreground sm:px-4">
          {message("common.loading")}
        </p>
      ) : null}
      <div inert={refreshing} aria-busy={refreshing}>
        <ProjectIndexingSettingsController
          api={bindProjectIndexApi(props.environment.environmentId)}
          environmentId={props.environment.environmentId}
          projectId={props.project.id}
          {...(props.thread ? { threadId: props.thread.id } : {})}
          projectIndexingVersion={
            props.environment.serverConfig?.environment.capabilities.projectIndexingVersion ?? 0
          }
          projectLabel={props.project.title}
          environmentLabel={props.environment.label}
          workspaceRoot={workspaceRoot}
          providers={props.environment.serverConfig?.providers ?? []}
          canOperate={canOperate && !refreshing}
          {...(projectIndexingDefaultsSupported(
            props.environment.serverConfig?.environment.capabilities,
          ) && props.environment.serverConfig
            ? {
                defaults: {
                  enabled: props.environment.serverConfig.settings.projectIndexingEnabled,
                  modelSelection:
                    props.environment.serverConfig.settings.projectIndexingDefaultModelSelection,
                },
              }
            : {})}
          onOpenSource={(path, line) => {
            if (!refreshing) setSource({ path, line });
          }}
        />
      </div>
      {source ? (
        <ProjectIndexSourceDialog
          key={`${source.path}:${source.line}`}
          environmentId={props.environment.environmentId}
          environmentLabel={props.environment.label}
          workspaceRoot={workspaceRoot}
          path={source.path}
          line={source.line}
          onClose={() => setSource(null)}
        />
      ) : null}
    </>
  );
}

function ProjectIndexScopeSelector(
  props: ProjectIndexingSettingsSectionProps & { readonly projectBound?: boolean },
) {
  const { message } = useInterfaceTranslator();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<EnvironmentId | null>(
    props.environmentId ?? null,
  );
  const [selection, setSelection] = useState<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId | null;
    readonly threadId: ThreadId | null;
  } | null>(null);
  const initialEnvironmentId =
    props.environmentId ??
    primaryEnvironmentId ??
    environments.find((environment) => environment.connection.phase === "connected")
      ?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const environmentId = requestedEnvironmentId ?? initialEnvironmentId;
  const environment =
    environments.find((candidate) => candidate.environmentId === environmentId) ?? null;
  const matchingProjects = projects
    .filter((project) => project.environmentId === environmentId)
    .toSorted((left, right) => left.title.localeCompare(right.title));
  const requestedScope =
    environmentId === null
      ? { projectId: null, threadId: null }
      : selection?.environmentId === environmentId
        ? selection
        : initialProjectIndexScope({
            environmentId,
            projects: matchingProjects,
            threads,
            ...(props.projectId && initialEnvironmentId === environmentId
              ? { projectId: props.projectId }
              : {}),
            ...(props.threadId && initialEnvironmentId === environmentId
              ? { threadId: props.threadId }
              : {}),
          });
  const project =
    matchingProjects.find((candidate) => candidate.id === requestedScope.projectId) ?? null;
  const worktrees = environmentId
    ? projectIndexWorktrees(threads, environmentId, project?.id ?? null)
    : [];
  const thread = worktrees.find((candidate) => candidate.id === requestedScope.threadId) ?? null;
  const missingWorktree = requestedScope.threadId !== null && thread === null;
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const supported = projectIndexingSupported(environment?.serverConfig?.environment.capabilities);

  return (
    <div className="space-y-6" id="better-t3-project-indexing">
      <SettingsSection
        title={message(
          props.projectBound ? "projectIndexing.scope" : "projectIndexing.selectProject",
        )}
      >
        {!props.projectBound ? (
          <SettingsRow
            title={message("settings.betterT3.environmentScope")}
            control={
              <Select
                value={environmentId}
                onValueChange={(id) => {
                  const next = environments.find((candidate) => candidate.environmentId === id);
                  if (next) {
                    setRequestedEnvironmentId(next.environmentId);
                    setSelection(null);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-64"
                  aria-label={message("settings.betterT3.selectEnvironment")}
                >
                  <SelectValue>
                    {environment?.label ?? message("settings.betterT3.selectEnvironment")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((candidate) => (
                    <SelectItem key={candidate.environmentId} value={candidate.environmentId}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        {!props.projectBound ? (
          <SettingsRow
            title={message("settings.projects.detail.section.project")}
            control={
              <Select
                value={project?.id ?? null}
                disabled={matchingProjects.length === 0}
                onValueChange={(id) => {
                  const next = matchingProjects.find((candidate) => candidate.id === id);
                  if (next)
                    setSelection({
                      environmentId: next.environmentId,
                      projectId: next.id,
                      threadId: null,
                    });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-64"
                  aria-label={message("settings.projects.detail.section.project")}
                >
                  <SelectValue>
                    {project?.title ?? message("projectIndexing.selectProject")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {matchingProjects.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        {project ? (
          <SettingsRow
            title={message("projectIndexing.scope")}
            control={
              <Select
                value={
                  requestedScope.threadId ? `thread:${requestedScope.threadId}` : PROJECT_WORKSPACE
                }
                onValueChange={(value) => {
                  const nextThread = worktrees.find(
                    (candidate) => `thread:${candidate.id}` === value,
                  );
                  if (value === PROJECT_WORKSPACE || nextThread)
                    setSelection({
                      environmentId: project.environmentId,
                      projectId: project.id,
                      threadId: nextThread?.id ?? null,
                    });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-64"
                  aria-label={message("projectIndexing.scope")}
                >
                  <SelectValue>
                    {missingWorktree
                      ? message("projectIndexing.scopeChanged")
                      : thread
                        ? `${thread.title}${thread.branch ? ` · ${thread.branch}` : ""}`
                        : message("projectIndexing.projectScope")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={PROJECT_WORKSPACE}>
                    {message("projectIndexing.projectScope")}
                  </SelectItem>
                  {worktrees.map((candidate) => (
                    <SelectItem key={candidate.id} value={`thread:${candidate.id}`}>
                      {candidate.title}
                      {candidate.branch ? ` · ${candidate.branch}` : ""}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>
      {!connected ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          {message("settings.betterT3.noEnvironment")}
        </p>
      ) : !supported ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          {message("projectIndexing.updateServer")}
        </p>
      ) : missingWorktree ? (
        <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
          {message("projectIndexing.scopeChanged")}
        </p>
      ) : !project ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          {message(
            matchingProjects.length === 0
              ? "projectIndexing.noProjects"
              : "projectIndexing.selectProjectFirst",
          )}
        </p>
      ) : environment ? (
        <SelectedProjectIndexing
          key={JSON.stringify([
            projectIndexScopeKey(
              { projectId: project.id, ...(thread ? { threadId: thread.id } : {}) },
              environment.environmentId,
            ),
            thread?.worktreePath ?? project.workspaceRoot,
          ])}
          environment={environment}
          project={project}
          thread={thread}
        />
      ) : null}
    </div>
  );
}

export function ProjectIndexingSettingsSection(props: ProjectIndexingSettingsSectionProps) {
  return (
    <ProjectIndexScopeSelector
      key={JSON.stringify([props.environmentId, props.projectId, props.threadId])}
      {...props}
    />
  );
}

export function ProjectIndexingProjectSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
}) {
  return (
    <ProjectIndexScopeSelector
      key={JSON.stringify([props.environmentId, props.projectId, props.threadId])}
      {...props}
      projectBound
    />
  );
}
