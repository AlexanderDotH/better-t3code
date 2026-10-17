import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import {
  deepPlanSourceRefKey,
  loadDeepPlanSourceCatalog,
} from "@t3tools/client-runtime/deep-planning";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { Project, ThreadShell } from "../types";
import type { EnvironmentPresentation } from "../state/environments";
import type { DeepPlanSourceOption } from "../components/chat/DeepPlanSourcePicker";
import { getWebDeepPlanningApi } from "../state/deepPlanning";
import { environmentThreadShells } from "../state/threads";

const EMPTY_THREAD_SHELLS_ATOM = Atom.make<readonly ThreadShell[]>([]);

interface SourceCatalogState {
  readonly scopeKey: string;
  readonly requestKey: string;
  readonly options: readonly DeepPlanSourceOption[];
  readonly projectSourceCount: number | null;
  readonly error: string | null;
}

export function useDeepPlanSources(input: {
  readonly enabled: boolean;
  readonly currentProject: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  } | null;
  readonly projects: readonly Project[];
  readonly environments: readonly EnvironmentPresentation[];
}) {
  const [requestAll, setRequestAll] = useState(0);
  const threadShells = useAtomValue(
    input.enabled ? environmentThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS_ATOM,
  );
  const scopeKey = input.currentProject
    ? JSON.stringify([input.currentProject.environmentId, input.currentProject.projectId])
    : "";
  const [state, setState] = useState<SourceCatalogState>({
    scopeKey: "",
    requestKey: "",
    options: [],
    projectSourceCount: null,
    error: null,
  });
  const environmentsById = useMemo(
    () =>
      new Map(input.environments.map((environment) => [environment.environmentId, environment])),
    [input.environments],
  );
  const projectsByRef = useMemo(
    () =>
      new Map(
        input.projects.map((project) => [
          JSON.stringify([project.environmentId, project.id]),
          project,
        ]),
      ),
    [input.projects],
  );
  const targets = useMemo(
    () =>
      input.projects.map((project) => {
        const environment = environmentsById.get(project.environmentId);
        return {
          environmentId: project.environmentId,
          projectId: project.id,
          label: environment?.label ?? String(project.environmentId),
          connected: environment?.connection.phase === "connected",
          supported:
            environment?.serverConfig?.environment.capabilities.deepPlanning?.version === 1 &&
            environment.serverConfig.environment.capabilities.deepPlanning.sourceExport,
        };
      }),
    [input.projects, environmentsById],
  );
  const fallbackOptions = useMemo(
    () =>
      threadShells.map((thread) => {
        const environment = environmentsById.get(thread.environmentId);
        const project = projectsByRef.get(JSON.stringify([thread.environmentId, thread.projectId]));
        return {
          ref: {
            environmentId: thread.environmentId,
            projectId: thread.projectId,
            threadId: thread.id,
          },
          title: thread.title,
          projectTitle: project?.title ?? String(thread.projectId),
          environmentLabel: environment?.label ?? String(thread.environmentId),
          archived: thread.archivedAt !== null,
          available:
            environment?.connection.phase === "connected" &&
            environment.serverConfig?.environment.capabilities.deepPlanning?.version === 1 &&
            environment.serverConfig.environment.capabilities.deepPlanning.sourceExport,
        };
      }),
    [threadShells, environmentsById, projectsByRef],
  );
  const currentEnvironmentId = input.currentProject?.environmentId;
  const currentProjectId = input.currentProject?.projectId;
  const requestKey = JSON.stringify([scopeKey, requestAll, targets]);

  useEffect(() => {
    if (!input.enabled || !currentEnvironmentId || !currentProjectId) return;
    const controller = new AbortController();
    const requested =
      requestAll > 0
        ? targets.filter((target) => target.connected && target.supported)
        : targets.filter(
            (target) =>
              target.environmentId === currentEnvironmentId &&
              target.projectId === currentProjectId,
          );
    void Promise.allSettled(
      requested.map(async (target) => ({
        target,
        catalog: await loadDeepPlanSourceCatalog({
          environmentId: target.environmentId,
          projectId: target.projectId,
          api: getWebDeepPlanningApi(target.environmentId),
          signal: controller.signal,
        }),
      })),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const options: DeepPlanSourceOption[] = [];
      const errors: string[] = [];
      let projectSourceCount: number | null = null;
      for (const result of results) {
        if (result.status === "rejected") {
          errors.push(
            result.reason instanceof Error
              ? result.reason.message
              : "Source metadata is unavailable.",
          );
          continue;
        }
        const { target, catalog } = result.value;
        if (target.environmentId === currentEnvironmentId && target.projectId === currentProjectId)
          projectSourceCount = catalog.sources.length;
        options.push(
          ...catalog.sources.map((source) => ({
            ref: source.origin,
            environmentLabel: target.label,
            projectTitle: source.projectTitle,
            title: source.threadTitle,
            archived: source.archived,
            available: target.connected,
          })),
        );
      }
      setState({
        scopeKey,
        requestKey,
        options,
        projectSourceCount,
        error: errors.length > 0 ? errors.join("\n") : null,
      });
    });
    return () => controller.abort();
  }, [
    input.enabled,
    currentEnvironmentId,
    currentProjectId,
    requestAll,
    targets,
    scopeKey,
    requestKey,
  ]);

  const onOpen = useCallback(() => setRequestAll((value) => value + 1), []);
  const options = useMemo(
    () => [
      ...new Map(
        [...fallbackOptions, ...(state.scopeKey === scopeKey ? state.options : [])].map(
          (option) => {
            const environment = environmentsById.get(option.ref.environmentId);
            return [
              deepPlanSourceRefKey(option.ref),
              {
                ...option,
                available:
                  environment?.connection.phase === "connected" &&
                  environment.serverConfig?.environment.capabilities.deepPlanning?.version === 1 &&
                  environment.serverConfig.environment.capabilities.deepPlanning.sourceExport,
              },
            ] as const;
          },
        ),
      ).values(),
    ],
    [fallbackOptions, state.scopeKey, state.options, scopeKey, environmentsById],
  );
  return {
    options,
    projectSourceCount: state.scopeKey === scopeKey ? state.projectSourceCount : null,
    loading: input.enabled && state.requestKey !== requestKey,
    error: state.scopeKey === scopeKey ? state.error : null,
    onOpen,
  };
}
