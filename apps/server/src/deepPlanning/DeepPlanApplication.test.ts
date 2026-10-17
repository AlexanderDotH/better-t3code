import {
  ClientOrchestrationCommand,
  CommandId,
  DeepPlanRunId,
  DeepPlanSourceError,
  DeepPlanSourceId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanDocument,
  type DeepPlanListSourcesResult,
  type DeepPlanMutation,
  type DeepPlanRun,
  type DeepPlanSourceCoverage,
  type DeepPlanSourceRecord,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionThreadRepositoryLive } from "../persistence/Layers/ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { DeepPlanApplication, DeepPlanApplicationLive } from "./DeepPlanApplication.ts";
import { deepPlanApprovalKey } from "./deepPlanDecision.ts";
import { DeepPlanSources } from "./DeepPlanSources.ts";
import {
  DeepPlanValidationDispatcher,
  DeepPlanValidationReactor,
  DeepPlanValidationReactorLive,
} from "./DeepPlanValidationReactor.ts";
import { DeepPlanWorkflow, DeepPlanWorkflowLive } from "./DeepPlanWorkflow.ts";

const createdAt = "2026-10-16T08:00:00.000Z";
const model = { instanceId: ProviderInstanceId.make("application-provider"), model: "model" };
const decodeClientCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const plan: DeepPlanDocument = {
  schemaVersion: 1,
  version: 1,
  goal: "Keep the complete approved work",
  scope: ["Thread state"],
  decisions: [],
  affectedAreas: ["Persistence"],
  steps: [
    {
      id: "preserve",
      title: "Preserve the work",
      description: "Persist the approved work.",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "restore",
          description: "The run can be restored",
          checkMethod: "Read the persisted run",
        },
      ],
    },
  ],
  finalValidation: {
    description: "Check the complete restored run",
    checkMethod: "Run the focused persistence check",
  },
};

const baseLayer = Layer.mergeAll(
  SqlitePersistenceMemory,
  ServerConfig.layerTest("/tmp/deep-plan-application", { prefix: "t3-deep-plan-app-" }),
  ThreadBackgroundLiveness.layer,
  ThreadPlanProgress.layer,
  Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
).pipe(Layer.provideMerge(NodeServices.layer));

const systemLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  ProjectionThreadRepositoryLive,
).pipe(
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
);

