import {
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./deepPlanningSources.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deepPlanningSources.ts")>()),
  transferDeepPlanSources: vi.fn(),
}));

import { transferDeepPlanSources } from "./deepPlanningSources.ts";
import {
  continueDeepPlanForTurn,
  prepareDeepPlanForTurn,
  type DeepPlanningApi,
} from "./deepPlanningTurn.ts";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const createdAt = "2026-10-16T08:00:00.000Z";
const nextRunId = DeepPlanRunId.make("fresh-run");

function run(overrides?: Partial<DeepPlanRun>): DeepPlanRun {
  return {
    id: DeepPlanRunId.make("prior-run"),
    threadId,
    phase: "planning",
    revision: 5,
    plan: null,
    approvalKey: null,
    approval: null,
    sources: [],
    sourceCoverage: [],
    stepStates: [],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt,
    updatedAt: createdAt,
    pauseReason: null,
    ...overrides,
  };
}

function api() {
  return {
    catalogSources: vi.fn(),
    exportSources: vi.fn(),
    readExportChunk: vi.fn(),
    initializeSources: vi.fn(),
    importSourceChunk: vi.fn(),
    getRun: vi.fn<DeepPlanningApi["getRun"]>().mockResolvedValue(null),
    dispatchCommand: vi.fn<DeepPlanningApi["dispatchCommand"]>().mockResolvedValue({}),
  } satisfies DeepPlanningApi;
}

function prepare(
  target: DeepPlanningApi,
  options?: Partial<Parameters<typeof prepareDeepPlanForTurn>[0]>,
) {
  let identifier = 0;
  return prepareDeepPlanForTurn({
    environmentId,
    projectId,
    threadId,
    runId: nextRunId,
    createId: () => `id-${++identifier}`,
    now: () => createdAt,
    apiForEnvironment: () => target,
    ...options,
  });
}

beforeEach(() => {
  vi.mocked(transferDeepPlanSources).mockReset();
  vi.mocked(transferDeepPlanSources).mockResolvedValue({ sources: [], coverage: [] });
});

