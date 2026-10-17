import { expect, it, vi } from "@effect/vitest";
import {
  CommandId,
  DeepPlanError,
  DeepPlanRunId,
  DeepPlanSourceError,
  DeepPlanSourceId,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type DeepPlanSourceSnapshot,
  ProjectId,
  SubagentId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { GeneralSubagentCoordinator } from "../../../subagents/GeneralSubagentCoordinator.ts";

import {
  DeepPlanSources,
  type DeepPlanSourcesShape,
} from "../../../deepPlanning/DeepPlanSources.ts";
import { DeepPlanWorkflow } from "../../../deepPlanning/DeepPlanWorkflow.ts";
import { deepPlanApprovalKey, updateDeepPlanRun } from "../../../deepPlanning/deepPlanDecision.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../McpInvocationContext.ts";
import {
  invokeDeepPlanAnalyzeSources,
  invokeDeepPlanSources,
  invokeDeepPlanPublish,
  invokeDeepPlanReadSource,
  invokeDeepPlanState,
  invokeDeepPlanStepUpdate,
  invokeDeepPlanSummarizeSource,
  invokeDeepPlanValidation,
} from "./handlers.ts";

const threadId = ThreadId.make("plan-owner");
const runId = DeepPlanRunId.make("run-current");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" };
const timestamp = "2026-10-16T10:00:00.000Z";
const run: DeepPlanRun = {
  id: runId,
  threadId,
  phase: "planning",
  revision: 3,
  plan: null,
  approval: null,
  approvalKey: null,
  sources: [],
  sourceCoverage: [],
  stepStates: [],
  procedureAdjustments: [],
  operations: [],
  finalValidation: {
    status: "pending",
    evidence: [],
    updatedAt: null,
    attempt: 0,
    requestId: null,
    turnId: null,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  pauseReason: null,
};
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("local"),
  ownerThreadId: threadId,
  threadId,
  providerSessionId: "provider-session",
  providerInstanceId: modelSelection.instanceId,
  issuedAt: 1,
  capabilities: new Set(["deep-plan"]),
  deepPlan: {
    runId,
    runThreadId: threadId,
    phase: "planning",
    approvedPlanVersion: null,
    modelSelection,
  },
};
const plan = {
  schemaVersion: 1 as const,
  version: 1,
  goal: "Fix the parser",
  scope: ["Parser behavior"],
  decisions: [],
  affectedAreas: ["parser"],
  steps: [
    {
      id: "step-1",
      title: "Fix parser",
      description: "Handle empty input",
      dependencies: [],
      acceptanceCriteria: [
        { id: "empty", description: "Empty input parses", checkMethod: "Run parser test" },
      ],
    },
  ],
  finalValidation: {
    description: "Parser works end to end",
    checkMethod: "Run the parser integration test",
  },
};
const evidence = [{ kind: "test" as const, summary: "Parser test passed", createdAt: timestamp }];
const update = { expectedRunId: runId, expectedRevision: 3, operationId: "operation-1" };

function harness(
  options: {
    readonly run?: DeepPlanRun;
    readonly scope?: McpInvocationScope;
    readonly sources?: Partial<DeepPlanSourcesShape>;
    readonly withRunLock?: DeepPlanWorkflow["Service"]["withRunLock"];
  } = {},
) {
  const current = options.run ?? run;
  const getRun = vi.fn<DeepPlanWorkflow["Service"]["getRun"]>(() => Effect.succeed(current));
  const updateRun = vi.fn<DeepPlanWorkflow["Service"]["update"]>(() =>
    Effect.succeed({ ...current, revision: current.revision + 1 }),
  );
  const workflow = DeepPlanWorkflow.of({
    withRunLock: options.withRunLock ?? ((_runId, effect) => effect),
    getRun,
    update: updateRun,
    start: () => Effect.die("Unexpected start"),
  });
  const sources = DeepPlanSources.of({
    catalogSources: () => Effect.die("Unexpected catalog"),
    validatePlanCitations: () => Effect.void,
    exportSources: () => Effect.die("Unexpected export"),
    readExportChunk: () => Effect.die("Unexpected export read"),
    initializeSources: () => Effect.die("Unexpected initialize"),
    importSourceChunk: () => Effect.die("Unexpected import"),
    listSources: () =>
      Effect.succeed({ runId, sources: current.sources, coverage: current.sourceCoverage }),
    readSourceChunk: () => Effect.die("Unexpected source read"),
    summarizeSource: () => Effect.die("Unexpected summary"),
    assertCompleteCoverage: () =>
      Effect.succeed({ runId, sources: current.sources, coverage: current.sourceCoverage }),
    ...options.sources,
  });
  const provide = <A, E>(
    effect: Effect.Effect<A, E, DeepPlanWorkflow | DeepPlanSources | McpInvocationContext>,
    invocation: McpInvocationScope = options.scope ?? scope,
  ) =>
    effect.pipe(
      Effect.provideService(DeepPlanWorkflow, workflow),
      Effect.provideService(DeepPlanSources, sources),
      Effect.provideService(McpInvocationContext, invocation),
    );
  return { getRun, updateRun, provide };
}

function implementing(implementationThreadId = threadId) {
  const approved: DeepPlanRun = {
    ...run,
    phase: "implementing",
    plan,
    approvalKey: "approval-1",
    approval: {
      planVersion: 1,
      approvalKey: "approval-1",
      approvedAt: timestamp,
      approvedBy: "user",
      implementation: modelSelection,
      implementationThreadId,
      implementerId: `thread:${implementationThreadId}`,
    },
  };
  const invocation: McpInvocationScope = {
    ...scope,
    ownerThreadId: implementationThreadId,
    threadId: implementationThreadId,
    deepPlan: {
      runId,
      runThreadId: threadId,
      phase: "execution",
      approvedPlanVersion: 1,
      modelSelection,
    },
  };
  return { run: approved, scope: invocation };
}

it.effect("rejects credentials without a run grant before reading any run", () =>
  Effect.gen(function* () {
    const test = harness({ scope: { ...scope, capabilities: new Set() } });
    const error = yield* test.provide(invokeDeepPlanState()).pipe(Effect.flip);
    expect(error).toMatchObject({
      _tag: "DeepPlanToolScopeError",
      reason: "credential-not-authorized",
    });
    expect(test.getRun).not.toHaveBeenCalled();
  }),
);

it.effect("rejects delegated credentials and run assertions from an earlier run", () =>
  Effect.gen(function* () {
    const foreign = harness({ scope: { ...scope, ownerThreadId: ThreadId.make("another-owner") } });
    expect(yield* foreign.provide(invokeDeepPlanState()).pipe(Effect.flip)).toMatchObject({
      reason: "owner-mismatch",
    });
    expect(foreign.getRun).not.toHaveBeenCalled();
    const current = harness(implementing());
    expect(
      yield* current
        .provide(
          invokeDeepPlanStepUpdate({
            ...update,
            expectedRunId: DeepPlanRunId.make("run-old"),
            stepId: "step-1",
            status: "verified",
            evidence,
          }),
        )
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "stale-run" });
    expect(current.updateRun).not.toHaveBeenCalled();
  }),
);

