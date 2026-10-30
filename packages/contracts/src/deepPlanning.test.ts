import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ComposerMode, composerModeToProviderInteractionMode } from "./composerMode.ts";
import {
  DeepPlanApproveMutation,
  DeepPlanDocument,
  DeepPlanRun,
  DeepPlanSourceSnapshot,
  DeepPlanStepState,
} from "./deepPlanning.ts";
import {
  DEEP_PLAN_MAX_ATTACHMENT_CHUNK_CHARS,
  DEEP_PLAN_MAX_CHUNK_RECORDS,
  DEEP_PLAN_MAX_CONTENT_CHUNK_CHARS,
  DEEP_PLAN_MAX_RECORD_BYTES,
} from "./deepPlanning.ts";
import {
  DeepPlanCatalogSourcesInput,
  DeepPlanExportSourcesInput,
  DeepPlanImportSourceChunkInput,
  DeepPlanReadSourceChunkInput,
  DeepPlanReadSourceChunkResult,
  DeepPlanSourceAttachmentRecord,
  DeepPlanSourceContentRecord,
} from "./deepPlanningSources.ts";
import { ExecutionEnvironmentCapabilities } from "./environment.ts";
import {
  ClientOrchestrationCommand,
  OrchestrationProposedPlan,
  OrchestrationThread,
  ProviderInteractionMode,
  ThreadDeepPlanUpdateCommand,
  ThreadTurnStartCommand,
} from "./orchestration.ts";

const now = "2026-10-16T10:00:00.000Z";
const decodePlan = Schema.decodeUnknownSync(DeepPlanDocument);
const decodeRun = Schema.decodeUnknownSync(DeepPlanRun);
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const decodeSource = Schema.decodeUnknownSync(DeepPlanSourceSnapshot);
const decodeMode = Schema.decodeUnknownSync(ComposerMode);
const decodeProviderMode = Schema.decodeUnknownSync(ProviderInteractionMode);
const decodeThread = Schema.decodeSync(OrchestrationThread);
const decodeProposedPlan = Schema.decodeSync(OrchestrationProposedPlan);
const decodeTurnStart = Schema.decodeSync(ThreadTurnStartCommand);
const decodeStep = Schema.decodeUnknownSync(DeepPlanStepState);
const decodeApproval = Schema.decodeUnknownSync(DeepPlanApproveMutation);
const decodeInternalUpdate = Schema.decodeUnknownSync(ThreadDeepPlanUpdateCommand);
const decodeClientCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const decodeCatalog = Schema.decodeSync(DeepPlanCatalogSourcesInput);
const decodeExport = Schema.decodeSync(DeepPlanExportSourcesInput);
const decodeImport = Schema.decodeUnknownSync(DeepPlanImportSourceChunkInput);
const decodeSourceInput = Schema.decodeSync(DeepPlanReadSourceChunkInput);
const decodeReadResult = Schema.decodeSync(DeepPlanReadSourceChunkResult);
const decodeAttachment = Schema.decodeUnknownSync(DeepPlanSourceAttachmentRecord);
const decodeContent = Schema.decodeUnknownSync(DeepPlanSourceContentRecord);

function makePlan() {
  return decodePlan({
    schemaVersion: 1,
    version: 1,
    goal: "Keep source imports complete",
    scope: ["Deep Planning source imports"],
    decisions: [{ id: "decision-1", text: "Freeze source contents before transfer" }],
    affectedAreas: ["contracts"],
    steps: [
      {
        id: "step-1",
        title: "Import source records",
        description: "Transfer all frozen source records",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "criterion-1",
            description: "Imported source matches the frozen manifest",
            checkMethod: "Compare record counts and manifest hashes",
          },
        ],
      },
    ],
    finalValidation: {
      description: "Verify the completed workflow",
      checkMethod: "Run the focused import acceptance tests",
    },
  });
}

function makeRun() {
  return decodeRun({
    id: "run-1",
    threadId: "thread-1",
    phase: "awaitingApproval",
    revision: 1,
    plan: makePlan(),
    approval: null,
    approvalKey: "approval-key",
    sources: [],
    sourceCoverage: [],
    stepStates: [{ stepId: "step-1", status: "pending", evidence: [], updatedAt: now }],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    createdAt: now,
    updatedAt: now,
    pauseReason: null,
  });
}

function makeSource() {
  return decodeSource({
    sourceId: "source-1",
    origin: { environmentId: "environment-1", projectId: "project-1", threadId: "source-thread" },
    projectTitle: "Project",
    threadTitle: "Source chat",
    archived: true,
    capturedAt: now,
    contentVersion: "version-1",
    contentHash: "source-hash",
    messageCount: 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: 1,
    forkOrigin: null,
  });
}