describe("DeepPlan turn preparation", () => {
  it("joins an active collection when Resume is clicked before the export finishes", async () => {
    const target = api();
    let release!: (value: Awaited<ReturnType<typeof transferDeepPlanSources>>) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const exportResult = new Promise<Awaited<ReturnType<typeof transferDeepPlanSources>>>(
      (resolve) => {
        release = resolve;
      },
    );
    vi.mocked(transferDeepPlanSources).mockImplementation(() => {
      notifyStarted();
      return exportResult;
    });
    const collecting = run({ id: nextRunId, phase: "collecting" });
    target.getRun
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(collecting)
      .mockResolvedValueOnce(run({ id: nextRunId }));
    const first = prepare(target);
    await started;
    const resumed = prepare(target, {
      existingRun: run({ id: nextRunId, phase: "collecting" }),
      additionalSourceRefs: [{ environmentId, projectId, threadId }],
    });
    expect(transferDeepPlanSources).toHaveBeenCalledTimes(1);
    expect(target.dispatchCommand).toHaveBeenCalledTimes(1);
    await expect(
      prepare(target, {
        additionalSourceRefs: [
          { environmentId: EnvironmentId.make("remote"), projectId, threadId },
        ],
      }),
    ).rejects.toThrow("Wait for source collection");
    const continued = continueRun(target, collecting);
    const controller = new AbortController();
    const cancelledWait = prepare(target, { signal: controller.signal });
    controller.abort();
    await expect(cancelledWait).rejects.toThrow("canceled");
    release({ sources: [], coverage: [] });
    expect((await first).id).toBe(nextRunId);
    expect(await resumed).toEqual(await first);
    expect(await continued).toEqual(await first);
    expect(target.dispatchCommand).toHaveBeenCalledTimes(1);
  });

  it("keeps simultaneous preparation in two environments separate for the same thread", async () => {
    const local = api();
    const remote = api();
    for (const target of [local, remote])
      target.getRun.mockResolvedValueOnce(null).mockResolvedValueOnce(run({ id: nextRunId }));
    const bothStarted = Promise.withResolvers<void>();
    const exported = Promise.withResolvers<Awaited<ReturnType<typeof transferDeepPlanSources>>>();
    let started = 0;
    vi.mocked(transferDeepPlanSources).mockImplementation(() => {
      if (++started === 2) bothStarted.resolve();
      return exported.promise;
    });
    const first = prepare(local);
    const second = prepare(remote, { environmentId: EnvironmentId.make("remote") });
    await bothStarted.promise;
    expect(transferDeepPlanSources).toHaveBeenCalledTimes(2);
    exported.resolve({ sources: [], coverage: [] });
    expect((await Promise.all([first, second])).map((prepared) => prepared.id)).toEqual([
      nextRunId,
      nextRunId,
    ]);
  });

  it("allows another attempt after collection fails without leaving a pending preparation", async () => {
    const target = api();
    target.getRun.mockResolvedValue(null);
    vi.mocked(transferDeepPlanSources).mockRejectedValueOnce(new Error("Connection lost"));
    await expect(prepare(target)).rejects.toThrow("Connection lost");
    target.getRun.mockResolvedValueOnce(null).mockResolvedValueOnce(run({ id: nextRunId }));
    expect((await prepare(target)).id).toBe(nextRunId);
    expect(transferDeepPlanSources).toHaveBeenCalledTimes(2);
  });

  it("reuses complete unapproved planning sources without exporting them again", async () => {
    const target = api();
    const existing = run();
    target.getRun.mockResolvedValue(existing);
    expect(await prepare(target)).toBe(existing);
    expect(target.dispatchCommand).not.toHaveBeenCalled();
    expect(transferDeepPlanSources).not.toHaveBeenCalled();
  });

  it("reuses frozen external selections despite order and duplicate choices", async () => {
    const source = {
      sourceId: DeepPlanSourceId.make("source"),
      origin: { environmentId: EnvironmentId.make("remote"), projectId, threadId },
      projectTitle: "Project",
      threadTitle: "Prior work",
      archived: true,
      capturedAt: createdAt,
      contentVersion: "1",
      contentHash: "hash",
      messageCount: 1,
      activityCount: 0,
      attachmentCount: 0,
      recordCount: 2,
      forkOrigin: null,
    };
    const existing = run({
      sources: [source],
      sourceCoverage: [
        {
          sourceId: source.sourceId,
          status: "ready",
          importedRecordCount: 2,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        },
      ],
    });
    const target = api();
    target.getRun.mockResolvedValue(existing);
    expect(await prepare(target, { additionalSourceRefs: [source.origin, source.origin] })).toBe(
      existing,
    );
    expect(transferDeepPlanSources).not.toHaveBeenCalled();
  });

  it("pauses an old unapproved run before capturing changed source selections", async () => {
    const target = api();
    target.getRun.mockResolvedValueOnce(run()).mockResolvedValueOnce(run({ id: nextRunId }));
    const source = { environmentId: EnvironmentId.make("remote"), projectId, threadId };
    expect((await prepare(target, { additionalSourceRefs: [source] })).id).toBe(nextRunId);
    expect(target.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.deep-plan.update",
      mutation: { type: "pause" },
      expectedRevision: 5,
    });
    expect(target.dispatchCommand.mock.calls[1]?.[0]).toMatchObject({
      type: "thread.deep-plan.start",
      runId: nextRunId,
    });
    expect(transferDeepPlanSources).toHaveBeenCalledWith(
      expect.objectContaining({ runId: nextRunId, additionalSourceRefs: [source] }),
    );
  });

  it("starts a fresh run after interrupted collection instead of reusing partial snapshots", async () => {
    const target = api();
    target.getRun
      .mockResolvedValueOnce(run({ phase: "collecting" }))
      .mockResolvedValueOnce(run({ id: nextRunId }));
    expect((await prepare(target)).id).toBe(nextRunId);
    expect(transferDeepPlanSources).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh run after the previous workflow completed", async () => {
    const target = api();
    target.getRun
      .mockResolvedValueOnce(run({ phase: "completed" }))
      .mockResolvedValueOnce(run({ id: nextRunId }));
    expect((await prepare(target)).id).toBe(nextRunId);
    expect(target.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.deep-plan.start",
      runId: nextRunId,
    });
  });

  it("does not restart a paused run with its old fixed run ID", async () => {
    const target = api();
    const old = run({ phase: "paused" });
    target.getRun
      .mockResolvedValueOnce(old)
      .mockImplementation(async (input) => run({ id: input.runId ?? nextRunId }));
    const prepared = await prepare(target, { runId: old.id });
    expect(prepared.id).not.toBe(old.id);
    expect(target.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.deep-plan.start",
      runId: prepared.id,
    });
  });

  it("pauses failed source collection and propagates the error without allowing a normal send", async () => {
    const target = api();
    const failure = new Error("Selected environment disconnected");
    vi.mocked(transferDeepPlanSources).mockRejectedValue(failure);
    target.getRun
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(run({ id: nextRunId, phase: "collecting", revision: 8 }));
    await expect(prepare(target)).rejects.toBe(failure);
    expect(target.dispatchCommand.mock.calls[1]?.[0]).toMatchObject({
      type: "thread.deep-plan.update",
      runId: nextRunId,
      expectedRevision: 8,
      mutation: { type: "pause", reason: failure.message },
    });
  });

  it("blocks an active approved implementation", async () => {
    const target = api();
    target.getRun.mockResolvedValue(
      run({
        phase: "implementing",
        approval: {
          planVersion: 1,
          approvalKey: "key",
          approvedAt: createdAt,
          approvedBy: "user",
          implementation: { instanceId: ProviderInstanceId.make("provider"), model: "model" },
          implementationThreadId: threadId,
          implementerId: `thread:${threadId}`,
        },
      }),
    );
    await expect(prepare(target)).rejects.toThrow("still active");
    expect(target.dispatchCommand).not.toHaveBeenCalled();
    expect(transferDeepPlanSources).not.toHaveBeenCalled();
  });

  it("requires durable source readiness before returning a prepared run", async () => {
    const target = api();
    target.getRun
      .mockResolvedValueOnce(null)
      .mockResolvedValue(run({ id: nextRunId, phase: "collecting" }));
    await expect(prepare(target)).rejects.toThrow("not been confirmed");
    expect(target.dispatchCommand.mock.calls[1]?.[0]).toMatchObject({
      mutation: { type: "pause" },
    });
  });

  it("does not start a run after cancellation", async () => {
    const target = api();
    const controller = new AbortController();
    controller.abort();
    await expect(prepare(target, { signal: controller.signal })).rejects.toThrow("canceled");
    expect(target.dispatchCommand).not.toHaveBeenCalled();
  });

  it("honors cancellation while reading an otherwise reusable run", async () => {
    const target = api();
    const controller = new AbortController();
    target.getRun.mockImplementation(async () => {
      controller.abort();
      return run();
    });
    await expect(prepare(target, { signal: controller.signal })).rejects.toThrow("canceled");
    expect(target.dispatchCommand).not.toHaveBeenCalled();
  });
});