it.effect("rejects an approval superseded by another plan version", () =>
  Effect.gen(function* () {
    const current = implementing();
    const test = harness({
      ...current,
      scope: { ...current.scope, deepPlan: { ...current.scope.deepPlan!, approvedPlanVersion: 2 } },
    });
    expect(
      yield* test
        .provide(
          invokeDeepPlanStepUpdate({ ...update, stepId: "step-1", status: "verified", evidence }),
        )
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "stale-plan" });
    expect(test.updateRun).not.toHaveBeenCalled();
  }),
);

it.effect("binds execution in a new implementation thread and ignores caller actor spoofing", () =>
  Effect.gen(function* () {
    const implementationThreadId = ThreadId.make("implement-owner");
    const test = harness(implementing(implementationThreadId));
    const input = {
      ...update,
      stepId: "step-1",
      status: "verified" as const,
      evidence,
      actor: {
        implementerId: "foreign",
        model: { instanceId: ProviderInstanceId.make("foreign"), model: "another-model" },
      },
    };
    const receipt = yield* test.provide(invokeDeepPlanStepUpdate(input));
    expect(receipt).toEqual({
      runId,
      revision: 4,
      phase: "implementing",
      planVersion: 1,
      approvedPlanVersion: 1,
      finalValidation: run.finalValidation,
    });
    expect(test.getRun).toHaveBeenCalledWith({ threadId, runId });
    expect(test.updateRun).toHaveBeenCalledWith({
      threadId,
      runId,
      expectedRevision: 3,
      operationId: "operation-1",
      mutation: {
        type: "step-update",
        stepId: "step-1",
        status: "verified",
        evidence,
        actor: { implementerId: `thread:${implementationThreadId}`, model: modelSelection },
      },
    });
  }),
);

