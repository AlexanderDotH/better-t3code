import { describe, expect, it, vi } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  PROJECT_INDEX_MAX_VISIBLE_CALLSITES,
  PROJECT_INDEX_MAX_VISIBLE_ENTITIES,
  ProjectEntityV1,
  ProjectIndexQueryResultV1,
  ProjectIndexStatusV1,
  type ProjectCallsiteV1,
  type ProjectIndexStreamEvent,
} from "@t3tools/contracts";

import {
  EMPTY_PROJECT_INDEX_CLIENT_STATE,
  applyProjectIndexQueryResult,
  applyProjectIndexActivityEvent,
  applyProjectIndexStreamEvent,
  createProjectIndexController,
  deriveProjectIndexActions,
  deriveProjectIndexChatStatus,
  deriveProjectIndexStage,
  deriveProjectIndexGraph,
  formatProjectIndexUsage,
  normalizeProjectIndexTokenBudget,
  projectIndexingSupported,
  projectIndexingDefaultsSupported,
  projectIndexScopeKey,
  type ProjectIndexClientApi,
} from "./projectIndexing.ts";

const scope = { scopeId: "scope-a", projectId: "project-a", workspaceFingerprint: "workspace-a" };
const timestamp = "2026-09-20T00:00:00.000Z";
const decodeStatus = Schema.decodeSync(ProjectIndexStatusV1);
const decodeQuery = Schema.decodeSync(ProjectIndexQueryResultV1);
const decodeEntity = Schema.decodeSync(ProjectEntityV1);

function makeStatus(overrides: Partial<ProjectIndexStatusV1> = {}): ProjectIndexStatusV1 {
  return decodeStatus({
    version: 1,
    scope,
    revision: 1,
    state: "ready",
    settings: {
      ...DEFAULT_PROJECT_INDEX_SETTINGS,
      enabled: true,
      modelSelection: { instanceId: "local", model: "example" },
    },
    job: null,
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    gaps: [],
    updatedAt: timestamp,
    ...overrides,
  });
}

function makeQuery(overrides: Partial<ProjectIndexQueryResultV1> = {}): ProjectIndexQueryResultV1 {
  return decodeQuery({
    version: 1,
    scope,
    revision: 1,
    operation: "overview",
    summary: "Synthetic project",
    entities: [],
    callsites: [],
    modules: [],
    behaviors: [],
    flows: [],
    rules: [],
    evidence: [],
    gaps: [],
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    nextCursor: null,
    truncated: false,
    estimatedTokens: 100,
    ...overrides,
  });
}

function makeEntity(index: number): ProjectEntityV1 {
  return decodeEntity({
    id: `entity-${index}`,
    filePath: "src/example.ts",
    kind: "function",
    name: `example${index}`,
    qualifiedName: `example${index}`,
    language: "typescript",
    sourceHash: "hash-a",
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 20 },
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  });
}