function implementationRun(phase: DeepPlanRun["phase"] = "paused"): DeepPlanRun {
  const implementationThreadId = ThreadId.make("implementer");
  return run({
    phase,
    plan: {
      schemaVersion: 1,
      version: 1,
      goal: "Preserve work",
      scope: ["Persistence"],
      decisions: [],
      affectedAreas: ["Storage"],
      steps: [
        {
          id: "save",
          title: "Save",
          description: "Persist the approved work",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "restore",
              description: "Work can be restored",
              checkMethod: "Restore the saved state",
            },
          ],
        },
      ],
      finalValidation: {
        description: "Check the complete restored workflow",
        checkMethod: "Run focused integration tests",
      },
    },
    approvalKey: "approval",
    approval: {
      planVersion: 1,
      approvalKey: "approval",
      approvedAt: createdAt,
      approvedBy: "user",
      implementation: {
        instanceId: ProviderInstanceId.make("approved-provider"),
        model: "approved-model",
      },
      implementationThreadId,
      implementerId: `thread:${implementationThreadId}`,
    },
    stepStates: [{ stepId: "save", status: "inProgress", evidence: [], updatedAt: createdAt }],
  });
}

function continueRun(target: DeepPlanningApi, current: DeepPlanRun) {
  let nextId = 0;
  return continueDeepPlanForTurn({
    run: current,
    environmentId,
    projectId,
    fallbackModelSelection: {
      instanceId: ProviderInstanceId.make("another-provider"),
      model: "another-model",
    },
    runtimeMode: "full-access",
    apiForEnvironment: () => target,
    createId: () => `continue-${++nextId}`,
    now: () => createdAt,
  });
}

