import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { derive as deriveV2Id } from "@t3tools/provider-core/server/IdAllocator";
import { subagentThreadTitle } from "@t3tools/provider-core/server/subagentProjection";
import { DeepPlanWorkflow } from "../deepPlanning/DeepPlanWorkflow.ts";
import {
  CommandId,
  MessageId,
  NodeId,
  SubagentId,
  resolveBetterT3FeatureFlag,
  type OrchestrationV2Subagent,
  type ModelSelection,
  type ThreadId,
  type ProviderInstanceId,
  type DeepPlanSourceId,
  type DeepPlanSourceSnapshot,
} from "@t3tools/contracts";
import type { McpDeepPlanContext } from "../mcp/McpInvocationContext.ts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  buildDeepPlanSourceBatchTask,
  selectDeepPlanSourceBatches,
} from "../deepPlanning/DeepPlanSourceBatches.ts";
import {
  listGeneralSubagentModels,
  resolveGeneralSubagentSelection,
} from "./GeneralSubagentSelection.ts";
import {
  buildGeneralSubagentPrompt,
  buildGeneralSubagentFollowUpPrompt,
  parseGeneralSubagentFinalResult,
} from "./GeneralSubagentPolicy.ts";
import {
  GeneralSubagentError,
  type GeneralSubagentSpawnInput,
  type GeneralSubagentSpawnResult,
  type GeneralSubagentWaitInput,
  type GeneralSubagentWaitResult,
  type GeneralSubagentCancelInput,
  type GeneralSubagentCancelResult,
  type GeneralSubagentListResult,
  type GeneralSubagentModelsResult,
  type GeneralSubagentSendMessageInput,
  type GeneralSubagentSendMessageResult,
  type GeneralSubagentFollowUpInput,
  type GeneralSubagentFollowUpResult,
  type GeneralSubagentInterruptInput,
  type GeneralSubagentInterruptResult,
} from "./GeneralSubagentProtocol.ts";
export {
  assistantTextFromCompletedItem,
  buildGeneralSubagentPrompt,
  parseGeneralSubagentFinalResult,
} from "./GeneralSubagentPolicy.ts";
export interface GeneralSubagentCaller {
  readonly parentThreadId: ThreadId;
  readonly callerProviderInstanceId: ProviderInstanceId;
}

export interface DeepPlanSourceAnalysisBatch extends GeneralSubagentSpawnResult {
  readonly sourceIds: ReadonlyArray<DeepPlanSourceId>;
}

export interface GeneralSubagentCoordinatorShape {
  /** The caller holds the run's lock, which is not reentrant. */
  readonly analyzeDeepPlanSources: (
    input: GeneralSubagentCaller & {
      readonly binding: McpDeepPlanContext;
      readonly sources: ReadonlyArray<DeepPlanSourceSnapshot>;
    },
  ) => Effect.Effect<ReadonlyArray<DeepPlanSourceAnalysisBatch>, GeneralSubagentError>;
  readonly listModels: (
    input: GeneralSubagentCaller,
  ) => Effect.Effect<GeneralSubagentModelsResult, GeneralSubagentError>;
  readonly spawn: (
    input: GeneralSubagentCaller &
      GeneralSubagentSpawnInput & { readonly deepPlanExecution?: McpDeepPlanContext },
  ) => Effect.Effect<GeneralSubagentSpawnResult, GeneralSubagentError>;
  readonly wait: (
    input: GeneralSubagentCaller & GeneralSubagentWaitInput,
  ) => Effect.Effect<GeneralSubagentWaitResult, GeneralSubagentError>;
  readonly cancel: (
    input: GeneralSubagentCaller & GeneralSubagentCancelInput,
  ) => Effect.Effect<GeneralSubagentCancelResult, GeneralSubagentError>;
  readonly listAgents: (
    input: GeneralSubagentCaller,
  ) => Effect.Effect<GeneralSubagentListResult, GeneralSubagentError>;
  readonly spawnAgent: (
    input: GeneralSubagentCaller &
      GeneralSubagentSpawnInput & { readonly deepPlanExecution?: McpDeepPlanContext },
  ) => Effect.Effect<GeneralSubagentSpawnResult, GeneralSubagentError>;
  readonly sendMessage: (
    input: GeneralSubagentCaller & GeneralSubagentSendMessageInput,
  ) => Effect.Effect<GeneralSubagentSendMessageResult, GeneralSubagentError>;
  readonly followUp: (
    input: GeneralSubagentCaller & GeneralSubagentFollowUpInput,
  ) => Effect.Effect<GeneralSubagentFollowUpResult, GeneralSubagentError>;
  readonly waitAgent: (
    input: GeneralSubagentCaller & GeneralSubagentWaitInput,
  ) => Effect.Effect<GeneralSubagentWaitResult, GeneralSubagentError>;
  readonly interruptAgent: (
    input: GeneralSubagentCaller & GeneralSubagentInterruptInput,
  ) => Effect.Effect<GeneralSubagentInterruptResult, GeneralSubagentError>;
}

