import { CommandId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { OrchestratorV2, type OrchestratorV2Error } from "../orchestration-v2/Orchestrator.ts";
import {
  ThreadManagementService,
  type ThreadManagementError,
} from "../orchestration-v2/ThreadManagementService.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { planFetchExploration } from "./FetchExplorationPlanner.ts";
import { buildFetchContext } from "./FetchContext.ts";
import { buildFetchWorkerPrompt } from "./FetchWorkerPolicy.ts";
import type { FetchRunInput, FetchRunResult, FetchWorkerOutcome } from "./FetchWorkerState.ts";
export type {
  FetchRunInput,
  FetchRunResult,
  FetchWorkerAssignment,
  FetchWorkerOutcome,
  FetchWorkerOutcomeStatus,
} from "./FetchWorkerState.ts";
export type FetchWorkerCoordinatorError = OrchestratorV2Error | ThreadManagementError;
export interface FetchWorkerCoordinatorShape {
  readonly run: (
    input: FetchRunInput,
  ) => Effect.Effect<FetchRunResult, FetchWorkerCoordinatorError>;
}

export class FetchWorkerCoordinator extends Context.Service<
  FetchWorkerCoordinator,
  FetchWorkerCoordinatorShape
>()("t3/fetch/FetchWorkerCoordinator") {}

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestratorV2;
  const threads = yield* ThreadManagementService;
  const generation = yield* TextGeneration;
  const crypto = yield* Crypto.Crypto;
  const nextId = () => crypto.randomUUIDv4().pipe(Effect.map(CommandId.make), Effect.orDie);
  const run: FetchWorkerCoordinatorShape["run"] = Effect.fn("FetchWorkerCoordinator.run")(
    function* (input) {
      const parent = yield* orchestration.getThreadRecords(input.threadId, ["runs"]);
      const parentRun = parent.runs
        .filter((run) => ["starting", "running", "waiting"].includes(run.status))
        .at(-1);
      const counts = { plannedWorkers: 0, completedWorkers: 0, successfulWorkers: 0 };
      let modelSelection = input.modelSelection;
      let providerDriver = input.providerDriver;
      let maxRecommendedWorkers = input.maxRecommendedWorkers;
      const warnings: string[] = [];
      const base = () => ({
        runId: parentRun?.id ?? "",
        providerInstanceId: modelSelection.instanceId,
        providerDriver,
        modelSelection,
      });
      if (!parentRun || parentRun.rootNodeId === null || input.commandExecutionPolicy !== "deny")
        return {
          ...base(),
          ...counts,
          status: "unavailable",
          warnings: ["Repository exploration requires an active parent run and command denial."],
        };
      const plan = () =>
        planFetchExploration({
          cwd: input.cwd,
          userRequest: input.userRequest,
          modelSelection,
          maxRecommendedWorkers,
        }).pipe(Effect.provideService(TextGeneration, generation));
      let planning = yield* plan();
      const typedFallback = (reason: typeof planning.fallbackReason) =>
        reason === "model-unavailable" || reason === "entitlement" || reason === "rate-limited";
      if (typedFallback(planning.fallbackReason) && input.lunaFallback !== undefined) {
        modelSelection = input.lunaFallback.modelSelection;
        providerDriver = input.lunaFallback.providerDriver;
        maxRecommendedWorkers = input.lunaFallback.maxRecommendedWorkers;
        warnings.push("Spark was unavailable; repository exploration used Luna.");
        planning = yield* plan();
      }
      if (typedFallback(planning.fallbackReason))
        return {
          ...base(),
          ...counts,
          status: "unavailable",
          warnings: [
            ...warnings,
            "The selected exploration model is unavailable; the main turn will continue.",
          ],
        };
      if (planning.plan.decision === "skip")
        return { ...base(), ...counts, status: "skipped", warnings };
      const tasks = yield* Effect.forEach(planning.plan.workers, (assignment) =>
        Effect.gen(function* () {
          const result = yield* orchestration.dispatch({
            type: "delegated_task.request",
            commandId: yield* nextId(),
            parentThreadId: input.threadId,
            parentRunId: parentRun.id,
            parentNodeId: parentRun.rootNodeId!,
            task: buildFetchWorkerPrompt({ userRequest: input.userRequest, ...assignment }),
            title: `Fetch: ${assignment.scope}`,
            modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "plan",
            fetchWorker: { commandExecutionPolicy: "deny" },
            createdBy: "agent",
            creationSource: "server",
          });
          return result.storedEvents.flatMap(({ event }) =>
            event.type === "subagent.updated" ? [event.payload] : [],
          );
        }),
      ).pipe(Effect.map((groups) => groups.flat()));
      const outcomes = yield* Effect.forEach(
        tasks,
        (task, index) =>
          Effect.gen(function* (): Effect.fn.Return<
            FetchWorkerOutcome,
            FetchWorkerCoordinatorError
          > {
            if (task.childThreadId === null)
              return {
                index,
                scope: planning.plan.workers[index]!.scope,
                status: "error",
                findings: "",
                detail: "The worker has no child thread.",
              };
            const result = yield* threads.waitForThread({
              threadId: task.childThreadId,
              projectId: parent.thread.projectId,
              timeoutMs: 180_000,
              untilDelegatedWorkSettled: true,
            });
            if (result.timedOut)
              yield* threads.dispatch({
                type: "thread.stop",
                commandId: yield* nextId(),
                threadId: task.childThreadId,
              });
            const child = yield* orchestration.getThreadRecords(task.childThreadId, ["messages"]);
            const findings = child.messages
              .filter((message) => message.role === "assistant")
              .map((message) => message.text)
              .join("\n\n");
            return {
              index,
              scope: planning.plan.workers[index]!.scope,
              status: result.timedOut
                ? "timed-out"
                : result.run?.status === "completed"
                  ? "completed"
                  : "error",
              findings,
            };
          }),
        { concurrency: "unbounded" },
      );
      const successfulWorkers = outcomes.filter(
        (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
      ).length;
      const context = buildFetchContext({
        plannedWorkers: tasks.length,
        modelSelection,
        providerDriver,
        outcomes,
        ...(input.contextMaxChars === undefined ? {} : { maxChars: input.contextMaxChars }),
      });
      return {
        ...base(),
        status: "completed",
        plannedWorkers: tasks.length,
        completedWorkers: outcomes.filter((outcome) => outcome.status === "completed").length,
        successfulWorkers,
        warnings:
          successfulWorkers === tasks.length
            ? warnings
            : [
                ...warnings,
                "Repository exploration returned partial results; failed workers remain visible.",
              ],
        ...(context === undefined ? {} : { context }),
      };
    },
  );
  return FetchWorkerCoordinator.of({ run });
});
export const FetchWorkerCoordinatorLive = Layer.effect(FetchWorkerCoordinator, make);