it.effect("does not allow planning credentials to record execution or final validation", () =>
  Effect.gen(function* () {
    const test = harness();
    expect(
      yield* test
        .provide(
          invokeDeepPlanValidation({
            ...update,
            type: "complete",
            requestId: "validation-1",
            status: "passed",
            evidence,
          }),
        )
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "phase-mismatch" });
    expect(test.updateRun).not.toHaveBeenCalled();
  }),
);

it.effect("reads only frozen sources of the credential's run", () =>
  Effect.gen(function* () {
    const sourceId = DeepPlanSourceId.make("source-1");
    const readSourceChunk = vi.fn<DeepPlanSourcesShape["readSourceChunk"]>(() =>
      Effect.fail(new DeepPlanSourceError({ code: "source-not-found", message: "Not granted" })),
    );
    const test = harness({ sources: { readSourceChunk } });
    const input = {
      expectedRunId: runId,
      sourceId,
      cursor: "cursor-2",
      limit: 10,
      threadId: ThreadId.make("foreign"),
      runId: DeepPlanRunId.make("foreign"),
    };
    yield* test.provide(invokeDeepPlanReadSource(input)).pipe(Effect.flip);
    expect(readSourceChunk).toHaveBeenCalledWith({
      threadId,
      runId,
      sourceId,
      cursor: "cursor-2",
      limit: 10,
      includeBodies: false,
    });
  }),
);

it.effect("rejects stale source summaries before persisting them", () =>
  Effect.gen(function* () {
    const summarizeSource = vi.fn<DeepPlanSourcesShape["summarizeSource"]>(() =>
      Effect.die("Unexpected summary"),
    );
    const test = harness({ sources: { summarizeSource } });
    const error = yield* test
      .provide(
        invokeDeepPlanSummarizeSource({
          ...update,
          expectedRevision: 2,
          sourceId: DeepPlanSourceId.make("source-1"),
          expectedContentHash: "hash",
          summary: {
            requirements: [],
            decisions: [],
            openIssues: [],
            rejectedApproaches: [],
            conflicts: [],
            citedRecordIds: [],
          },
        }),
      )
      .pipe(Effect.flip);
    expect(error).toMatchObject({ code: "stale-revision" });
    expect(summarizeSource).not.toHaveBeenCalled();
  }),
);

it.effect("does not advance source coverage after a run is paused", () =>
  Effect.gen(function* () {
    const readSourceChunk = vi.fn<DeepPlanSourcesShape["readSourceChunk"]>(() =>
      Effect.die("Unexpected source read"),
    );
    const test = harness({ run: { ...run, phase: "paused" }, sources: { readSourceChunk } });
    const error = yield* test
      .provide(
        invokeDeepPlanReadSource({
          expectedRunId: runId,
          sourceId: DeepPlanSourceId.make("source-1"),
        }),
      )
      .pipe(Effect.flip);
    expect(error).toMatchObject({ reason: "phase-mismatch" });
    expect(readSourceChunk).not.toHaveBeenCalled();
  }),
);

it.effect("refuses plan publication until authoritative frozen coverage is complete", () =>
  Effect.gen(function* () {
    const test = harness({
      sources: {
        assertCompleteCoverage: () =>
          Effect.fail(
            new DeepPlanSourceError({
              code: "incomplete-source",
              message: "Source pages remain unread",
            }),
          ),
      },
    });
    expect(
      yield* test.provide(invokeDeepPlanPublish({ ...update, plan })).pipe(Effect.flip),
    ).toMatchObject({ code: "incomplete-source" });
    expect(test.updateRun).not.toHaveBeenCalled();
  }),
);

it.effect("persists final evidence with the bound implementing agent and request", () =>
  Effect.gen(function* () {
    const test = harness(implementing());
    yield* test.provide(
      invokeDeepPlanValidation({
        ...update,
        type: "complete",
        requestId: "validation-1",
        status: "passed",
        evidence,
      }),
    );
    expect(test.updateRun.mock.calls[0]?.[0].mutation).toEqual({
      type: "validation-complete",
      requestId: "validation-1",
      status: "passed",
      evidence,
      actor: { implementerId: `thread:${threadId}`, model: modelSelection },
    });
  }),
);

