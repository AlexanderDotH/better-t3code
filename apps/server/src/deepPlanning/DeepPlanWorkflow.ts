import {
  CommandId,
  DeepPlanError,
  isDeepPlanRun,
  type DeepPlanGetRunInput,
  type DeepPlanGetRunResult,
  type DeepPlanRun,
  type ProviderInstanceId,
  type ThreadDeepPlanStartCommand,
  type ThreadDeepPlanUpdateCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapters from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ChatReferences from "./DeepPlanChatReferences.ts";
import { isRunningDeepPlan } from "./deepPlanNextAction.ts";

export type DeepPlanUpdateInput = Omit<
  ThreadDeepPlanUpdateCommand,
  "type" | "commandId" | "createdAt" | "defaultReviewer"
>;

export class DeepPlanWorkflow extends Context.Service<
  DeepPlanWorkflow,
  {
    readonly getRun: (
      input: DeepPlanGetRunInput,
    ) => Effect.Effect<DeepPlanGetRunResult, DeepPlanError>;
    readonly update: (input: DeepPlanUpdateInput) => Effect.Effect<DeepPlanRun, DeepPlanError>;
    readonly dispatch: (
      command: ThreadDeepPlanStartCommand | ThreadDeepPlanUpdateCommand,
    ) => Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, DeepPlanError>;
    readonly pauseForStop: (threadId: ThreadId) => Effect.Effect<void, DeepPlanError>;
  }
>()("t3/deepPlanning/DeepPlanWorkflow") {}

const decodeErrorCode = Schema.decodeUnknownOption(DeepPlanError.fields.code);

function dispatchError(error: Orchestrator.OrchestratorV2Error): DeepPlanError {
  const cause = error._tag === "OrchestratorDispatchError" ? error.cause : error;
  if (Predicate.isObject(cause) && "context" in cause && "detail" in cause) {
    const context = cause.context;
    const code =
      Predicate.isObject(context) && "deepPlanCode" in context
        ? Option.getOrElse(
            decodeErrorCode(context.deepPlanCode),
            () => "invalid-transition" as const,
          )
        : "invalid-transition";
    return new DeepPlanError({ code, message: String(cause.detail) });
  }
  return new DeepPlanError({ code: "storage-failed", message: error.message });
}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const adapters = yield* ProviderAdapters.ProviderAdapterRegistryV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const chats = yield* ChatReferences.DeepPlanChatReferences;
  const crypto = yield* Crypto.Crypto;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextCommandId = crypto.randomUUIDv4().pipe(
    Effect.map(CommandId.make),
    Effect.mapError(
      () =>
        new DeepPlanError({
          code: "storage-failed",
          message: "Could not create a Deep Plan command identifier.",
        }),
    ),
  );

  const getRun: DeepPlanWorkflow["Service"]["getRun"] = Effect.fn("DeepPlanWorkflow.getRun")(
    function* ({ threadId, runId }) {
      const row = yield* engine.getThreadShell(threadId);
      if (row === null || row.deletedAt !== null) return null;
      if (row.deepPlan?.threadId === row.id) {
        return runId === undefined || runId === row.deepPlan.id ? row.deepPlan : null;
      }
      const binding = row.deepPlanExecution;
      const ownerId = binding?.runThreadId ?? row.deepPlan?.threadId;
      if (ownerId === undefined) return null;
      const owner = yield* engine.getThreadShell(ownerId);
      const run = owner?.deepPlan;
      if (
        owner?.deletedAt !== null ||
        run?.threadId !== owner.id ||
        run.id !== (binding?.runId ?? row.deepPlan?.id) ||
        (runId !== undefined && runId !== run.id)
      )
        return null;
      return run;
    },
    Effect.mapError(dispatchError),
  );

  const requireRun = Effect.fn("DeepPlanWorkflow.requireRun")(function* (
    input: DeepPlanGetRunInput,
  ) {
    const run = yield* getRun(input);
    if (run === null)
      return yield* new DeepPlanError({
        code: "run-not-found",
        message: "The Deep Plan run was not found in this thread.",
      });
    if (!isDeepPlanRun(run))
      return yield* new DeepPlanError({
        code: "invalid-transition",
        message:
          "This Deep Plan was started by an older version. Start a new Deep Plan to continue.",
      });
    return run;
  });

  const requireProvider = Effect.fn("DeepPlanWorkflow.requireProvider")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const adapter = yield* adapters.get(instanceId).pipe(
      Effect.mapError(
        () =>
          new DeepPlanError({
            code: "target-unavailable",
            message: `Deep Plan provider ${instanceId} is unavailable.`,
          }),
      ),
    );
    const capabilities = yield* adapter.getCapabilities().pipe(
      Effect.mapError(
        () =>
          new DeepPlanError({
            code: "target-unavailable",
            message: `Could not check Deep Plan support for provider ${instanceId}.`,
          }),
      ),
    );
    if (capabilities.deepPlan?.supported !== true)
      return yield* new DeepPlanError({
        code: "invalid-transition",
        message:
          capabilities.deepPlan?.supported === false
            ? capabilities.deepPlan.reason
            : `Provider ${instanceId} does not support Deep Plan.`,
      });
  });

  const dispatch: DeepPlanWorkflow["Service"]["dispatch"] = Effect.fn("DeepPlanWorkflow.dispatch")(
    function* (command) {
      if (yield* threads.hasReceipt(command.commandId)) {
        return yield* engine.dispatch(command).pipe(Effect.mapError(dispatchError));
      }
      if (command.type === "thread.deep-plan.start") {
        const owner = yield* engine
          .getThreadShell(command.threadId)
          .pipe(Effect.mapError(dispatchError));
        if (owner === null || owner.deletedAt !== null || owner.archivedAt !== null) {
          return yield* new DeepPlanError({
            code: "target-unavailable",
            message: "The planning thread is unavailable.",
          });
        }
        yield* chats.assertReadable(command.chats, owner.linkOrigin);
        return yield* engine.dispatch(command).pipe(Effect.mapError(dispatchError));
      }
      const mutation = command.mutation;
      if (mutation.type !== "approve") {
        return yield* engine.dispatch(command).pipe(Effect.mapError(dispatchError));
      }
      const run = yield* getRun({ threadId: command.threadId, runId: command.runId });
      if (
        isDeepPlanRun(run) &&
        run.operations.some((operation) => operation.operationId === command.operationId)
      ) {
        return yield* engine.dispatch(command).pipe(Effect.mapError(dispatchError));
      }
      const defaultReviewer =
        mutation.reviewer === undefined
          ? (yield* settings.getSettings.pipe(
              Effect.mapError(
                () =>
                  new DeepPlanError({
                    code: "storage-failed",
                    message: "Could not load the Deep Plan review model setting.",
                  }),
              ),
            )).deepPlanReviewModelSelection
          : null;
      const reviewer = mutation.reviewer ?? defaultReviewer ?? mutation.implementation;
      yield* requireProvider(mutation.implementation.instanceId);
      if (reviewer.instanceId !== mutation.implementation.instanceId) {
        yield* requireProvider(reviewer.instanceId);
      }
      return yield* engine
        .dispatch(defaultReviewer === null ? command : { ...command, defaultReviewer })
        .pipe(Effect.mapError(dispatchError));
    },
  );

  const update: DeepPlanWorkflow["Service"]["update"] = Effect.fn("DeepPlanWorkflow.update")(
    function* (input) {
      yield* dispatch({
        ...input,
        type: "thread.deep-plan.update",
        commandId: yield* nextCommandId,
        createdAt: yield* nowIso,
      });
      return yield* requireRun({ threadId: input.threadId, runId: input.runId });
    },
  );

  const pauseForStop: DeepPlanWorkflow["Service"]["pauseForStop"] = Effect.fn(
    "DeepPlanWorkflow.pauseForStop",
  )(function* (threadId) {
    const initial = yield* getRun({ threadId });
    if (!isDeepPlanRun(initial)) return;
    let run = initial;
    while (true) {
      if (
        !isRunningDeepPlan(run) ||
        (threadId !== run.threadId &&
          !run.approval?.lanes.some((lane) => lane.threadId === threadId) &&
          !run.activeTurns.some((turn) => turn.threadId === threadId))
      )
        return;

      const paused = yield* dispatch({
        type: "thread.deep-plan.update",
        commandId: yield* nextCommandId,
        threadId: run.threadId,
        runId: run.id,
        expectedRevision: run.revision,
        operationId: yield* crypto.randomUUIDv4().pipe(Effect.orDie),
        createdAt: yield* nowIso,
        mutation: { type: "pause", reason: "Stopped by the user." },
      }).pipe(
        Effect.as(true),
        Effect.catchTags({
          DeepPlanError: (error) =>
            error.code === "stale-revision" || error.code === "run-not-found"
              ? Effect.succeed(false)
              : Effect.fail(error),
        }),
      );
      if (paused) return;
      const current = yield* getRun({ threadId, runId: initial.id });
      if (!isDeepPlanRun(current)) return;
      run = current;
    }
  });

  return DeepPlanWorkflow.of({ getRun, update, dispatch, pauseForStop });
});

export const DeepPlanWorkflowLive = Layer.effect(DeepPlanWorkflow, make);