const evidence = [{ kind: "test" as const, summary: "Focused tests passed", createdAt: now }];
const implementation = { instanceId: "codex", model: "gpt-5.4" };

describe("Deep Planning compatibility", () => {
  it("keeps Deep Planning separate from provider interaction modes", () => {
    expect(decodeMode("deep-plan")).toBe("deep-plan");
    expect(composerModeToProviderInteractionMode("default")).toBe("default");
    expect(composerModeToProviderInteractionMode("plan")).toBe("plan");
    expect(composerModeToProviderInteractionMode("deep-plan")).toBe("plan");
    expect(() => decodeProviderMode("deep-plan")).toThrow();
    expect(decodeMode("chat")).toBe("chat");
    expect(decodeProviderMode("chat")).toBe("chat");
    expect(composerModeToProviderInteractionMode("chat")).toBe("chat");
  });

  it("treats absent and unknown Deep Planning capabilities as unsupported", () => {
    expect(decodeCapabilities({}).deepPlanning).toBeUndefined();
    expect(
      decodeCapabilities({
        deepPlanning: { version: 2, sourceExport: true, sourceImport: true },
      }).deepPlanning,
    ).toBeUndefined();
    expect(
      decodeCapabilities({
        deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
      }).deepPlanning,
    ).toEqual({ version: 1, sourceExport: true, sourceImport: true });
  });

  it("decodes older thread snapshots without a Deep Planning run", () => {
    const thread = decodeThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Existing chat",
      modelSelection: implementation,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    expect(thread.interactionMode).toBe("default");
    expect(thread.deepPlan).toBeUndefined();
  });

  it("preserves versioned Deep Plan metadata on existing plan and turn schemas", () => {
    const plan = decodeProposedPlan({
      id: "plan-1",
      turnId: null,
      planMarkdown: "Implement the source import",
      deepPlan: { runId: "run-1", planVersion: 2 },
      createdAt: now,
      updatedAt: now,
    });
    const turn = decodeTurnStart({
      type: "thread.turn.start",
      commandId: "command-1",
      threadId: "thread-2",
      message: { messageId: "message-1", role: "user", text: "Implement", attachments: [] },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: plan.id,
        deepPlan: plan.deepPlan,
      },
      createdAt: now,
    });
    expect(turn.sourceProposedPlan?.deepPlan).toEqual({ runId: "run-1", planVersion: 2 });
  });
});

describe("Deep Plan documents", () => {
  it("requires unique stable step and acceptance criterion IDs", () => {
    const plan = makePlan();
    expect(() => decodePlan({ ...plan, steps: [plan.steps[0], plan.steps[0]] })).toThrow();
    expect(() =>
      decodePlan({
        ...plan,
        steps: [plan.steps[0], { ...plan.steps[0], id: "step-2", dependencies: ["step-1"] }],
      }),
    ).toThrow();
  });

  it("rejects missing and cyclic dependencies", () => {
    const plan = makePlan();
    const step = plan.steps[0]!;
    expect(() =>
      decodePlan({ ...plan, steps: [{ ...step, dependencies: ["unknown-step"] }] }),
    ).toThrow();
    expect(() => decodePlan({ ...plan, steps: [{ ...step, dependencies: [step.id] }] })).toThrow();
  });

  it("requires per-step checks and a final validation requirement", () => {
    const plan = makePlan();
    expect(() =>
      decodePlan({ ...plan, steps: [{ ...plan.steps[0], acceptanceCriteria: [] }] }),
    ).toThrow();
    expect(() => decodePlan({ ...plan, finalValidation: { description: "Check" } })).toThrow();
  });

  it("retains source record citations in plan decisions and criteria", () => {
    const plan = makePlan();
    const citations = [{ sourceId: "source-1", recordIds: ["record-1", "record-2"] }];
    const parsed = decodePlan({
      ...plan,
      decisions: [{ ...plan.decisions[0], sources: citations }],
      steps: [
        {
          ...plan.steps[0],
          sources: citations,
          acceptanceCriteria: [{ ...plan.steps[0]!.acceptanceCriteria[0], sources: citations }],
        },
      ],
    });
    expect(parsed.decisions[0]?.sources).toEqual(citations);
    expect(parsed.steps[0]?.acceptanceCriteria[0]?.sources).toEqual(citations);
  });
});

