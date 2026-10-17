import type { DeepPlanningApi } from "@t3tools/client-runtime/deep-planning";
import {
  CommandId,
  DeepPlanExportId,
  DeepPlanRun as DeepPlanRunSchema,
  DeepPlanSourceError,
  DeepPlanSourceId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  DeepPlanRunId,
  type DeepPlanRun,
  type DeepPlanSourceCoverage,
  type DeepPlanSourceRecord,
  type DeepPlanSourceSnapshot,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { prepareQueuedDeepPlan } from "./deep-planning-delivery";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  resolveThreadOutboxDeliveryAction,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

const environmentId = EnvironmentId.make("mobile-owner");
const remoteId = EnvironmentId.make("mobile-source");
const projectId = ProjectId.make("project-owner");
const remoteProjectId = ProjectId.make("project-source");
const threadId = ThreadId.make("new-deep-owner");
const createdAt = "2026-10-16T10:00:00.000Z";
const decodeDeepPlanRun = Schema.decodeUnknownSync(DeepPlanRunSchema);
const modelSelection = { instanceId: ProviderInstanceId.make("provider"), model: "model" };
const capabilities: ExecutionEnvironmentCapabilities = {
  repositoryIdentity: false,
  midChatProviderSwitching: false,
  deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
};
const provider: ServerProvider = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("custom-provider"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: createdAt,
  models: [],
  slashCommands: [],
  skills: [],
  deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
};

function source(id: string, remote = false, archived = false): DeepPlanSourceSnapshot {
  return {
    sourceId: DeepPlanSourceId.make(id),
    origin: {
      environmentId: remote ? remoteId : environmentId,
      projectId: remote ? remoteProjectId : projectId,
      threadId: ThreadId.make(id),
    },
    projectTitle: remote ? "Other project" : "Current project",
    threadTitle: id,
    archived,
    capturedAt: createdAt,
    contentVersion: "1",
    contentHash: `hash-${id}`,
    messageCount: 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: 1,
    forkOrigin: null,
  };
}

const sources = [
  source("active-chat"),
  source("archived-chat", false, true),
  source("remote-chat", true, true),
];
const remoteSource = sources[2]!;

function queuedMessage(overrides?: Partial<QueuedThreadMessage>): QueuedThreadMessage {
  return {
    environmentId,
    threadId,
    messageId: MessageId.make("queued-deep-analysis"),
    commandId: CommandId.make("queued-deep-command"),
    text: "Analyze the complete project history",
    attachments: [],
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "plan",
    composerMode: "deep-plan",
    deepPlanSourceRefs: [remoteSource.origin],
    creation: { projectId, workspaceMode: "local", branch: null, worktreePath: null },
    createdAt,
    ...overrides,
  };
}

function persistedMessage(message: QueuedThreadMessage): QueuedThreadMessage {
  return decodeQueuedThreadMessage(JSON.parse(JSON.stringify(encodeQueuedThreadMessage(message))));
}

const creation = {
  projectId,
  title: "Analyze the complete project history",
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "plan",
  branch: null,
  worktreePath: null,
  createdAt,
} satisfies NonNullable<Parameters<typeof prepareQueuedDeepPlan>[0]["creation"]>;

function deliveryHarness(failedSourceId?: DeepPlanSourceSnapshot["sourceId"]) {
  const threads = new Set<ThreadId>();
  const acceptedCommands = new Set<CommandId>();
  const exports = new Map<DeepPlanExportId, ReadonlyArray<DeepPlanSourceSnapshot>>();
  const importedRecords = new Map<
    DeepPlanSourceSnapshot["sourceId"],
    ReadonlyArray<DeepPlanSourceRecord>
  >();
  const apis = new Map<EnvironmentId, DeepPlanningApi>();
  let run: DeepPlanRun | null = null;
  let identifier = 0;
  let ownerCreations = 0;
  let runStarts = 0;
  const requireRun = (runId: DeepPlanRun["id"]): DeepPlanRun => {
    if (!run || run.id !== runId) throw new Error("Unknown Deep Plan run");
    return run;
  };
  const apiForEnvironment = (id: EnvironmentId): DeepPlanningApi => {
    const cached = apis.get(id);
    if (cached) return cached;
    const api: DeepPlanningApi = {
      catalogSources: async () => {
        throw new Error("Delivery must freeze source exports");
      },
      exportSources: async (input) => {
        if (!threads.has(threadId)) throw new Error("Create the owner before exporting sources");
        const selected = sources.filter(
          (snapshot) =>
            snapshot.origin.environmentId === id &&
            snapshot.origin.projectId === input.projectId &&
            (input.includeArchived || !snapshot.archived) &&
            (!input.threadIds || input.threadIds.includes(snapshot.origin.threadId)),
        );
        const exportId = DeepPlanExportId.make(`export-${exports.size + 1}`);
        exports.set(exportId, selected);
        return { exportId, capturedAt: createdAt, sources: selected, nextCursor: null };
      },
      readExportChunk: async (input) => {
        const snapshot = exports
          .get(input.exportId)
          ?.find(
            (candidate) =>
              candidate.sourceId === input.sourceId && candidate.origin.environmentId === id,
          );
        if (!snapshot) throw new Error("Unknown frozen source");
        if (snapshot.sourceId === failedSourceId)
          throw new DeepPlanSourceError({
            code: "source-unavailable",
            message: "The selected remote chat is unavailable",
            sourceId: snapshot.sourceId,
          });
        const recordId = `record-${snapshot.sourceId}`;
        const record: DeepPlanSourceRecord = {
          kind: "message",
          recordId,
          origin: { ...snapshot.origin, recordId },
          contentHash: `hash-${recordId}`,
          message: {
            id: MessageId.make(recordId),
            role: "user",
            text: `Complete history of ${snapshot.threadTitle}`,
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        };
        return {
          snapshot,
          records: [record],
          chunkHash: `chunk-${snapshot.sourceId}`,
          nextCursor: null,
        };
      },
      initializeSources: async (input) => {
        const current = requireRun(input.runId);
        importedRecords.clear();
        const coverage: ReadonlyArray<DeepPlanSourceCoverage> = input.snapshots.map((snapshot) => ({
          sourceId: snapshot.sourceId,
          status: "pending",
          importedRecordCount: 0,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        }));
        run = {
          ...current,
          sources: input.snapshots,
          sourceCoverage: coverage,
          revision: current.revision + 1,
        };
        return { runId: input.runId, sources: run.sources, coverage };
      },
      importSourceChunk: async (input) => {
        const current = requireRun(input.runId);
        const records = [...(importedRecords.get(input.snapshot.sourceId) ?? []), ...input.records];
        importedRecords.set(input.snapshot.sourceId, records);
        const coverage: DeepPlanSourceCoverage = {
          sourceId: input.snapshot.sourceId,
          status: input.finalChunk ? "ready" : "importing",
          importedRecordCount: records.length,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        };
        const sourceCoverage = current.sourceCoverage.map((entry) =>
          entry.sourceId === coverage.sourceId ? coverage : entry,
        );
        run = {
          ...current,
          sourceCoverage,
          phase: sourceCoverage.every((entry) => entry.status === "ready")
            ? "planning"
            : "collecting",
          revision: current.revision + 1,
        };
        return {
          runId: input.runId,
          sourceId: input.snapshot.sourceId,
          importedRecordCount: records.length,
          complete: input.finalChunk,
          coverage,
        };
      },
      getRun: async (input) =>
        run?.threadId === input.threadId && (!input.runId || input.runId === run.id)
          ? decodeDeepPlanRun(JSON.parse(JSON.stringify(run)))
          : null,
      dispatchCommand: async (command) => {
        if (acceptedCommands.has(command.commandId)) return {};
        acceptedCommands.add(command.commandId);
        if (command.type === "thread.create") {
          threads.add(command.threadId);
          ownerCreations += 1;
        } else if (command.type === "thread.deep-plan.start") {
          if (!threads.has(command.threadId))
            throw new Error("Deep Planning needs its owner thread");
          runStarts += 1;
          run = {
            id: command.runId,
            threadId: command.threadId,
            phase: "collecting",
            revision: 0,
            plan: null,
            approval: null,
            approvalKey: null,
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
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            pauseReason: null,
          };
        } else if (
          command.type === "thread.deep-plan.update" &&
          command.mutation.type === "pause"
        ) {
          const current = requireRun(command.runId);
          if (command.expectedRevision !== current.revision)
            throw new Error("Stale Deep Plan mutation");
          run = {
            ...current,
            phase: "paused",
            pauseReason: command.mutation.reason ?? null,
            revision: current.revision + 1,
          };
        } else {
          throw new Error(`Unexpected preparation command: ${command.type}`);
        }
        return {};
      },
    };
    apis.set(id, api);
    return api;
  };
  return {
    prepare: (message = persistedMessage(queuedMessage())) =>
      prepareQueuedDeepPlan({
        message,
        projectId,
        creation,
        capabilities,
        provider,
        apiForEnvironment,
        createId: () => `delivery-id-${++identifier}`,
      }),
    state: () => ({
      threads: [...threads],
      run,
      ownerCreations,
      runStarts,
      exportCount: exports.size,
      importedRecords: [...importedRecords.values()].flat(),
    }),
  };
}

describe("mobile Deep Planning outbox", () => {
  it("creates its empty owner before importing complete local, archived and remote histories", async () => {
    const harness = deliveryHarness();
    await harness.prepare();
    const state = harness.state();
    expect(state.threads).toEqual([threadId]);
    expect(state.ownerCreations).toBe(1);
    expect(state.run?.phase).toBe("planning");
    expect(state.run?.sources).toEqual(sources);
    expect(state.run?.sourceCoverage.every((entry) => entry.status === "ready")).toBe(true);
    expect(state.importedRecords.map((record) => record.origin)).toEqual(
      sources.map((snapshot) => ({ ...snapshot.origin, recordId: `record-${snapshot.sourceId}` })),
    );
    expect(
      state.importedRecords.flatMap((record) =>
        record.kind === "message" ? [record.message.text] : [],
      ),
    ).toEqual(sources.map((snapshot) => `Complete history of ${snapshot.threadTitle}`));
  });

  it("resumes delivery after owner creation without creating another run or recapturing complete sources", async () => {
    const harness = deliveryHarness();
    await harness.prepare();
    const prepared = harness.state();
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: true,
        deepPlanning: true,
        threadHasTurn: false,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("send");
    await harness.prepare();
    expect(harness.state()).toEqual(prepared);
  });

  it("pauses incomplete collection and rejects delivery when a selected remote history is unavailable", async () => {
    const harness = deliveryHarness(remoteSource.sourceId);
    await expect(harness.prepare()).rejects.toThrow("selected remote chat is unavailable");
    const state = harness.state();
    expect(state.run?.phase).toBe("paused");
    expect(state.run?.pauseReason).toContain("selected remote chat is unavailable");
    expect(state.run?.sources).toEqual(sources);
    expect(
      state.run?.sourceCoverage.find((entry) => entry.sourceId === remoteSource.sourceId)?.status,
    ).toBe("pending");
    expect(state.importedRecords).toHaveLength(2);
  });

  it("leaves ordinary messages on their normal path without loading the native Deep Planning bridge", async () => {
    await expect(
      prepareQueuedDeepPlan({
        message: queuedMessage({ composerMode: "plan" }),
        projectId,
        capabilities: { repositoryIdentity: false, midChatProviderSwitching: false },
        provider: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an unsupported provider before creating an owner or copying sources", async () => {
    await expect(
      prepareQueuedDeepPlan({
        message: queuedMessage(),
        projectId,
        creation,
        capabilities,
        provider: { ...provider, deepPlanning: undefined },
      }),
    ).rejects.toThrow("provider does not support DeepPlan");
  });

  it.each([
    {
      name: "an empty Deep owner",
      deepPlanning: true,
      threadHasTurn: false,
      connected: true,
      shellStatus: "live" as const,
      expected: "send",
    },
    {
      name: "a delivered ordinary creation",
      deepPlanning: false,
      threadHasTurn: false,
      connected: true,
      shellStatus: "live" as const,
      expected: "remove",
    },
    {
      name: "a Deep owner whose turn already started",
      deepPlanning: true,
      threadHasTurn: true,
      connected: true,
      shellStatus: "live" as const,
      expected: "remove",
    },
    {
      name: "an offline empty Deep owner",
      deepPlanning: true,
      threadHasTurn: false,
      connected: false,
      shellStatus: "live" as const,
      expected: "wait",
    },
    {
      name: "an empty Deep owner before shell synchronization",
      deepPlanning: true,
      threadHasTurn: false,
      connected: true,
      shellStatus: "synchronizing" as const,
      expected: "wait",
    },
  ])("handles $name", ({ deepPlanning, threadHasTurn, connected, shellStatus, expected }) => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: true,
        deepPlanning,
        threadHasTurn,
        shellStatus,
        environmentConnected: connected,
        threadBusy: false,
      }),
    ).toBe(expected);
  });

  it("persists Deep analysis choices and the exact approved version used for implementation", () => {
    const analysis = queuedMessage();
    const implementation = queuedMessage({
      composerMode: "default",
      interactionMode: "default",
      creation: undefined,
      sourceProposedPlan: {
        threadId,
        planId: "deep-plan-3",
        deepPlan: { runId: DeepPlanRunId.make("approved-run"), planVersion: 3 },
      },
    });
    for (const message of [analysis, implementation])
      expect(persistedMessage(message)).toEqual(message);
  });
});
