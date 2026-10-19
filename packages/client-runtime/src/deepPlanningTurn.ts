import {
  CommandId,
  DeepPlanRunId,
  MessageId,
  type ClientOrchestrationCommand,
  type DeepPlanGetRunInput,
  type DeepPlanRun,
  type DeepPlanSourceRef,
  type EnvironmentId,
  type ModelSelection,
  type RuntimeMode,
  type ServerProvider,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { buildDeepPlanImplementationPrompt, selectDeepPlanProgress } from "./deepPlanningRun.ts";

import {
  awaitDeepPlanSourceOperation,
  deepPlanSourceRefKey,
  transferDeepPlanSources,
  uniqueDeepPlanSourceRefs,
  type DeepPlanningSourceApi,
  type DeepPlanSourceTransferProgress,
} from "./deepPlanningSources.ts";

export interface DeepPlanningApi extends DeepPlanningSourceApi {
  readonly getRun: (input: DeepPlanGetRunInput) => Promise<DeepPlanRun | null>;
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<unknown>;
}

function importsComplete(run: DeepPlanRun): boolean {
  return run.sources.every((source) =>
    run.sourceCoverage.some(
      (coverage) =>
        coverage.sourceId === source.sourceId &&
        (coverage.status === "ready" || coverage.status === "summarized") &&
        coverage.importedRecordCount === source.recordCount,
    ),
  );
}

function sameAdditionalSources(input: {
  readonly run: DeepPlanRun;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly additionalSourceRefs: ReadonlyArray<DeepPlanSourceRef>;
}): boolean {
  const outsideCurrentProject = (ref: DeepPlanSourceRef) =>
    ref.environmentId !== input.environmentId || ref.projectId !== input.projectId;
  const frozen = new Set(
    input.run.sources
      .filter((source) => outsideCurrentProject(source.origin))
      .map((source) => deepPlanSourceRefKey(source.origin)),
  );
  const selected = uniqueDeepPlanSourceRefs(
    input.additionalSourceRefs.filter(outsideCurrentProject),
  );
  return (
    frozen.size === selected.length &&
    selected.every((ref) => frozen.has(deepPlanSourceRefKey(ref)))
  );
}

async function pauseRun(input: {
  readonly api: DeepPlanningApi;
  readonly run: DeepPlanRun;
  readonly reason: string;
  readonly createId: () => string;
  readonly now: () => string;
}): Promise<void> {
  if (input.run.phase === "paused" || input.run.phase === "completed") return;
  await input.api.dispatchCommand({
    type: "thread.deep-plan.update",
    commandId: CommandId.make(input.createId()),
    threadId: input.run.threadId,
    runId: input.run.id,
    expectedRevision: input.run.revision,
    operationId: input.createId(),
    createdAt: input.now(),
    mutation: { type: "pause", reason: input.reason },
  });
}

async function prepareDeepPlan(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly additionalSourceRefs?: ReadonlyArray<DeepPlanSourceRef> | undefined;
  readonly existingRun?: DeepPlanRun | null | undefined;
  readonly runId?: DeepPlanRunId | undefined;
  readonly createId: () => string;
  readonly now?: () => string;
  readonly apiForEnvironment: (
    environmentId: EnvironmentId,
  ) => DeepPlanningApi | null | Promise<DeepPlanningApi | null>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DeepPlanSourceTransferProgress) => void;
}): Promise<DeepPlanRun> {
  if (input.signal?.aborted) throw new Error("DeepPlan source collection was canceled.");
  const api = await input.apiForEnvironment(input.environmentId);
  if (!api) throw new Error("Connect to this environment before starting DeepPlan.");
  const now = input.now ?? (() => DateTime.formatIso(DateTime.nowUnsafe()));
  const current = await api.getRun({
    threadId: input.existingRun?.threadId ?? input.threadId,
    ...(input.existingRun ? { runId: input.existingRun.id } : {}),
  });
  if (input.signal?.aborted) throw new Error("DeepPlan source collection was canceled.");
  const additionalSourceRefs = input.additionalSourceRefs ?? [];
  if (
    current &&
    !current.approval &&
    (current.phase === "planning" || current.phase === "awaitingApproval") &&
    importsComplete(current) &&
    sameAdditionalSources({
      run: current,
      environmentId: input.environmentId,
      projectId: input.projectId,
      additionalSourceRefs,
    })
  )
    return current;
  if (current?.approval && current.phase !== "completed") {
    throw new Error(
      "The approved DeepPlan is still active. Finish it before starting another DeepPlan.",
    );
  }
  if (
    current &&
    current.phase !== "completed" &&
    current.phase !== "failed" &&
    current.phase !== "blocked"
  ) {
    await pauseRun({
      api,
      run: current,
      reason: "Starting a new DeepPlan with a complete source snapshot.",
      createId: input.createId,
      now,
    });
  }
  const runId =
    input.runId && input.runId !== current?.id ? input.runId : DeepPlanRunId.make(input.createId());
  await api.dispatchCommand({
    type: "thread.deep-plan.start",
    commandId: CommandId.make(input.createId()),
    threadId: input.threadId,
    runId,
    createdAt: now(),
  });
  try {
    const transferred = await transferDeepPlanSources({
      environmentId: input.environmentId,
      projectId: input.projectId,
      threadId: input.threadId,
      runId,
      additionalSourceRefs,
      apiForEnvironment: (environmentId) =>
        environmentId === input.environmentId ? api : input.apiForEnvironment(environmentId),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
    const prepared = await api.getRun({ threadId: input.threadId, runId });
    if (input.signal?.aborted) throw new Error("DeepPlan source collection was canceled.");
    if (
      !prepared ||
      prepared.id !== runId ||
      !importsComplete(prepared) ||
      prepared.sources.length !== transferred.sources.length ||
      !transferred.sources.every((source) =>
        prepared.sources.some(
          (persisted) =>
            persisted.sourceId === source.sourceId &&
            persisted.contentHash === source.contentHash &&
            persisted.contentVersion === source.contentVersion &&
            persisted.recordCount === source.recordCount,
        ),
      ) ||
      (prepared.phase !== "planning" && prepared.phase !== "awaitingApproval")
    ) {
      throw new Error(
        "DeepPlan source collection has not been confirmed. Retry before starting the agent.",
      );
    }
    return prepared;
  } catch (error) {
    try {
      const failed = await api.getRun({ threadId: input.threadId, runId });
      if (failed)
        await pauseRun({
          api,
          run: failed,
          reason: error instanceof Error ? error.message : "DeepPlan source collection failed.",
          createId: input.createId,
          now,
        });
    } catch {
      // A disconnected target still rejects execution while its sources are incomplete.
    }
    throw error;
  }
}

function preparationKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify([environmentId, threadId]);
}

const preparations = new Map<
  string,
  { readonly selectionKey: string; readonly result: Promise<DeepPlanRun> }
>();

export async function prepareDeepPlanForTurn(
  input: Parameters<typeof prepareDeepPlan>[0],
): Promise<DeepPlanRun> {
  if (input.signal?.aborted) throw new Error("DeepPlan source collection was canceled.");
  const key = preparationKey(input.environmentId, input.threadId);
  const selectionKey = JSON.stringify([
    input.projectId,
    uniqueDeepPlanSourceRefs(input.additionalSourceRefs ?? [])
      .filter(
        (source) =>
          source.environmentId !== input.environmentId || source.projectId !== input.projectId,
      )
      .map(deepPlanSourceRefKey)
      .sort(),
  ]);
  const active = preparations.get(key);
  if (active) {
    if (active.selectionKey !== selectionKey)
      throw new Error("Wait for source collection to finish before changing the selected chats.");
    return awaitDeepPlanSourceOperation(active.result, input.signal);
  }
  const preparation = { selectionKey, result: prepareDeepPlan(input) };
  preparations.set(key, preparation);
  const finish = () => {
    if (preparations.get(key) === preparation) preparations.delete(key);
  };
  void preparation.result.then(finish, finish);
  return preparation.result;
}

export async function continueDeepPlanForTurn(input: {
  readonly run: DeepPlanRun;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly fallbackModelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly apiForEnvironment: Parameters<typeof prepareDeepPlanForTurn>[0]["apiForEnvironment"];
  readonly createId: () => string;
  readonly now?: () => string;
}): Promise<DeepPlanRun> {
  const api = await input.apiForEnvironment(input.environmentId);
  if (!api) throw new Error("Connect to this environment before continuing Deep Plan.");
  const now = input.now ?? (() => DateTime.formatIso(DateTime.nowUnsafe()));
  let run = await api.getRun({ threadId: input.run.threadId, runId: input.run.id });
  if (!run || run.id !== input.run.id || run.phase === "completed")
    throw new Error("This Deep Plan is no longer waiting to continue.");
  const preparation = preparations.get(preparationKey(input.environmentId, run.threadId));
  // The original sender owns starting the turn once this collection finishes.
  if (preparation) return preparation.result;
  if (!run.approval && (run.phase === "collecting" || !importsComplete(run))) {
    run = await prepareDeepPlanForTurn({
      environmentId: input.environmentId,
      projectId: input.projectId,
      threadId: run.threadId,
      additionalSourceRefs: run.sources.map((source) => source.origin),
      existingRun: run,
      apiForEnvironment: input.apiForEnvironment,
      createId: input.createId,
      now,
    });
  } else if (["paused", "failed", "blocked"].includes(run.phase)) {
    await api.dispatchCommand({
      type: "thread.deep-plan.update",
      commandId: CommandId.make(input.createId()),
      threadId: run.threadId,
      runId: run.id,
      expectedRevision: run.revision,
      operationId: input.createId(),
      createdAt: now(),
      mutation: { type: "resume" },
    });
    const resumed = await api.getRun({ threadId: run.threadId, runId: run.id });
    if (
      !resumed ||
      resumed.id !== run.id ||
      ["paused", "failed", "blocked"].includes(resumed.phase)
    )
      throw new Error("Deep Plan resumption was not confirmed. Refresh before continuing.");
    run = resumed;
  }
  // The durable validation reactor owns the validation turn, including resumed attempts.
  if (run.approval && selectDeepPlanProgress(run).allStepsVerified) return run;
  if (run.phase === "awaitingApproval") return run;
  const selection = run.approval?.implementation ?? input.fallbackModelSelection;
  const modelSelection: ModelSelection = {
    instanceId: selection.instanceId,
    model: selection.model,
    ...(selection.options === undefined ? {} : { options: selection.options }),
  };
  const requestedParallelism = run.approval?.requestedParallelism ?? 1;
  const provider = input.providers?.find((entry) => entry.instanceId === modelSelection.instanceId);
  const text = run.approval
    ? buildDeepPlanImplementationPrompt(run, {
        strategy:
          requestedParallelism > 1
            ? { kind: "subagents", count: requestedParallelism }
            : { kind: "standard" },
        ...(provider ? { provider } : {}),
      })
    : `Resume Deep Plan run ${run.id} owned by thread ${run.threadId}. Read its durable state with deep_plan_state, continue reading and summarizing every frozen source, and publish the complete structured plan with deep_plan_publish. Do not omit unavailable sources or begin implementation before approval.`;
  await api.dispatchCommand({
    type: "thread.turn.start",
    commandId: CommandId.make(input.createId()),
    threadId: run.approval?.implementationThreadId ?? run.threadId,
    message: { messageId: MessageId.make(input.createId()), role: "user", text, attachments: [] },
    modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: run.approval ? "default" : "plan",
    createdAt: now(),
  });
  return run;
}