const makeHarness = Effect.fn("DeepPlanApplicationTest.makeHarness")(function* (name: string) {
  const engine = yield* OrchestrationEngineService;
  const repository = yield* ProjectionThreadRepository;
  const projectId = ProjectId.make(`${name}-project`);
  const threadId = ThreadId.make(`${name}-thread`);
  const runId = DeepPlanRunId.make(`${name}-run`);
  const source = {
    sourceId: DeepPlanSourceId.make(`${name}-source`),
    origin: { environmentId: EnvironmentId.make("source-environment"), projectId, threadId },
    projectTitle: name,
    threadTitle: "Requirements",
    archived: true,
    capturedAt: createdAt,
    contentVersion: "frozen-version",
    contentHash: "frozen-hash",
    messageCount: 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: 1,
    forkOrigin: null,
  };
  const records: ReadonlyArray<DeepPlanSourceRecord> = [
    {
      kind: "message",
      recordId: "requirement-record",
      origin: { ...source.origin, recordId: "requirement-message" },
      contentHash: "requirement-hash",
      message: {
        id: MessageId.make("requirement-message"),
        role: "user",
        text: "Preserve all work",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      },
    },
  ];
  const summary = {
    requirements: ["Preserve all work"],
    decisions: [],
    openIssues: [],
    rejectedApproaches: [],
    conflicts: [],
    citedRecordIds: [records[0]!.recordId],
  };
  const sourceCalls: string[] = [];
  let sourceState: DeepPlanListSourcesResult = { runId, sources: [], coverage: [] };
  const sources = DeepPlanSources.of({
    catalogSources: () => Effect.die("Unexpected source catalog request"),
    exportSources: () => Effect.die("Unexpected source export request"),
    readExportChunk: () => Effect.die("Unexpected source export read"),
    initializeSources: (input) =>
      Effect.sync(() => {
        sourceCalls.push("initialize");
        sourceState = {
          runId,
          sources: input.snapshots,
          coverage: input.snapshots.map((snapshot) => ({
            sourceId: snapshot.sourceId,
            status: "pending",
            importedRecordCount: 0,
            readRecordCount: 0,
            summary: null,
            error: null,
            updatedAt: createdAt,
          })),
        };
        return sourceState;
      }),
    importSourceChunk: (input) =>
      Effect.sync(() => {
        sourceCalls.push("import");
        const coverage: DeepPlanSourceCoverage = {
          sourceId: input.snapshot.sourceId,
          status: "ready",
          importedRecordCount: input.snapshot.recordCount,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        };
        sourceState = { ...sourceState, coverage: [coverage] };
        return {
          runId,
          sourceId: input.snapshot.sourceId,
          importedRecordCount: input.snapshot.recordCount,
          complete: true,
          coverage,
        };
      }),
    listSources: () =>
      Effect.sync(() => {
        sourceCalls.push("list");
        return sourceState;
      }),
    readSourceChunk: () =>
      Effect.sync(() => {
        sourceCalls.push("read");
        sourceState = {
          ...sourceState,
          coverage: sourceState.coverage.map((coverage) => ({
            ...coverage,
            readRecordCount: source.recordCount,
          })),
        };
        return { snapshot: source, records, chunkHash: "chunk-hash", nextCursor: null };
      }),
    summarizeSource: () =>
      Effect.sync(() => {
        sourceCalls.push("summarize");
        const coverage: DeepPlanSourceCoverage = {
          ...sourceState.coverage[0]!,
          status: "summarized",
          summary,
        };
        sourceState = { ...sourceState, coverage: [coverage] };
        return coverage;
      }),
    assertCompleteCoverage: () =>
      Effect.suspend(() =>
        sourceState.coverage.length === 1 && sourceState.coverage[0]?.status === "summarized"
          ? Effect.succeed(sourceState)
          : Effect.fail(
              new DeepPlanSourceError({
                code: "incomplete-source",
                message: "The source has not been fully analyzed.",
              }),
            ),
      ),
    validatePlanCitations: () => Effect.void,
  });
  const applicationLayer = DeepPlanApplicationLive.pipe(
    Layer.provideMerge(DeepPlanWorkflowLive),
    Layer.provide(Layer.succeed(DeepPlanSources, sources)),
  );
  const services = yield* Layer.build(applicationLayer);
  const application = Context.get(services, DeepPlanApplication);
  const workflow = Context.get(services, DeepPlanWorkflow);
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make(`${name}-project-create`),
    projectId,
    title: name,
    workspaceRoot: `/tmp/${name}`,
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`${name}-thread-create`),
    threadId,
    projectId,
    title: name,
    modelSelection: model,
    runtimeMode: "full-access",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    createdAt,
  });
  yield* application.dispatch({
    type: "thread.deep-plan.start",
    commandId: CommandId.make(`${name}-run-start`),
    threadId,
    runId,
    createdAt,
  });
  const input = { threadId, runId };
  const readRun = Effect.gen(function* () {
    const row = Option.getOrThrow(yield* repository.getById({ threadId }));
    if (row.deepPlan == null) return yield* Effect.die("Expected a persisted Deep Plan run");
    return row.deepPlan;
  });
  let operation = 0;
  const commandFor = (
    run: DeepPlanRun,
    mutation: DeepPlanMutation,
  ): ThreadDeepPlanUpdateCommand => ({
    type: "thread.deep-plan.update",
    commandId: CommandId.make(`${name}-command-${operation}`),
    threadId,
    runId,
    expectedRevision: run.revision,
    operationId: `${name}-operation-${operation++}`,
    createdAt,
    mutation,
  });
  const agentUpdate = Effect.fnUntraced(function* (mutation: DeepPlanMutation) {
    const run = yield* readRun;
    return yield* workflow.update(commandFor(run, mutation));
  });
  const initialize = () => application.initializeSources({ ...input, snapshots: [source] });
  const importChunk = () =>
    application.importSourceChunk({
      ...input,
      snapshot: source,
      chunkIndex: 0,
      chunkHash: "chunk-hash",
      records,
      finalChunk: true,
    });
  const sourceReadInput = { ...input, sourceId: source.sourceId, includeBodies: false };
  const summaryInput = { ...sourceReadInput, expectedContentHash: source.contentHash, summary };
  const publish = Effect.gen(function* () {
    yield* initialize();
    yield* importChunk();
    yield* application.readSourceChunk(sourceReadInput);
    yield* sources.summarizeSource(summaryInput);
    yield* agentUpdate({ type: "source-coverage", coverage: sourceState.coverage });
    return yield* agentUpdate({ type: "publish-plan", plan });
  });
  const makeValidationReady = Effect.gen(function* () {
    const published = yield* publish;
    yield* application.dispatch(
      commandFor(published, {
        type: "approve",
        planVersion: plan.version,
        approvalKey: deepPlanApprovalKey(plan),
        implementation: model,
        implementationThreadId: threadId,
        implementerId: `thread:${threadId}`,
      }),
    );
    const actor = { implementerId: `thread:${threadId}`, model };
    yield* agentUpdate({
      type: "step-update",
      stepId: "preserve",
      status: "inProgress",
      actor,
      evidence: [],
    });
    yield* agentUpdate({
      type: "step-update",
      stepId: "preserve",
      status: "implemented",
      actor,
      evidence: [],
    });
    return yield* agentUpdate({
      type: "step-update",
      stepId: "preserve",
      status: "verified",
      actor,
      evidence: [{ kind: "test", summary: "The work was restored", createdAt }],
    });
  });
  return {
    application,
    workflow,
    engine,
    input,
    source,
    sourceReadInput,
    summaryInput,
    sourceCalls,
    commandFor,
    agentUpdate,
    readRun,
    initialize,
    importChunk,
    publish,
    makeValidationReady,
  };
});