it.effect("derives final validation identity and rejects invented request IDs", () =>
  Effect.gen(function* () {
    const test = harness(implementing());
    const error = yield* test
      .provide(invokeDeepPlanValidation({ ...update, type: "start", requestId: "invented" }))
      .pipe(Effect.flip);
    expect(error).toMatchObject({ code: "validation-required" });
    expect(test.updateRun).not.toHaveBeenCalled();
    yield* test.provide(invokeDeepPlanValidation({ ...update, type: "start" }));
    expect(test.updateRun.mock.calls[0]?.[0].mutation).toMatchObject({
      type: "validation-start",
      requestId: `deep-plan:${runId}:validation:1:0`,
    });
  }),
);

it.effect(
  "returns an approved revision to review and rejects its obsolete execution credential",
  () =>
    Effect.gen(function* () {
      for (const phase of ["implementing", "validating"] as const) {
        const implementationThreadId = ThreadId.make("revision-implementer");
        const bound = implementing(implementationThreadId);
        const approvalKey = deepPlanApprovalKey(plan);
        let current: DeepPlanRun = {
          ...bound.run,
          phase,
          approvalKey,
          approval: { ...bound.run.approval!, approvalKey },
          stepStates: [{ stepId: "step-1", status: "verified", evidence, updatedAt: timestamp }],
        };
        const test = harness({ ...bound, run: current });
        test.getRun.mockImplementation(() => Effect.succeed(current));
        test.updateRun.mockImplementation((input) =>
          updateDeepPlanRun(current, {
            ...input,
            type: "thread.deep-plan.update",
            commandId: CommandId.make("revision-command"),
            createdAt: timestamp,
          }).pipe(
            Effect.mapError(
              (error) => new DeepPlanError({ code: "invalid-transition", message: error.detail }),
            ),
            Effect.tap((updated) =>
              Effect.sync(() => {
                current = updated;
              }),
            ),
          ),
        );
        const revised = { ...plan, version: 2, scope: ["Parser behavior", "Parser diagnostics"] };
        const receipt = yield* test.provide(invokeDeepPlanPublish({ ...update, plan: revised }));
        expect(receipt).toMatchObject({
          phase: "awaitingApproval",
          planVersion: 2,
          approvedPlanVersion: null,
        });
        expect(current.plan).toEqual(revised);
        expect(current.approval).toBeNull();
        expect(current.stepStates).toMatchObject([
          { stepId: "step-1", status: "pending", evidence: [] },
        ]);
        expect(current.finalValidation.status).toBe("pending");
        const stale = yield* test
          .provide(
            invokeDeepPlanStepUpdate({
              ...update,
              expectedRevision: receipt.revision,
              stepId: "step-1",
              status: "verified",
              evidence,
            }),
          )
          .pipe(Effect.flip);
        expect(stale).toMatchObject({ reason: "stale-plan" });
      }
    }),
);

function frozenSource(id: string): DeepPlanSourceSnapshot {
  return {
    sourceId: DeepPlanSourceId.make(id),
    origin: {
      environmentId: scope.environmentId,
      projectId: ProjectId.make("project"),
      threadId: ThreadId.make(id),
    },
    projectTitle: "Project",
    threadTitle: id,
    archived: true,
    capturedAt: timestamp,
    contentVersion: "1",
    contentHash: `hash-${id}`,
    messageCount: 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: 1,
    forkOrigin: null,
  };
}

function sourceWorkerScope(
  sourceId: import("@t3tools/contracts").DeepPlanSourceId,
): McpInvocationScope {
  const workerThreadId = ThreadId.make(`analysis-worker:${sourceId}`);
  return {
    ...scope,
    ownerThreadId: workerThreadId,
    deepPlan: {
      ...scope.deepPlan!,
      readOnly: true,
      sourceAnalysis: { workerThreadId, sourceIds: [sourceId] },
    },
  };
}

