import {
  PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  PROJECT_INDEX_MAX_VISIBLE_CALLSITES,
  PROJECT_INDEX_MAX_VISIBLE_ENTITIES,
  PROJECT_INDEX_MIN_QUERY_TOKENS,
  resolveProjectIndexSettings,
  type ProjectCallsiteV1,
  ProjectContextInput,
  type ProjectEntityV1,
  type ProjectIndexControlAction,
  type ProjectIndexActivityEvent,
  type ProjectIndexActivityV1,
  type ProjectIndexControlInput,
  type ProjectIndexGetSettingsInput,
  type ProjectIndexGetStatusInput,
  type ProjectIndexModelCheckInput,
  type ProjectIndexModelCheckResult,
  type ProjectIndexModelSelection,
  type ProjectIndexQueryInput,
  type ProjectIndexQueryResultV1,
  type ProjectIndexReviewInput,
  type ProjectIndexReviewResultV1,
  type ProjectIndexScopeInput,
  type ProjectIndexSettings,
  type ProjectIndexSettingsPatch,
  type ProjectIndexStartInput,
  type ProjectIndexState,
  type ProjectIndexStatusV1,
  type ProjectIndexStreamEvent,
  type ProjectIndexSubscribeInput,
  type ProjectIndexUpdateSettingsInput,
  type ProjectIndexUsageV1,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeProjectContext = Schema.decodeUnknownSync(ProjectContextInput);

export interface ProjectIndexClientApi {
  readonly getSettings: (input: ProjectIndexGetSettingsInput) => Promise<ProjectIndexSettings>;
  readonly getStatus: (input: ProjectIndexGetStatusInput) => Promise<ProjectIndexStatusV1>;
  readonly updateSettings: (
    input: ProjectIndexUpdateSettingsInput,
  ) => Promise<ProjectIndexStatusV1>;
  readonly start: (input: ProjectIndexStartInput) => Promise<ProjectIndexStatusV1>;
  readonly control: (input: ProjectIndexControlInput) => Promise<ProjectIndexStatusV1>;
  readonly query: (input: ProjectIndexQueryInput) => Promise<ProjectIndexQueryResultV1>;
  readonly checkModel: (
    input: ProjectIndexModelCheckInput,
  ) => Promise<ProjectIndexModelCheckResult>;
  readonly review?: (input: ProjectIndexReviewInput) => Promise<ProjectIndexReviewResultV1>;
  readonly subscribe: (
    input: ProjectIndexSubscribeInput,
    listener: (event: ProjectIndexStreamEvent) => void,
  ) => () => void;
}

export interface ProjectIndexClientState {
  readonly status: ProjectIndexStatusV1 | null;
  readonly queryResult: ProjectIndexQueryResultV1 | null;
  readonly invalidated: boolean;
  readonly invalidatedRevision?: number | undefined;
}

export const EMPTY_PROJECT_INDEX_CLIENT_STATE: ProjectIndexClientState = {
  status: null,
  queryResult: null,
  invalidated: false,
};

export function projectIndexingSupported(
  capabilities: { readonly projectIndexingVersion?: number } | null | undefined,
): boolean {
  return (capabilities?.projectIndexingVersion ?? 0) >= 3;
}

export function projectIndexingDefaultsSupported(
  capabilities: { readonly projectIndexingDefaultsVersion?: number } | null | undefined,
): boolean {
  return (capabilities?.projectIndexingDefaultsVersion ?? 0) >= 1;
}

/** Pass the environment ID when the key is stored outside an environment-scoped cache. */
export function projectIndexScopeKey(scope: ProjectIndexScopeInput, environmentId = ""): string {
  return JSON.stringify([environmentId, scope.projectId, scope.threadId ?? null]);
}

export function applyProjectIndexStreamEvent(
  current: ProjectIndexClientState,
  event: ProjectIndexStreamEvent,
): ProjectIndexClientState {
  const status = current.status;
  if (event.type === "invalidate") {
    if (status && (event.scopeId !== status.scope.scopeId || event.revision < status.revision)) {
      return current;
    }
    return {
      ...current,
      queryResult: null,
      invalidated: true,
      invalidatedRevision: Math.max(current.invalidatedRevision ?? 0, event.revision),
    };
  }

  const incoming = event.status;
  const enabled = resolveProjectIndexSettings(incoming.settings, incoming.defaults).enabled;
  const sameScope =
    status?.scope.scopeId === incoming.scope.scopeId &&
    status.scope.workspaceFingerprint === incoming.scope.workspaceFingerprint;
  if (
    sameScope &&
    status &&
    (incoming.revision < status.revision ||
      (incoming.revision === status.revision && incoming.updatedAt < status.updatedAt))
  )
    return current;

  const queryMatches =
    current.queryResult !== null &&
    current.queryResult.scope.scopeId === incoming.scope.scopeId &&
    current.queryResult.scope.workspaceFingerprint === incoming.scope.workspaceFingerprint &&
    current.queryResult.revision === incoming.revision &&
    enabled;
  return {
    status: incoming,
    queryResult: queryMatches ? current.queryResult : null,
    invalidated:
      sameScope &&
      enabled &&
      (current.invalidated || (current.queryResult !== null && !queryMatches)),
    invalidatedRevision: sameScope && enabled ? current.invalidatedRevision : undefined,
  };
}

export function applyProjectIndexQueryResult(
  current: ProjectIndexClientState,
  result: ProjectIndexQueryResultV1,
): ProjectIndexClientState {
  const status = current.status;
  if (current.invalidatedRevision !== undefined && result.revision < current.invalidatedRevision)
    return current;
  if (
    status &&
    (!resolveProjectIndexSettings(status.settings, status.defaults).enabled ||
      status.scope.scopeId !== result.scope.scopeId ||
      status.scope.workspaceFingerprint !== result.scope.workspaceFingerprint ||
      status.revision !== result.revision)
  )
    return current;
  return {
    status: current.status,
    queryResult: result,
    invalidated: false,
    invalidatedRevision: undefined,
  };
}

export function deriveProjectIndexActions(status: ProjectIndexStatusV1 | null) {
  const effective = status ? resolveProjectIndexSettings(status.settings, status.defaults) : null;
  const enabled = effective?.enabled === true;
  const jobState = status?.job?.state;
  const running =
    jobState === "running" ||
    jobState === "queued" ||
    status?.state === "queued" ||
    status?.state === "discovering" ||
    status?.state === "extracting" ||
    status?.state === "analyzing" ||
    status?.state === "updating" ||
    status?.state === "waiting-for-provider" ||
    status?.state === "waiting-for-resources";
  const paused = status?.state === "paused" || jobState === "paused";
  const hasIndex = (status?.coverage.indexedFiles ?? 0) > 0 || (status?.revision ?? 0) > 0;
  return {
    canStart: enabled && !running && !paused,
    canRebuild: enabled && !running && !paused && hasIndex,
    canPause: enabled && running,
    canResume: enabled && paused,
    canCancel: running || paused,
    canClear: status !== null && (hasIndex || status.job !== null),
    needsModel: false,
    resumeModelChanged: false,
  };
}

function projectIndexChatTone(state: ProjectIndexState): "active" | "ready" | "attention" | "idle" {
  switch (state) {
    case "ready":
    case "partial":
      return "ready";
    case "queued":
    case "discovering":
    case "extracting":
    case "analyzing":
    case "updating":
      return "active";
    case "disabled":
    case "waiting-for-provider":
    case "waiting-for-resources":
    case "paused":
    case "cancelled":
    case "failed":
      return "attention";
    default:
      return "idle";
  }
}

export function deriveProjectIndexStage(
  status: ProjectIndexStatusV1 | ProjectIndexActivityV1,
): ProjectIndexState | "resolving" {
  const state = status.defaults?.enabled === false ? "disabled" : status.state;
  return status.job?.phase === "validation" && (state === "extracting" || state === "updating")
    ? "resolving"
    : state;
}

export function deriveProjectIndexChatStatus(
  status: ProjectIndexStatusV1 | ProjectIndexActivityV1 | null,
) {
  if (status === null || !status.settings.enabled) return null;

  const state = status.defaults?.enabled === false ? "disabled" : status.state;
  const job = status.job;
  const analysisTotal = job
    ? job.units.completed +
      job.units.pending +
      job.units.running +
      job.units.failed +
      job.units.stale +
      job.units.cancelled
    : 0;

  return {
    state,
    stage: deriveProjectIndexStage(status),
    tone: projectIndexChatTone(state),
    indexedFiles: status.coverage.indexedFiles,
    eligibleFiles: status.coverage.eligibleFiles,
    analysisUnits:
      job?.phase === "analysis" &&
      analysisTotal > 0 &&
      ["analyzing", "waiting-for-provider", "waiting-for-resources", "paused"].includes(state)
        ? { completed: job.units.completed, total: analysisTotal }
        : null,
    openSettings: state === "disabled",
  };
}

export function applyProjectIndexActivityEvent(
  current: ReadonlyMap<string, ProjectIndexActivityV1>,
  event: ProjectIndexActivityEvent,
): ReadonlyMap<string, ProjectIndexActivityV1> {
  if (event.type === "snapshot")
    return new Map(
      event.activities
        .filter((activity) => activity.settings.enabled)
        .map((activity) => [activity.scope.scopeId, activity]),
    );

  const { activity } = event;
  const previous = current.get(activity.scope.scopeId);
  if (previous && previous.updatedAt > activity.updatedAt) return current;
  if (!activity.settings.enabled && !previous) return current;
  const next = new Map(current);
  if (activity.settings.enabled) next.set(activity.scope.scopeId, activity);
  else next.delete(activity.scope.scopeId);
  return next;
}

export function formatProjectIndexUsage(usage: ProjectIndexUsageV1): string {
  if (usage.usageStatus === "unavailable") return "Token usage unavailable";
  const input = usage.inputTokens?.toLocaleString() ?? "unknown";
  const output = usage.outputTokens?.toLocaleString() ?? "unknown";
  return `${input} input · ${output} output tokens${usage.usageStatus === "partial" ? " (partial)" : ""}`;
}

export function normalizeProjectIndexTokenBudget(maxTokens?: number): number {
  if (maxTokens === undefined || !Number.isFinite(maxTokens))
    return PROJECT_INDEX_DEFAULT_QUERY_TOKENS;
  return Math.min(
    PROJECT_INDEX_MAX_QUERY_TOKENS,
    Math.max(PROJECT_INDEX_MIN_QUERY_TOKENS, Math.trunc(maxTokens)),
  );
}

export interface ProjectIndexGraphView {
  readonly entities: ReadonlyArray<ProjectEntityV1>;
  readonly callsites: ReadonlyArray<ProjectCallsiteV1>;
  readonly omittedEntities: number;
  readonly omittedCallsites: number;
  readonly omittedTargets: number;
  readonly truncated: boolean;
}

function graphLimit(value: number | undefined, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? maximum
    : Math.max(1, Math.min(maximum, Math.trunc(value)));
}

export function deriveProjectIndexGraph(
  result: Pick<ProjectIndexQueryResultV1, "entities" | "callsites" | "truncated">,
  options: {
    readonly maxEntities?: number;
    readonly maxCallsites?: number;
    readonly selectedEntityId?: string;
  } = {},
): ProjectIndexGraphView {
  const maxEntities = graphLimit(options.maxEntities, PROJECT_INDEX_MAX_VISIBLE_ENTITIES);
  const maxCallsites = graphLimit(options.maxCallsites, PROJECT_INDEX_MAX_VISIBLE_CALLSITES);
  const selected = result.entities.find((entity) => entity.id === options.selectedEntityId);
  const entities = selected
    ? [selected, ...result.entities.filter((entity) => entity.id !== selected.id)].slice(
        0,
        maxEntities,
      )
    : result.entities.slice(0, maxEntities);
  const visibleIds = new Set(entities.map((entity) => entity.id));
  const callsites: ProjectCallsiteV1[] = [];
  let visibleTargets = 0;
  let totalTargets = 0;
  for (const callsite of result.callsites) {
    totalTargets += callsite.targetEntityIds.length;
    if (
      !callsite.callerEntityId ||
      !visibleIds.has(callsite.callerEntityId) ||
      callsites.length >= maxCallsites
    )
      continue;
    const targets = callsite.targetEntityIds
      .filter((id) => visibleIds.has(id))
      .slice(0, Math.max(0, maxCallsites - visibleTargets));
    if (callsite.resolution !== "unresolved" && targets.length === 0) continue;
    visibleTargets += targets.length;
    callsites.push(
      targets.length === callsite.targetEntityIds.length
        ? callsite
        : { ...callsite, targetEntityIds: targets },
    );
  }
  const omittedEntities = result.entities.length - entities.length;
  const omittedCallsites = result.callsites.length - callsites.length;
  const omittedTargets = totalTargets - visibleTargets;
  return {
    entities,
    callsites,
    omittedEntities,
    omittedCallsites,
    omittedTargets,
    truncated:
      result.truncated || omittedEntities > 0 || omittedCallsites > 0 || omittedTargets > 0,
  };
}

export interface ProjectIndexControllerState extends ProjectIndexClientState {
  readonly invalidationEpoch: number;
  readonly loading: boolean;
  readonly pendingAction: "settings" | "start" | "rebuild" | ProjectIndexControlAction | null;
  readonly error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The project index request failed.";
}

/** A lazy, environment-bound controller; constructing one starts no work. */
export function createProjectIndexController(input: {
  readonly api: ProjectIndexClientApi;
  readonly scope: ProjectIndexScopeInput;
}) {
  const { api } = input;
  const scope: ProjectIndexScopeInput = {
    projectId: input.scope.projectId,
    ...(input.scope.threadId !== undefined ? { threadId: input.scope.threadId } : {}),
  };
  let state: ProjectIndexControllerState = {
    ...EMPTY_PROJECT_INDEX_CLIENT_STATE,
    invalidationEpoch: 0,
    loading: false,
    pendingAction: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let epoch = 0;
  let refreshRequest = 0;
  let queryRequest = 0;

  function publish(next: ProjectIndexControllerState) {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function matchesScope(resultScope: ProjectIndexScopeInput) {
    return resultScope.projectId === scope.projectId && scope.threadId === resultScope.threadId;
  }

  function receive(event: ProjectIndexStreamEvent) {
    if (event.type === "status" && !matchesScope(event.status.scope)) return;
    const next = applyProjectIndexStreamEvent(state, event);
    if (next !== state && event.type === "invalidate") queryRequest += 1;
    if (next !== state) {
      publish({
        ...state,
        ...next,
        invalidationEpoch: state.invalidationEpoch + (event.type === "invalidate" ? 1 : 0),
      });
    }
  }

  function connect() {
    if (unsubscribe || listeners.size === 0) return;
    const subscriptionEpoch = epoch;
    try {
      unsubscribe = api.subscribe(
        {
          ...scope,
          ...(state.status ? { afterRevision: state.status.revision } : {}),
        },
        (event) => {
          if (subscriptionEpoch === epoch) receive(event);
        },
      );
    } catch (error) {
      publish({ ...state, error: errorMessage(error) });
    }
  }

  function disconnect() {
    const release = unsubscribe;
    unsubscribe = null;
    release?.();
  }

  async function refresh() {
    connect();
    const request = ++refreshRequest;
    const requestEpoch = epoch;
    publish({ ...state, loading: true, error: null });
    try {
      const status = await api.getStatus(scope);
      if (requestEpoch === epoch && request === refreshRequest) receive({ type: "status", status });
      return status;
    } catch (error) {
      if (requestEpoch === epoch && request === refreshRequest)
        publish({ ...state, error: errorMessage(error) });
      throw error;
    } finally {
      if (requestEpoch === epoch && request === refreshRequest)
        publish({ ...state, loading: false });
    }
  }

  async function mutate(
    action: Exclude<ProjectIndexControllerState["pendingAction"], null>,
    run: () => Promise<ProjectIndexStatusV1>,
  ) {
    if (state.pendingAction !== null)
      throw new Error("A project index action is already in progress.");
    const requestEpoch = epoch;
    publish({ ...state, pendingAction: action, error: null });
    try {
      const status = await run();
      if (requestEpoch === epoch) receive({ type: "status", status });
      return status;
    } catch (error) {
      if (requestEpoch === epoch) publish({ ...state, error: errorMessage(error) });
      throw error;
    } finally {
      if (requestEpoch === epoch) publish({ ...state, pendingAction: null });
    }
  }

  async function query(request: ProjectContextInput) {
    const currentRequest = ++queryRequest;
    const requestEpoch = epoch;
    try {
      const context = decodeProjectContext({
        ...request,
        maxTokens: normalizeProjectIndexTokenBudget(request.maxTokens),
      });
      const result = await api.query({
        ...context,
        ...scope,
      });
      if (requestEpoch === epoch && currentRequest === queryRequest && matchesScope(result.scope)) {
        const next = applyProjectIndexQueryResult(state, result);
        if (next !== state) publish({ ...state, ...next, error: null });
      }
      return result;
    } catch (error) {
      if (requestEpoch === epoch && currentRequest === queryRequest)
        publish({ ...state, error: errorMessage(error) });
      throw error;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) disconnect();
      };
    },
    refresh,
    updateSettings: (patch: ProjectIndexSettingsPatch) =>
      mutate("settings", () => api.updateSettings({ ...scope, patch })),
    start: (rebuild = false) =>
      mutate(rebuild ? "rebuild" : "start", () => api.start({ ...scope, rebuild })),
    control: (action: ProjectIndexControlAction) =>
      mutate(action, () => api.control({ ...scope, action })),
    query,
    checkModel: (modelSelection: ProjectIndexModelSelection) =>
      api.checkModel({ ...scope, modelSelection }),
    review: (selection: ProjectIndexReviewInput["selection"] = "workingtree") => {
      if (!api.review)
        return Promise.reject(
          new Error("Project index review is unavailable in this environment."),
        );
      return api.review({ ...scope, selection });
    },
    dispose() {
      epoch += 1;
      refreshRequest += 1;
      queryRequest += 1;
      disconnect();
      listeners.clear();
      state = { ...state, loading: false, pendingAction: null };
    },
  };
}

export type ProjectIndexController = ReturnType<typeof createProjectIndexController>;