const makeValidationReactor = Effect.fnUntraced(function* (
  onDispatch: (run: DeepPlanRun, requestId: string) => void,
) {
  const services = yield* Layer.build(
    DeepPlanValidationReactorLive.pipe(
      Layer.provide(
        Layer.succeed(DeepPlanValidationDispatcher, {
          dispatch: (run, requestId) =>
            Effect.sync(() => {
              onDispatch(run, requestId);
              return "dispatched" as const;
            }),
        }),
      ),
    ),
  );
  return Context.get(services, DeepPlanValidationReactor);
});

it.layer(baseLayer)("DeepPlanApplication", (it) => {
  it.effect("projects source initialization and import coverage into the durable run", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("coverage");
      expect((yield* harness.readRun).phase).toBe("collecting");
      yield* harness.initialize();
      const initialized = yield* harness.readRun;
      expect(initialized.phase).toBe("planning");
      expect(initialized.sources).toEqual([harness.source]);
      expect(initialized.sourceCoverage[0]).toMatchObject({
        status: "pending",
        importedRecordCount: 0,
      });
      yield* harness.importChunk();
      const imported = yield* harness.application.getRun(harness.input);
      expect(imported?.sourceCoverage[0]).toMatchObject({
        status: "ready",
        importedRecordCount: 1,
        readRecordCount: 0,
      });
      expect(imported?.revision).toBeGreaterThan(initialized.revision);
      const earlyPublish = yield* harness
        .agentUpdate({ type: "publish-plan", plan })
        .pipe(Effect.flip);
      expect(earlyPublish).toMatchObject({ _tag: "DeepPlanError", code: "sources-incomplete" });
      expect((yield* harness.readRun).plan).toBeNull();
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("allows source inspection after publication while rejecting source changes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("frozen");
      const published = yield* harness.publish;
      const read = yield* harness.application.readSourceChunk(harness.sourceReadInput);
      expect(read.records[0]?.kind).toBe("message");
      expect(yield* harness.readRun).toEqual(published);
      const callCount = harness.sourceCalls.length;
      const initializeError = yield* harness.initialize().pipe(Effect.flip);
      const importError = yield* harness.importChunk().pipe(Effect.flip);
      expect(initializeError.code).toBe("source-unavailable");
      expect(importError.code).toBe("source-unavailable");
      expect(harness.sourceCalls).toHaveLength(callCount);
      expect(yield* harness.readRun).toEqual(published);
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect(
    "rejects client summaries and direct source-state mutations without changing the run",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness("public-write");
        const before = yield* harness.readRun;
        const summaryError = yield* harness.application
          .summarizeSource(harness.summaryInput)
          .pipe(Effect.flip);
        expect(summaryError.code).toBe("source-unavailable");
        expect(harness.sourceCalls).not.toContain("summarize");
        const mutationError = yield* harness.application
          .dispatch(harness.commandFor(before, { type: "sources-set", sources: [harness.source] }))
          .pipe(Effect.flip);
        expect(mutationError.code).toBe("invalid-transition");
        const startError = yield* harness.application
          .dispatch({
            type: "thread.deep-plan.start",
            commandId: CommandId.make("manifest-spoof"),
            ...harness.input,
            sources: [harness.source],
            createdAt,
          })
          .pipe(Effect.flip);
        expect(startError.code).toBe("sources-incomplete");
        expect(yield* harness.readRun).toEqual(before);
      }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("rejects agent mutations at the client command boundary", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("client-boundary");
      const run = yield* harness.readRun;
      const actor = { implementerId: `thread:${harness.input.threadId}`, model };
      const mutations: ReadonlyArray<DeepPlanMutation> = [
        { type: "publish-plan", plan },
        { type: "step-update", stepId: "preserve", status: "verified", evidence: [], actor },
        { type: "validation-start", requestId: "request", actor },
        {
          type: "validation-complete",
          requestId: "request",
          status: "passed",
          evidence: [],
          actor,
        },
        {
          type: "procedure-adjust",
          reason: "Change the method",
          changes: ["Reuse a fixture"],
          actor,
        },
        { type: "block", reason: "Blocked by the agent" },
        { type: "source-coverage", coverage: [] },
      ];
      for (const mutation of mutations) {
        const result = yield* decodeClientCommand(harness.commandFor(run, mutation)).pipe(
          Effect.exit,
        );
        expect(result._tag, mutation.type).toBe("Failure");
      }
      const decodedPause = yield* decodeClientCommand(harness.commandFor(run, { type: "pause" }));
      expect(decodedPause.type).toBe("thread.deep-plan.update");
      expect(yield* harness.readRun).toEqual(run);
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("denies missing runs and another owner before accessing source storage", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("owner-boundary");
      const before = yield* harness.readRun;
      for (const input of [
        { ...harness.input, runId: DeepPlanRunId.make("missing-run") },
        { ...harness.input, threadId: ThreadId.make("another-owner") },
      ]) {
        const listError = yield* harness.application.listSources(input).pipe(Effect.flip);
        const readError = yield* harness.application
          .readSourceChunk({ ...input, sourceId: harness.source.sourceId, includeBodies: false })
          .pipe(Effect.flip);
        expect(listError.code).toBe("run-not-found");
        expect(readError.code).toBe("run-not-found");
      }
      expect(harness.sourceCalls).toEqual([]);
      expect(yield* harness.readRun).toEqual(before);
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("pauses validation on interrupt and dispatches it only after an explicit resume", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("interrupt");
      const ready = yield* harness.makeValidationReady;
      expect(ready.phase).toBe("validating");
      yield* harness.application.pauseForInterrupt(harness.input.threadId);
      const paused = yield* harness.readRun;
      expect(paused.phase).toBe("paused");
      expect(paused.pauseReason).toBe("Stopped by the user.");
      const dispatched: DeepPlanRun[] = [];
      const reactor = yield* makeValidationReactor((run) => {
        if (run.id === harness.input.runId) dispatched.push(run);
      });
      yield* reactor.start();
      yield* reactor.drainThrough(yield* harness.engine.latestSequence);
      expect(dispatched).toEqual([]);
      const receipt = yield* harness.application.dispatch(
        harness.commandFor(paused, { type: "resume" }),
      );
      yield* reactor.drainThrough(receipt.sequence);
      const validationReceipt = Option.getOrThrow(
        yield* reactor.streamReceiptsForTest.pipe(
          Stream.filter((receipt) => receipt.runId === harness.input.runId),
          Stream.runHead,
        ),
      );
      expect(validationReceipt.type).toBe("deep-plan.validation.dispatched");
      expect(validationReceipt.runId).toBe(harness.input.runId);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.phase).toBe("validating");
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("starts a new validation request after interrupting an active check", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("interrupted-check");
      yield* harness.makeValidationReady;
      const requests: string[] = [];
      const reactor = yield* makeValidationReactor((run, requestId) => {
        if (run.id === harness.input.runId) requests.push(requestId);
      });
      yield* reactor.start();
      yield* reactor.drainThrough(yield* harness.engine.latestSequence);
      expect(requests).toHaveLength(1);
      const firstRequestId = requests[0]!;
      const actor = { implementerId: `thread:${harness.input.threadId}`, model };
      const checking = yield* harness.agentUpdate({
        type: "validation-start",
        requestId: firstRequestId,
        actor,
      });
      yield* reactor.drainThrough(yield* harness.engine.latestSequence);
      expect(checking.finalValidation.status).toBe("inProgress");
      yield* harness.application.pauseForInterrupt(harness.input.threadId);
      const paused = yield* harness.readRun;
      expect(paused.phase).toBe("paused");
      expect(paused.finalValidation).toMatchObject({
        status: "pending",
        attempt: checking.finalValidation.attempt + 1,
        requestId: null,
        turnId: null,
        evidence: [],
      });
      yield* reactor.drainThrough(yield* harness.engine.latestSequence);
      expect(requests).toHaveLength(1);
      const resumed = yield* harness.application.dispatch(
        harness.commandFor(paused, { type: "resume" }),
      );
      yield* reactor.drainThrough(resumed.sequence);
      expect(requests).toHaveLength(2);
      const nextRequestId = requests[1]!;
      expect(nextRequestId).not.toBe(firstRequestId);
      yield* harness.agentUpdate({ type: "validation-start", requestId: nextRequestId, actor });
      const evidence = [
        { kind: "test" as const, summary: "The complete run was checked", createdAt },
      ];
      const staleResult = yield* harness
        .agentUpdate({
          type: "validation-complete",
          requestId: firstRequestId,
          actor,
          status: "passed",
          evidence,
        })
        .pipe(Effect.flip);
      expect(staleResult).toMatchObject({ _tag: "DeepPlanError", code: "invalid-transition" });
      const finished = yield* harness.agentUpdate({
        type: "validation-complete",
        requestId: nextRequestId,
        actor,
        status: "passed",
        evidence,
      });
      expect(finished.phase).toBe("completed");
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );
});