function makeApi(overrides: Partial<ProjectIndexClientApi> = {}): ProjectIndexClientApi {
  return {
    getSettings: async () => makeStatus().settings,
    getStatus: async () => makeStatus(),
    updateSettings: async () => makeStatus(),
    start: async () => makeStatus(),
    control: async () => makeStatus(),
    query: async () => makeQuery(),
    checkModel: async () => ({ supported: true }),
    subscribe: () => () => {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("project indexing shared state", () => {
  it("shows resolution after extraction completes, without overriding stopped or terminal states", () => {
    const resolving = makeStatus({
      state: "updating",
      coverage: { ...EMPTY_PROJECT_INDEX_COVERAGE, eligibleFiles: 5_000, indexedFiles: 5_000 },
      job: {
        id: "resolve",
        generationId: "resolve",
        revision: 1,
        kind: "initial",
        state: "running",
        phase: "validation",
        modelSelection: null,
        units: { pending: 0, running: 0, completed: 5_000, failed: 0, stale: 0, cancelled: 0 },
        usage: { usageStatus: "unavailable", requests: 0 },
        updatedAt: timestamp,
      },
    });
    expect(deriveProjectIndexChatStatus(resolving)).toMatchObject({
      stage: "resolving",
      tone: "active",
    });
    expect(deriveProjectIndexStage({ ...resolving, state: "extracting" })).toBe("resolving");
    for (const state of ["paused", "cancelled", "ready", "partial", "failed"] as const)
      expect(deriveProjectIndexStage({ ...resolving, state })).toBe(state);
    expect(
      deriveProjectIndexStage({ ...resolving, defaults: { enabled: false, modelSelection: null } }),
    ).toBe("disabled");
  });

  it("resumes a static index independently of the optional review model", () => {
    const paused = makeStatus({
      state: "paused",
      settings: { ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: true },
      defaults: { enabled: true, modelSelection: null },
      job: {
        id: "paused-job",
        generationId: "paused-generation",
        kind: "initial",
        state: "paused",
        phase: "analysis",
        revision: 1,
        units: { pending: 1, running: 0, completed: 0, failed: 0, stale: 0, cancelled: 0 },
        modelSelection: makeStatus().settings.modelSelection,
        usage: { usageStatus: "unavailable", requests: 0 },
        updatedAt: timestamp,
      },
    });
    expect(deriveProjectIndexActions(paused)).toMatchObject({
      canStart: false,
      canResume: true,
      canCancel: true,
      resumeModelChanged: false,
    });
    const changedModel = { ...paused.job!.modelSelection!, model: "different-model" };
    expect(
      deriveProjectIndexActions({
        ...paused,
        defaults: { enabled: true, modelSelection: changedModel },
      }),
    ).toMatchObject({ canResume: true, resumeModelChanged: false });
    expect(
      deriveProjectIndexActions({
        ...paused,
        settings: { ...paused.settings, modelSelection: changedModel },
      }),
    ).toMatchObject({ canResume: true, resumeModelChanged: false, canCancel: true });
    expect(
      deriveProjectIndexActions({
        ...paused,
        settings: { ...paused.settings, modelSelection: paused.job!.modelSelection },
      }),
    ).toMatchObject({ canResume: true, resumeModelChanged: false });
    expect(
      deriveProjectIndexActions({ ...paused, defaults: { enabled: false, modelSelection: null } }),
    ).toMatchObject({ canStart: false, canRebuild: false, canResume: false, canCancel: true });
    expect(
      deriveProjectIndexActions({ ...paused, settings: DEFAULT_PROJECT_INDEX_SETTINGS }),
    ).toMatchObject({ canResume: false, canCancel: true });
    const unpinned = { ...paused, job: { ...paused.job!, modelSelection: null } };
    expect(deriveProjectIndexActions(unpinned).canResume).toBe(true);
    expect(
      deriveProjectIndexActions({
        ...unpinned,
        defaults: { enabled: true, modelSelection: makeStatus().settings.modelSelection },
      }).canResume,
    ).toBe(true);
  });

  it("applies the environment master without requiring a review model", () => {
    expect(projectIndexingDefaultsSupported(undefined)).toBe(false);
    expect(projectIndexingDefaultsSupported({})).toBe(false);
    expect(projectIndexingDefaultsSupported({ projectIndexingDefaultsVersion: 1 })).toBe(true);
    const configured = makeStatus();
    expect(configured.defaults).toBeUndefined();
    expect(deriveProjectIndexActions(configured).canStart).toBe(true);
    const raw = { ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: true };
    const inherited = makeStatus({
      settings: raw,
      defaults: { enabled: true, modelSelection: configured.settings.modelSelection },
    });
    expect(deriveProjectIndexActions(inherited)).toMatchObject({
      canStart: true,
      needsModel: false,
    });
    const masterDisabled = makeStatus({
      settings: raw,
      defaults: { enabled: false, modelSelection: configured.settings.modelSelection },
    });
    expect(deriveProjectIndexActions(masterDisabled)).toMatchObject({
      canStart: false,
      canRebuild: false,
      needsModel: false,
    });
    expect(masterDisabled.settings).toEqual(raw);
  });

  it("shows chat feedback only for opted-in projects and treats a global stop as unavailable", () => {
    expect(deriveProjectIndexChatStatus(null)).toBeNull();
    expect(
      deriveProjectIndexChatStatus(makeStatus({ settings: DEFAULT_PROJECT_INDEX_SETTINGS })),
    ).toBeNull();

    const running = makeStatus({
      state: "analyzing",
      coverage: { ...EMPTY_PROJECT_INDEX_COVERAGE, eligibleFiles: 12, indexedFiles: 7 },
    });
    expect(deriveProjectIndexChatStatus(running)).toMatchObject({
      state: "analyzing",
      tone: "active",
      indexedFiles: 7,
      eligibleFiles: 12,
      openSettings: false,
    });
    expect(
      deriveProjectIndexChatStatus(
        makeStatus({
          ...running,
          job: {
            id: "generation",
            generationId: "generation",
            kind: "initial",
            state: "running",
            phase: "analysis",
            revision: 1,
            units: { completed: 1, pending: 2, running: 1, failed: 0, stale: 0, cancelled: 0 },
            modelSelection: running.settings.modelSelection,
            usage: { usageStatus: "unavailable", requests: 1 },
            updatedAt: timestamp,
          },
        }),
      )?.analysisUnits,
    ).toEqual({ completed: 1, total: 4 });
    expect(deriveProjectIndexChatStatus({ ...running, state: "ready" })?.tone).toBe("ready");
    expect(deriveProjectIndexChatStatus({ ...running, state: "partial" })).toMatchObject({
      state: "partial",
      tone: "ready",
    });
    expect(
      deriveProjectIndexChatStatus({
        ...running,
        defaults: { enabled: false, modelSelection: null },
      }),
    ).toMatchObject({ state: "disabled", tone: "attention", openSettings: true });
  });

  it("keeps the latest activity per scope and drops disabled projects", () => {
    const status = makeStatus();
    const activity = {
      scope: status.scope,
      state: status.state,
      settings: { enabled: true },
      coverage: { indexedFiles: 7, eligibleFiles: 12 },
      job: null,
      updatedAt: timestamp,
    } as const;
    const initial = applyProjectIndexActivityEvent(new Map(), {
      type: "snapshot",
      activities: [activity],
    });
    expect(initial.size).toBe(1);

    const newer = {
      ...activity,
      state: "analyzing" as const,
      updatedAt: "2026-09-20T00:01:00.000Z",
    };
    const running = applyProjectIndexActivityEvent(initial, { type: "status", activity: newer });
    expect(deriveProjectIndexChatStatus(running.get(scope.scopeId)!)?.state).toBe("analyzing");
    expect(
      applyProjectIndexActivityEvent(running, { type: "status", activity }).get(scope.scopeId),
    ).toBe(newer);
    expect(
      applyProjectIndexActivityEvent(running, {
        type: "status",
        activity: { ...newer, settings: { enabled: false } },
      }).size,
    ).toBe(0);
  });

  it("clears query data when the environment master turns off without rewriting project settings", () => {
    const status = makeStatus({ defaults: { enabled: true, modelSelection: null } });
    const queryResult = makeQuery();
    const disabled = applyProjectIndexStreamEvent(
      { status, queryResult, invalidated: false },
      {
        type: "status",
        status: makeStatus({
          defaults: { enabled: false, modelSelection: null },
          updatedAt: "2026-09-20T00:00:01.000Z",
        }),
      },
    );
    expect(disabled.queryResult).toBeNull();
    expect(disabled.status?.settings.enabled).toBe(true);
    expect(applyProjectIndexQueryResult(disabled, queryResult)).toBe(disabled);
  });

  it("treats absent capabilities as unsupported without affecting older environments", () => {
    expect(projectIndexingSupported(undefined)).toBe(false);
    expect(projectIndexingSupported(null)).toBe(false);
    expect(projectIndexingSupported({})).toBe(false);
    expect(projectIndexingSupported({ projectIndexingVersion: 1 })).toBe(false);
    expect(projectIndexingSupported({ projectIndexingVersion: 2 })).toBe(false);
    expect(projectIndexingSupported({ projectIndexingVersion: 3 })).toBe(true);
    const selector = makeStatus().scope;
    expect(projectIndexScopeKey(selector, "environment-a")).not.toBe(
      projectIndexScopeKey(selector, "environment-b"),
    );
  });

  it("drops a cached query on revision changes and ignores older status events", () => {
    const status = makeStatus();
    const current = { status, queryResult: makeQuery(), invalidated: false };
    const newer = applyProjectIndexStreamEvent(current, {
      type: "status",
      status: makeStatus({ revision: 2 }),
    });
    expect(newer.queryResult).toBeNull();
    expect(newer.invalidated).toBe(true);
    expect(applyProjectIndexStreamEvent(newer, { type: "status", status })).toBe(newer);
    expect(applyProjectIndexQueryResult(newer, makeQuery())).toBe(newer);
    expect(applyProjectIndexQueryResult(newer, makeQuery({ revision: 2 })).invalidated).toBe(false);
  });

  it("does not reintroduce data after a future revision invalidation", () => {
    const current = { status: makeStatus(), queryResult: makeQuery(), invalidated: false };
    const invalidated = applyProjectIndexStreamEvent(current, {
      type: "invalidate",
      scopeId: "scope-a",
      revision: 3,
      reason: "cleared",
    });
    expect(applyProjectIndexQueryResult(invalidated, makeQuery())).toBe(invalidated);
    const newer = applyProjectIndexStreamEvent(invalidated, {
      type: "status",
      status: makeStatus({ revision: 3 }),
    });
    const queried = applyProjectIndexQueryResult(newer, makeQuery({ revision: 3 }));
    expect(queried.invalidated).toBe(false);
    expect(queried.invalidatedRevision).toBeUndefined();
  });

  it("isolates scope invalidations and clears worktree data on a scope switch", () => {
    const current = { status: makeStatus(), queryResult: makeQuery(), invalidated: false };
    expect(
      applyProjectIndexStreamEvent(current, {
        type: "invalidate",
        scopeId: "other",
        revision: 3,
        reason: "source-changed",
      }),
    ).toBe(current);
    const differentScope = {
      ...current.status.scope,
      scopeId: "scope-b",
      workspaceFingerprint: "workspace-b",
    };
    const changed = applyProjectIndexStreamEvent(current, {
      type: "status",
      status: makeStatus({ scope: differentScope, revision: 0 }),
    });
    expect(changed.queryResult).toBeNull();
    expect(changed.status?.scope.scopeId).toBe("scope-b");
    expect(applyProjectIndexQueryResult(changed, makeQuery())).toBe(changed);
  });

  it("keeps query pages during same-revision progress and clears them when disabled", () => {
    const status = makeStatus();
    const queryResult = makeQuery();
    const current = { status, queryResult, invalidated: false };
    const progress = applyProjectIndexStreamEvent(current, {
      type: "status",
      status: makeStatus({ state: "analyzing", updatedAt: "2026-09-20T00:00:01.000Z" }),
    });
    expect(progress.queryResult).toBe(queryResult);
    expect(applyProjectIndexStreamEvent(progress, { type: "status", status })).toBe(progress);
    const disabled = applyProjectIndexStreamEvent(progress, {
      type: "status",
      status: makeStatus({
        settings: DEFAULT_PROJECT_INDEX_SETTINGS,
        state: "disabled",
        updatedAt: "2026-09-20T00:00:02.000Z",
      }),
    });
    expect(disabled.queryResult).toBeNull();
    expect(applyProjectIndexQueryResult(disabled, queryResult)).toBe(disabled);
  });

  it("offers reverse lifecycle controls without a selected model", () => {
    expect(deriveProjectIndexActions(null).canStart).toBe(false);
    expect(deriveProjectIndexActions(makeStatus()).canStart).toBe(true);
    expect(deriveProjectIndexActions(makeStatus({ state: "waiting-for-provider" }))).toMatchObject({
      canPause: true,
      canCancel: true,
      canStart: false,
    });
    expect(deriveProjectIndexActions(makeStatus({ state: "paused" }))).toMatchObject({
      canResume: true,
      canCancel: true,
      canStart: false,
    });
    expect(
      deriveProjectIndexActions(
        makeStatus({ settings: { ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: true } }),
      ),
    ).toMatchObject({ needsModel: false, canStart: true });
  });

  it("clamps invalid budgets and formats unmeasured usage honestly", () => {
    expect(normalizeProjectIndexTokenBudget()).toBe(6_000);
    expect(normalizeProjectIndexTokenBudget(Number.NaN)).toBe(6_000);
    expect(normalizeProjectIndexTokenBudget(100_000)).toBe(24_000);
    expect(normalizeProjectIndexTokenBudget(-1)).toBe(1_024);
    expect(formatProjectIndexUsage({ usageStatus: "unavailable", requests: 1 })).toBe(
      "Token usage unavailable",
    );
    expect(
      formatProjectIndexUsage({ usageStatus: "partial", requests: 1, inputTokens: 30 }),
    ).toContain("unknown output");
  });
});

describe("bounded project graph projection", () => {
  it("bounds candidate fanout and keeps the selected entity visible", () => {
    const entities = Array.from({ length: 200 }, (_, index) => makeEntity(index));
    const callsites: ProjectCallsiteV1[] = Array.from({ length: 20 }, (_, index) => ({
      id: `call-${index}`,
      callerEntityId: "entity-0",
      filePath: "src/example.ts",
      range: entities[0]!.range,
      expression: "receiver.run()",
      dispatch: "virtual",
      resolution: "candidate",
      targetEntityIds: entities.slice(1).map((entity) => entity.id),
      sourceHash: "hash-a",
      provenance: "compiler",
      freshness: "current",
      evidenceIds: [],
    }));
    const view = deriveProjectIndexGraph(
      { entities, callsites, truncated: false },
      { selectedEntityId: "entity-199", maxEntities: Infinity, maxCallsites: Infinity },
    );
    expect(view.entities).toHaveLength(PROJECT_INDEX_MAX_VISIBLE_ENTITIES);
    expect(view.entities[0]?.id).toBe("entity-199");
    expect(
      view.callsites.reduce((total, callsite) => total + callsite.targetEntityIds.length, 0),
    ).toBeLessThanOrEqual(PROJECT_INDEX_MAX_VISIBLE_CALLSITES);
    expect(view.truncated).toBe(true);
    expect(view.omittedTargets).toBeGreaterThan(0);
    expect(callsites[0]?.targetEntityIds).toHaveLength(199);
  });
});

describe("project index controller lifetime and request ordering", () => {
  it("starts lazily, shares one subscription, and reconnects after disposal", async () => {
    const disconnect = vi.fn();
    const subscribe = vi.fn(() => disconnect);
    const controller = createProjectIndexController({
      api: makeApi({ subscribe }),
      scope: makeStatus().scope,
    });
    expect(subscribe).not.toHaveBeenCalled();
    const removeFirst = controller.subscribe(() => {});
    const removeSecond = controller.subscribe(() => {});
    expect(subscribe).toHaveBeenCalledTimes(1);
    removeFirst();
    expect(disconnect).not.toHaveBeenCalled();
    removeSecond();
    expect(disconnect).toHaveBeenCalledTimes(1);
    controller.dispose();
    controller.subscribe(() => {});
    await controller.refresh();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status?.revision).toBe(1);
    controller.dispose();
  });

  it("ignores out-of-order refreshes and disposed requests", async () => {
    const older = deferred<ProjectIndexStatusV1>();
    const newer = deferred<ProjectIndexStatusV1>();
    const getStatus = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const controller = createProjectIndexController({
      api: makeApi({ getStatus }),
      scope: makeStatus().scope,
    });
    const first = controller.refresh();
    const second = controller.refresh();
    newer.resolve(makeStatus({ revision: 2 }));
    await second;
    older.resolve(makeStatus());
    await first;
    expect(controller.getSnapshot().status?.revision).toBe(2);
    const late = deferred<ProjectIndexStatusV1>();
    getStatus.mockReturnValueOnce(late.promise);
    const last = controller.refresh();
    controller.dispose();
    late.resolve(makeStatus({ revision: 3 }));
    await last;
    expect(controller.getSnapshot().status?.revision).toBe(2);
    expect(controller.getSnapshot().loading).toBe(false);
  });

  it("rejects query completions started before an invalidation even at the same revision", async () => {
    let receive: ((event: ProjectIndexStreamEvent) => void) | undefined;
    const response = deferred<ProjectIndexQueryResultV1>();
    const controller = createProjectIndexController({
      api: makeApi({
        subscribe: (_, listener) => {
          receive = listener;
          return () => {};
        },
        query: () => response.promise,
      }),
      scope: makeStatus().scope,
    });
    controller.subscribe(() => {});
    await controller.refresh();
    const pending = controller.query({ operation: "overview" });
    receive?.({ type: "invalidate", scopeId: "scope-a", revision: 1, reason: "source-changed" });
    response.resolve(makeQuery());
    await pending;
    expect(controller.getSnapshot().queryResult).toBeNull();
    expect(controller.getSnapshot().invalidated).toBe(true);
    expect(controller.getSnapshot().invalidationEpoch).toBe(1);
    await controller.query({ operation: "overview" });
    expect(controller.getSnapshot().invalidated).toBe(false);
    expect(controller.getSnapshot().invalidationEpoch).toBe(1);
    receive?.({
      type: "invalidate",
      scopeId: "scope-a",
      revision: 1,
      reason: "source-changed",
    });
    expect(controller.getSnapshot().invalidationEpoch).toBe(2);
    controller.dispose();
  });

  it("serializes mutations and surfaces failure without optimistic settings changes", async () => {
    const response = deferred<ProjectIndexStatusV1>();
    const controller = createProjectIndexController({
      api: makeApi({ updateSettings: () => response.promise }),
      scope: makeStatus().scope,
    });
    await controller.refresh();
    const pending = controller.updateSettings({ enabled: false });
    expect(controller.getSnapshot().status?.settings.enabled).toBe(true);
    await expect(controller.start()).rejects.toThrow("already in progress");
    response.reject(new Error("Settings could not be saved"));
    await expect(pending).rejects.toThrow("could not be saved");
    expect(controller.getSnapshot()).toMatchObject({
      error: "Settings could not be saved",
      pendingAction: null,
    });
    expect(controller.getSnapshot().status?.settings.enabled).toBe(true);
    controller.dispose();
  });

  it("keeps a new client empty until an authorized response arrives", () => {
    const controller = createProjectIndexController({ api: makeApi(), scope: makeStatus().scope });
    expect(controller.getSnapshot()).toMatchObject(EMPTY_PROJECT_INDEX_CLIENT_STATE);
  });

  it("sends only scope selectors and rejects a query trying to override them", async () => {
    const getStatus = vi.fn(async () => makeStatus());
    const query = vi.fn(async () => makeQuery());
    const controller = createProjectIndexController({
      api: makeApi({ getStatus, query }),
      scope: makeStatus().scope,
    });
    await controller.refresh();
    expect(getStatus).toHaveBeenCalledWith({ projectId: "project-a" });
    const request = { operation: "overview" as const, threadId: "another-thread" };
    await expect(controller.query(request)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