describe("Deep Plan completion", () => {
  it("requires evidence before a step becomes verified", () => {
    expect(() =>
      decodeStep({ stepId: "step-1", status: "verified", evidence: [], updatedAt: now }),
    ).toThrow();
    expect(
      decodeStep({ stepId: "step-1", status: "verified", evidence, updatedAt: now }).status,
    ).toBe("verified");
  });

  it("rejects completion without approval, verified steps, or passed final validation", () => {
    const run = makeRun();
    expect(() => decodeRun({ ...run, phase: "completed" })).toThrow();
    const approved = {
      ...run,
      approval: {
        planVersion: 1,
        approvalKey: "approval-key",
        approvedAt: now,
        approvedBy: "user",
        implementation,
        implementationThreadId: "thread-1",
        implementerId: "thread:thread-1",
      },
    };
    expect(() => decodeRun({ ...approved, phase: "completed" })).toThrow();
    const verified = {
      ...approved,
      stepStates: [{ stepId: "step-1", status: "verified", evidence, updatedAt: now }],
    };
    expect(() => decodeRun({ ...verified, phase: "completed" })).toThrow();
    expect(
      decodeRun({
        ...verified,
        phase: "completed",
        finalValidation: {
          ...run.finalValidation,
          status: "passed",
          evidence,
          updatedAt: now,
          requestId: "validation-1",
        },
      }).phase,
    ).toBe("completed");
  });

  it("rejects duplicate states for a checklist step", () => {
    const run = makeRun();
    expect(() =>
      decodeRun({ ...run, stepStates: [run.stepStates[0], run.stepStates[0]] }),
    ).toThrow();
  });

  it("requires approval for the current plan version", () => {
    const run = makeRun();
    expect(() =>
      decodeRun({
        ...run,
        phase: "completed",
        approval: {
          planVersion: 2,
          approvalKey: "approval-key",
          approvedAt: now,
          approvedBy: "user",
          implementation,
          implementationThreadId: "thread-1",
          implementerId: "thread:thread-1",
        },
        stepStates: [{ stepId: "step-1", status: "verified", evidence, updatedAt: now }],
        finalValidation: { ...run.finalValidation, status: "passed", evidence, updatedAt: now },
      }),
    ).toThrow();
  });

  it("requires positive parallelism when requested", () => {
    const mutation = {
      type: "approve",
      planVersion: 1,
      approvalKey: "approval-key",
      implementation,
      implementationThreadId: "thread-1",
      implementerId: "thread:thread-1",
    };
    expect(decodeApproval(mutation).requestedParallelism).toBeUndefined();
    expect(decodeApproval({ ...mutation, requestedParallelism: 3 }).requestedParallelism).toBe(3);
    expect(() => decodeApproval({ ...mutation, requestedParallelism: 0 })).toThrow();
  });

  it("keeps planning and execution mutations behind the authenticated agent boundary", () => {
    const actor = { implementerId: "thread:thread-1", model: implementation };
    const mutations = [
      { type: "publish-plan", plan: makePlan() },
      { type: "step-update", stepId: "step-1", status: "verified", evidence, actor },
      { type: "validation-start", requestId: "validation-1", actor },
      { type: "validation-complete", requestId: "validation-1", status: "passed", evidence, actor },
      {
        type: "procedure-adjust",
        reason: "Use the focused check",
        changes: ["Run focused tests"],
        actor,
      },
      { type: "block", reason: "The check environment is unavailable" },
    ];
    for (const mutation of mutations) {
      const command = {
        type: "thread.deep-plan.update",
        commandId: "command-1",
        threadId: "thread-1",
        runId: "run-1",
        expectedRevision: 1,
        operationId: "operation-1",
        mutation,
        createdAt: now,
      };
      expect(decodeInternalUpdate(command).mutation.type).toBe(mutation.type);
      expect(() => decodeClientCommand(command)).toThrow();
    }
  });

  it("allows clients to approve, pause, and resume the run", () => {
    const mutations = [
      {
        type: "approve",
        planVersion: 1,
        approvalKey: "approval-key",
        implementation,
        implementationThreadId: "thread-1",
        implementerId: "thread:thread-1",
      },
      { type: "pause", reason: "Review the current implementation" },
      { type: "resume" },
    ];
    for (const mutation of mutations) {
      const parsed = decodeClientCommand({
        type: "thread.deep-plan.update",
        commandId: "command-1",
        threadId: "thread-1",
        runId: "run-1",
        expectedRevision: 1,
        operationId: "operation-1",
        mutation,
        createdAt: now,
      });
      expect(parsed.type).toBe("thread.deep-plan.update");
    }
  });

  it("accepts source updates only through the internal command schema", () => {
    const command = {
      type: "thread.deep-plan.update",
      commandId: "command-1",
      threadId: "thread-1",
      runId: "run-1",
      expectedRevision: 1,
      operationId: "operation-1",
      mutation: { type: "sources-set", sources: [] },
      createdAt: now,
    };
    expect(decodeInternalUpdate(command).mutation.type).toBe("sources-set");
    expect(() => decodeClientCommand(command)).toThrow();
  });
});