it.effect(
  "limits source workers to their own batch and prevents plan publication or delegation",
  () =>
    Effect.gen(function* () {
      const source = frozenSource("source-1");
      const other = frozenSource("source-2");
      const readSourceChunk = vi.fn<DeepPlanSourcesShape["readSourceChunk"]>(() =>
        Effect.fail(
          new DeepPlanSourceError({ code: "source-not-found", message: "Read reached storage" }),
        ),
      );
      const test = harness({
        run: { ...run, sources: [source, other] },
        scope: sourceWorkerScope(source.sourceId),
        sources: { readSourceChunk },
      });
      expect((yield* test.provide(invokeDeepPlanSources())).sources).toEqual([source]);
      expect((yield* test.provide(invokeDeepPlanState())).sources).toEqual([source]);
      expect(
        yield* test
          .provide(invokeDeepPlanReadSource({ expectedRunId: runId, sourceId: other.sourceId }))
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "owner-mismatch" });
      expect(readSourceChunk).not.toHaveBeenCalled();
      expect(
        yield* test
          .provide(invokeDeepPlanReadSource({ expectedRunId: runId, sourceId: source.sourceId }))
          .pipe(Effect.flip),
      ).toMatchObject({ message: "Read reached storage" });
      expect(
        yield* test.provide(invokeDeepPlanPublish({ ...update, plan })).pipe(Effect.flip),
      ).toMatchObject({ reason: "owner-mismatch" });
      expect(
        yield* test
          .provide(invokeDeepPlanAnalyzeSources({ expectedRunId: runId }))
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "owner-mismatch" });
      expect(test.updateRun).not.toHaveBeenCalled();
    }),
);

it.effect(
  "rebases only assigned source summaries onto the current revision when parallel workers advance it",
  () =>
    Effect.gen(function* () {
      const source = frozenSource("source-1");
      const summary = {
        requirements: ["Preserve behavior"],
        decisions: [],
        openIssues: [],
        rejectedApproaches: [],
        conflicts: [],
        citedRecordIds: ["record-1"],
      };
      const coverage = {
        sourceId: source.sourceId,
        status: "summarized" as const,
        importedRecordCount: 1,
        readRecordCount: 1,
        summary,
        error: null,
        updatedAt: timestamp,
      };
      const summarizeSource = vi.fn<DeepPlanSourcesShape["summarizeSource"]>(() =>
        Effect.succeed(coverage),
      );
      const test = harness({
        run: { ...run, revision: 8, sources: [source] },
        scope: sourceWorkerScope(source.sourceId),
        sources: {
          summarizeSource,
          listSources: () => Effect.succeed({ runId, sources: [source], coverage: [coverage] }),
        },
      });
      yield* test.provide(
        invokeDeepPlanSummarizeSource({
          ...update,
          sourceId: source.sourceId,
          expectedContentHash: source.contentHash,
          summary,
        }),
      );
      expect(summarizeSource).toHaveBeenCalledOnce();
      expect(test.updateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 8,
          mutation: { type: "source-coverage", coverage: [coverage] },
        }),
      );
      expect(
        yield* test
          .provide(
            invokeDeepPlanSummarizeSource({
              ...update,
              sourceId: DeepPlanSourceId.make("not-assigned"),
              expectedContentHash: "hash",
              summary,
            }),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "owner-mismatch" });
      expect(summarizeSource).toHaveBeenCalledOnce();
    }),
);

it.effect(
  "releases the run lock while waiting, and never counts a completed worker without a saved summary",
  () =>
    Effect.gen(function* () {
      const source = frozenSource("source-1");
      let locked = false;
      const test = harness({
        run: { ...run, sources: [source] },
        withRunLock: (_runId, effect) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              expect(locked).toBe(false);
              locked = true;
            }),
            () => effect,
            () =>
              Effect.sync(() => {
                locked = false;
              }),
          ),
        sources: {
          listSources: () =>
            Effect.succeed({
              runId,
              sources: [source],
              coverage: [
                {
                  sourceId: source.sourceId,
                  status: "ready",
                  importedRecordCount: 1,
                  readRecordCount: 1,
                  summary: null,
                  error: null,
                  updatedAt: timestamp,
                },
              ],
            }),
        },
      });
      const agent = {
        agentId: SubagentId.make("analysis-1"),
        status: "starting" as const,
        providerInstanceId: modelSelection.instanceId,
        providerDriver: ProviderDriverKind.make("codex"),
        model: modelSelection.model,
        reasoningEffort: null,
      };
      const layer = Layer.mock(GeneralSubagentCoordinator)({
        analyzeDeepPlanSources: (input) =>
          Effect.sync(() => {
            expect(locked).toBe(true);
            expect(input.sources).toEqual([source]);
            return [{ ...agent, sourceIds: [source.sourceId] }];
          }),
        wait: () =>
          Effect.sync(() => {
            expect(locked).toBe(false);
            return {
              agents: [{ ...agent, status: "completed", result: null }],
              allTerminal: true,
              timedOut: false,
            };
          }),
      });
      const result = yield* test
        .provide(invokeDeepPlanAnalyzeSources({ expectedRunId: runId }))
        .pipe(Effect.provide(layer));
      expect(result).toMatchObject({
        complete: false,
        remainingSourceCount: 1,
        batchSize: 4,
        maxParallelBatches: 4,
      });
    }),
);