describe("Deep Plan continuation", () => {
  it("confirms resumption and starts the approved implementing thread with the approved model", async () => {
    const paused = implementationRun();
    const target = api();
    target.getRun
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce({ ...paused, phase: "implementing", revision: 6 });
    await continueRun(target, paused);
    expect(target.dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "thread.deep-plan.update",
      "thread.turn.start",
    ]);
    expect(target.dispatchCommand.mock.calls[1]?.[0]).toMatchObject({
      threadId: paused.approval!.implementationThreadId,
      modelSelection: paused.approval!.implementation,
      interactionMode: "default",
      message: { text: expect.stringContaining("approved plan version 1") },
    });
  });

  it("keeps final validation with the server instead of starting a second validation turn", async () => {
    const paused = implementationRun();
    const verified: DeepPlanRun = {
      ...paused,
      stepStates: [
        {
          stepId: "save",
          status: "verified",
          evidence: [{ kind: "test", summary: "Restore passes", createdAt }],
          updatedAt: createdAt,
        },
      ],
    };
    const target = api();
    const validating: DeepPlanRun = { ...verified, phase: "validating", revision: 6 };
    target.getRun.mockResolvedValueOnce(verified).mockResolvedValueOnce(validating);
    expect(await continueRun(target, verified)).toEqual(validating);
    expect(target.dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "thread.deep-plan.update",
    ]);
    target.dispatchCommand.mockClear();
    target.getRun.mockResolvedValue(validating);
    await continueRun(target, validating);
    expect(target.dispatchCommand).not.toHaveBeenCalled();
  });

  it("does not start work until resumed state is confirmed", async () => {
    const paused = implementationRun();
    const target = api();
    target.getRun.mockResolvedValue(paused);
    await expect(continueRun(target, paused)).rejects.toThrow("not confirmed");
    expect(target.dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "thread.deep-plan.update",
    ]);
  });

  it("continues complete planning sources read-only without capturing history again", async () => {
    const planning = run();
    const target = api();
    target.getRun.mockResolvedValue(planning);
    await continueRun(target, planning);
    expect(transferDeepPlanSources).not.toHaveBeenCalled();
    expect(target.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.turn.start",
      threadId,
      interactionMode: "plan",
      message: { text: expect.stringContaining("deep_plan_publish.") },
    });
  });

  it("waits for approval when a newer plan is awaiting review", async () => {
    const paused = implementationRun();
    const target = api();
    target.getRun.mockResolvedValue({ ...paused, phase: "awaitingApproval", approval: null });
    await continueRun(target, paused);
    expect(target.dispatchCommand).not.toHaveBeenCalled();
  });
});