describe("Deep Plan source transport", () => {
  it("includes archived chats by default while keeping the picker free of frozen bodies", () => {
    const catalog = decodeCatalog({ projectId: "project-1" });
    const exported = decodeExport({ projectId: "project-1" });
    expect(catalog.includeArchived).toBe(true);
    expect(exported.includeArchived).toBe(true);
    expect(exported.exportId).toBeUndefined();
    expect(() => decodeCatalog({ projectId: "project-1", limit: 201 })).toThrow();
  });

  it("bounds transfers and requires the source manifest and chunk digest", () => {
    const input = {
      threadId: "thread-1",
      runId: "run-1",
      snapshot: makeSource(),
      chunkIndex: 0,
      chunkHash: "chunk-hash",
      records: [],
      finalChunk: true,
    };
    expect(decodeImport(input).snapshot.origin.threadId).toBe("source-thread");
    expect(() => decodeImport({ ...input, chunkHash: "" })).toThrow();
    const record = {
      kind: "content",
      recordId: "record-1",
      origin: { ...input.snapshot.origin, recordId: "origin-record-1" },
      contentHash: "body-hash",
      contentId: "content-1",
      mediaType: "text/plain",
      chunkIndex: 0,
      totalChunks: 1,
      data: "Source text",
      requiredForAnalysis: true,
    };
    expect(decodeImport({ ...input, records: [record] }).records).toHaveLength(1);
    expect(() =>
      decodeImport({
        ...input,
        records: Array.from({ length: DEEP_PLAN_MAX_CHUNK_RECORDS + 1 }, () => ({ ...record })),
      }),
    ).toThrow();
  });

  it("rejects large message bodies that have not been externalized into content chunks", () => {
    const message = {
      kind: "message",
      recordId: "record-1",
      origin: { ...makeSource().origin, recordId: "origin-record-1" },
      contentHash: "body-hash",
      message: {
        id: "message-1",
        role: "user",
        text: "Complete source text",
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    };
    const input = {
      threadId: "thread-1",
      runId: "run-1",
      snapshot: makeSource(),
      chunkIndex: 0,
      chunkHash: "chunk-hash",
      records: [message],
      finalChunk: true,
    };
    expect(decodeImport(input).records).toHaveLength(1);
    expect(() =>
      decodeImport({
        ...input,
        records: [
          {
            ...message,
            message: { ...message.message, text: "x".repeat(DEEP_PLAN_MAX_RECORD_BYTES) },
          },
        ],
      }),
    ).toThrow();
  });

  it("retains chunk references without loading optional source bodies", () => {
    const input = decodeSourceInput({
      threadId: "thread-1",
      runId: "run-1",
      sourceId: "source-1",
    });
    expect(input.includeBodies).toBe(false);
    const result = decodeReadResult({
      snapshot: makeSource(),
      records: [
        {
          kind: "content-reference",
          recordId: "record-1",
          origin: { ...makeSource().origin, recordId: "origin-record-1" },
          contentHash: "body-hash",
          contentKind: "attachment",
          contentId: "attachment-1",
          chunkIndex: 0,
          totalChunks: 1,
          byteLength: 42,
        },
      ],
      chunkHash: "chunk-hash",
      nextCursor: null,
    });
    expect(result.records[0]?.kind).toBe("content-reference");
  });

  it("bounds attachment and text chunks and rejects impossible chunk indexes", () => {
    const common = {
      recordId: "record-1",
      origin: { ...makeSource().origin, recordId: "origin-record-1" },
      contentHash: "body-hash",
      chunkIndex: 0,
      totalChunks: 1,
    };
    const attachment = {
      ...common,
      kind: "attachment",
      attachmentId: "attachment-1",
      mimeType: "text/plain",
      name: "notes.txt",
      dataBase64: "YQ==",
    };
    const content = {
      ...common,
      kind: "content",
      contentId: "content-1",
      mediaType: "text/plain",
      data: "Complete source text",
      requiredForAnalysis: true,
    };
    expect(decodeContent(content).requiredForAnalysis).toBe(true);
    expect(() => decodeAttachment({ ...attachment, chunkIndex: 1 })).toThrow();
    expect(() =>
      decodeAttachment({
        ...attachment,
        dataBase64: "a".repeat(DEEP_PLAN_MAX_ATTACHMENT_CHUNK_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeContent({ ...content, data: "a".repeat(DEEP_PLAN_MAX_CONTENT_CHUNK_CHARS + 1) }),
    ).toThrow();
  });
});