export class GeneralSubagentCoordinator extends Context.Service<
  GeneralSubagentCoordinator,
  GeneralSubagentCoordinatorShape
>()("t3/subagents/GeneralSubagentCoordinator") {}

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestratorV2;
  const threads = yield* ThreadManagementService;
  const providers = yield* ProviderRegistry;
  const settings = yield* ServerSettingsService;
  const workflow = yield* DeepPlanWorkflow;
  const crypto = yield* Crypto.Crypto;
  const failure = (cause: unknown) =>
    new GeneralSubagentError({
      reason: "operation-failed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  const nextId = () =>
    crypto.randomUUIDv4().pipe(Effect.map(CommandId.make), Effect.mapError(failure));
  const parent = Effect.fn("GeneralSubagentCoordinator.parent")(function* (
    input: GeneralSubagentCaller,
    requireEnabled = true,
  ) {
    const configuration = yield* settings.getSettings.pipe(Effect.mapError(failure));
    if (
      requireEnabled &&
      !resolveBetterT3FeatureFlag(configuration.betterT3Environment, "agent.generalSubagents")
    )
      return yield* new GeneralSubagentError({
        reason: "spawn-failed",
        detail: "General subagents are disabled in Better T3 settings.",
      });
    return yield* orchestration
      .getThreadRecords(input.parentThreadId, ["runs", "subagents"])
      .pipe(Effect.mapError(failure));
  });
  const identity = (
    task: OrchestrationV2Subagent,
    selection?: ModelSelection,
  ): GeneralSubagentSpawnResult => ({
    agentId: SubagentId.make(task.id),
    status:
      task.status === "failed"
        ? "error"
        : task.status === "cancelled"
          ? "interrupted"
          : task.status === "pending"
            ? "starting"
            : task.status === "idle"
              ? "completed"
              : task.status,
    providerInstanceId: task.providerInstanceId,
    providerDriver: task.driver,
    model: task.model ?? "unknown",
    reasoningEffort: selection
      ? (getModelSelectionStringOptionValue(selection, "reasoningEffort") ??
        getModelSelectionStringOptionValue(selection, "effort") ??
        null)
      : null,
  });
  const load = Effect.fn("GeneralSubagentCoordinator.load")(function* (
    input: GeneralSubagentCaller & { readonly agentId: SubagentId },
  ) {
    const projection = yield* parent(input, false);
    const task = projection.subagents.find(
      (candidate) =>
        candidate.id === NodeId.make(input.agentId) && candidate.origin === "app_owned",
    );
    if (!task || task.childThreadId === null)
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: "The delegated agent does not belong to this thread.",
      });
    const child = yield* orchestration
      .getThreadRecords(task.childThreadId, ["messages", "runs"])
      .pipe(Effect.mapError(failure));
    return { task, child };
  });
  const action = (task: OrchestrationV2Subagent, selection?: ModelSelection) => ({
    ...identity(task, selection),
    task: task.prompt ?? "Delegated task",
    output: task.result ?? null,
    detail: null,
  });
  const spawn: GeneralSubagentCoordinatorShape["spawn"] = Effect.fn(
    "GeneralSubagentCoordinator.spawn",
  )(function* (input) {
    const projection = yield* parent(input);
    if (projection.thread.lineage.relationshipToParent === "subagent")
      return yield* new GeneralSubagentError({
        reason: "nested-spawn-disabled",
        detail: "General subagents cannot spawn nested agents.",
      });
    const run = projection.runs
      .filter((candidate) => ["running", "starting", "waiting"].includes(candidate.status))
      .at(-1);
    if (!run || run.rootNodeId === null)
      return yield* new GeneralSubagentError({
        reason: "thread-unavailable",
        detail: "The parent has no active execution node.",
      });
    if (
      projection.subagents.filter((task) => ["running", "pending", "waiting"].includes(task.status))
        .length >= 40
    )
      return yield* new GeneralSubagentError({
        reason: "direct-child-limit",
        detail: "The parent already has 40 active agents.",
      });
    const selected = resolveGeneralSubagentSelection({
      providers: yield* providers.getProviders,
      callerProviderInstanceId: input.callerProviderInstanceId,
      parentModelSelection:
        input.deepPlanExecution?.modelSelection ??
        run.resolvedModelSelection ??
        projection.thread.modelSelection,
      request: input,
    });
    if (selected.status !== "resolved") return yield* new GeneralSubagentError(selected);
    const commandId = yield* nextId();
    const agentId = SubagentId.make(deriveV2Id.delegatedTaskNode({ commandId }));
    const result = yield* orchestration
      .dispatch({
        type: "delegated_task.request",
        commandId,
        parentThreadId: input.parentThreadId,
        parentRunId: run.id,
        parentNodeId: run.rootNodeId,
        task: buildGeneralSubagentPrompt({
          task: input.task,
          parentThreadId: input.parentThreadId,
          agentId,
        }),
        title:
          input.name ??
          subagentThreadTitle({
            parentTitle: projection.thread.title,
            prompt: input.task,
            ordinal: projection.subagents.length + 1,
          }),
        ...(input.deepPlanExecution === undefined
          ? {}
          : { deepPlanExecution: input.deepPlanExecution }),
        generalSubagent: true,
        modelSelection: selected.selection,
        runtimeMode: projection.thread.runtimeMode,
        interactionMode: input.deepPlanExecution?.readOnly ? "plan" : "default",
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(Effect.mapError(failure));
    const task = result.storedEvents.flatMap(({ event }) =>
      event.type === "subagent.updated" ? [event.payload] : [],
    )[0];
    if (!task)
      return yield* new GeneralSubagentError({
        reason: "spawn-failed",
        detail: "The delegated task was not persisted.",
      });
    return identity(task, selected.selection);
  });
  const sendMessage: GeneralSubagentCoordinatorShape["sendMessage"] = Effect.fn(
    "GeneralSubagentCoordinator.sendMessage",
  )(function* (input) {
    yield* parent(input);
    const { task, child } = yield* load(input);
    const commandId = yield* nextId();
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId,
        threadId: child.thread.id,
        messageId: MessageId.make(`${commandId}:message`),
        text: input.message,
        attachments: [],
        modelSelection: child.thread.modelSelection,
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "queue_after_active" },
      })
      .pipe(Effect.mapError(failure));
    return { agent: action(task, child.thread.modelSelection), queued: true };
  });
  const wait: GeneralSubagentCoordinatorShape["wait"] = Effect.fn(
    "GeneralSubagentCoordinator.wait",
  )(function* (input) {
    const loaded = yield* Effect.forEach(input.agentIds, (agentId) => load({ ...input, agentId }));
    const results = yield* Effect.forEach(
      loaded,
      ({ child }) =>
        threads
          .waitForThread({
            projectId: child.thread.projectId,
            threadId: child.thread.id,
            timeoutMs: (input.timeoutSeconds ?? 60) * 1000,
            untilDelegatedWorkSettled: true,
          })
          .pipe(Effect.mapError(failure)),
      { concurrency: "unbounded" },
    );
    const agents = yield* Effect.forEach(input.agentIds, (agentId) =>
      Effect.gen(function* () {
        const { task, child } = yield* load({ ...input, agentId });
        const output =
          child.messages.filter((message) => message.role === "assistant").at(-1)?.text ??
          task.result;
        return {
          ...identity(task),
          result: output ? parseGeneralSubagentFinalResult(output, agentId) : null,
        };
      }),
    );
    return {
      agents,
      allTerminal: results.every((result) => !result.timedOut),
      timedOut: results.some((result) => result.timedOut),
    };
  });
  const interruptAgent: GeneralSubagentCoordinatorShape["interruptAgent"] = Effect.fn(
    "GeneralSubagentCoordinator.interruptAgent",
  )(function* (input) {
    const { task, child } = yield* load(input);
    yield* threads
      .dispatch({ type: "thread.stop", commandId: yield* nextId(), threadId: child.thread.id })
      .pipe(Effect.mapError(failure));
    return { agent: action(task, child.thread.modelSelection), interrupted: true };
  });
  return GeneralSubagentCoordinator.of({
    spawn,
    spawnAgent: spawn,
    sendMessage,
    followUp: Effect.fn("GeneralSubagentCoordinator.followUp")((input) =>
      sendMessage({
        ...input,
        message: buildGeneralSubagentFollowUpPrompt({ task: input.task, agentId: input.agentId }),
      }),
    ),
    wait,
    waitAgent: wait,
    interruptAgent,
    cancel: Effect.fn("GeneralSubagentCoordinator.cancel")((input) =>
      interruptAgent(input).pipe(
        Effect.map((result) => ({ agent: result.agent, cancelled: result.interrupted })),
      ),
    ),
    listAgents: Effect.fn("GeneralSubagentCoordinator.listAgents")(function* (input) {
      const projection = yield* parent(input);
      return {
        agents: yield* Effect.forEach(
          projection.subagents.filter((task) => task.origin === "app_owned"),
          (task) =>
            Effect.gen(function* () {
              const child =
                task.childThreadId === null
                  ? null
                  : yield* orchestration
                      .getThreadRecords(task.childThreadId, [])
                      .pipe(Effect.mapError(failure));
              return identity(task, child?.thread.modelSelection);
            }),
        ),
      };
    }),
    listModels: Effect.fn("GeneralSubagentCoordinator.listModels")(function* (input) {
      const projection = yield* parent(input);
      return {
        providers: listGeneralSubagentModels({
          providers: yield* providers.getProviders,
          callerProviderInstanceId: input.callerProviderInstanceId,
          parentModelSelection: projection.thread.modelSelection,
        }),
      };
    }),
    analyzeDeepPlanSources: Effect.fn("GeneralSubagentCoordinator.analyzeDeepPlanSources")(
      function* (input) {
        const run = yield* workflow
          .getRun({ threadId: input.binding.runThreadId, runId: input.binding.runId })
          .pipe(Effect.mapError(failure));
        const projection = yield* parent(input);
        const active: DeepPlanSourceAnalysisBatch[] = [];
        for (const task of projection.subagents) {
          if (
            task.childThreadId === null ||
            !["pending", "running", "waiting"].includes(task.status)
          )
            continue;
          const child = yield* orchestration
            .getThreadRecords(task.childThreadId, [])
            .pipe(Effect.mapError(failure));
          const grant = child.thread.deepPlanExecution;
          if (grant?.runId === input.binding.runId && grant.sourceAnalysis)
            active.push({
              ...identity(task, child.thread.modelSelection),
              sourceIds: grant.sourceAnalysis.sourceIds,
            });
        }
        const summarized = new Set(
          run?.sourceCoverage
            .filter((entry) => entry.status === "summarized")
            .map((entry) => entry.sourceId),
        );
        const pending = input.sources.filter((source) => !summarized.has(source.sourceId));
        const created = yield* Effect.forEach(
          selectDeepPlanSourceBatches(
            pending,
            active.map((agent) => agent.sourceIds),
          ),
          (batch) =>
            spawn({
              ...input,
              task: buildDeepPlanSourceBatchTask(input.binding, batch),
              name: "Deep Plan source analysis",
              deepPlanExecution: {
                ...input.binding,
                readOnly: true,
                sourceAnalysis: {
                  workerThreadId: input.parentThreadId,
                  sourceIds: batch.map((source) => source.sourceId),
                },
              },
            }).pipe(
              Effect.map((agent) => ({
                ...agent,
                sourceIds: batch.map((source) => source.sourceId),
              })),
            ),
        );
        return [...active, ...created];
      },
    ),
  });
});
export const GeneralSubagentCoordinatorLive = Layer.effect(GeneralSubagentCoordinator, make);