it.effect("rejects a source grant replayed by another worker or after user approval", () =>
  Effect.gen(function* () {
    const sourceId = DeepPlanSourceId.make("source-1");
    const worker = sourceWorkerScope(sourceId);
    const replay = harness({
      scope: { ...worker, ownerThreadId: ThreadId.make("sibling-worker") },
    });
    expect(yield* replay.provide(invokeDeepPlanState()).pipe(Effect.flip)).toMatchObject({
      reason: "owner-mismatch",
    });
    const approved = harness({ run: implementing().run, scope: worker });
    expect(yield* approved.provide(invokeDeepPlanState()).pipe(Effect.flip)).toMatchObject({
      reason: "owner-mismatch",
    });
  }),
);

it.effect(
  "keeps both summaries when two source workers save against the same observed revision",
  () =>
    Effect.gen(function* () {
      const sources = [frozenSource("parallel-1"), frozenSource("parallel-2")];
      const coverage = sources.map((source) => ({
        sourceId: source.sourceId,
        status: "ready" as const,
        importedRecordCount: 1,
        readRecordCount: 1,
        summary: null,
        error: null,
        updatedAt: timestamp,
      }));
      let current: DeepPlanRun = { ...run, sources, sourceCoverage: coverage };
      let storedCoverage: DeepPlanRun["sourceCoverage"] = coverage;
      const lock = yield* Semaphore.make(1);
      const test = harness({
        run: current,
        withRunLock: (_runId, effect) => lock.withPermit(effect),
        sources: {
          listSources: () => Effect.sync(() => ({ runId, sources, coverage: storedCoverage })),
          summarizeSource: (input) =>
            Effect.sync(() => {
              const updated = {
                sourceId: input.sourceId,
                status: "summarized" as const,
                importedRecordCount: 1,
                readRecordCount: 1,
                summary: input.summary,
                error: null,
                updatedAt: timestamp,
              };
              storedCoverage = storedCoverage.map((entry) =>
                entry.sourceId === input.sourceId ? updated : entry,
              );
              return updated;
            }),
        },
      });
      test.getRun.mockImplementation(() => Effect.sync(() => current));
      test.updateRun.mockImplementation((input) =>
        updateDeepPlanRun(current, {
          ...input,
          type: "thread.deep-plan.update",
          commandId: CommandId.make(input.operationId),
          createdAt: timestamp,
        }).pipe(
          Effect.mapError(
            (error) => new DeepPlanError({ code: "invalid-transition", message: error.detail }),
          ),
          Effect.tap((updated) =>
            Effect.sync(() => {
              current = updated;
            }),
          ),
        ),
      );
      yield* Effect.forEach(
        sources,
        (source) =>
          test.provide(
            invokeDeepPlanSummarizeSource({
              ...update,
              operationId: `summary:${source.sourceId}`,
              sourceId: source.sourceId,
              expectedContentHash: source.contentHash,
              summary: {
                requirements: [source.threadTitle],
                decisions: [],
                openIssues: [],
                rejectedApproaches: [],
                conflicts: [],
                citedRecordIds: ["record-1"],
              },
            }),
            sourceWorkerScope(source.sourceId),
          ),
        { concurrency: "unbounded" },
      );
      expect(current.revision).toBe(run.revision + 2);
      expect(current.sourceCoverage.map((entry) => entry.status)).toEqual([
        "summarized",
        "summarized",
      ]);
      expect(current.sourceCoverage.map((entry) => entry.summary?.requirements)).toEqual([
        ["parallel-1"],
        ["parallel-2"],
      ]);
    }),
);
