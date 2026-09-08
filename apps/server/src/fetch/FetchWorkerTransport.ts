import { ApprovalRequestId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import type { ActiveFetchWorker } from "./FetchWorkerState.ts";

export const FETCH_ABORT_FORCE_DELAY = Duration.seconds(5);

export interface FetchWorkerTransportDependencies {
  readonly providerService: ProviderService["Service"];
  readonly resourceGovernor: ResourceProtection.SubagentResourceGovernor["Service"] | undefined;
}

function abortTarget(worker: ActiveFetchWorker) {
  return {
    threadId: worker.syntheticThreadId,
    runtimeSessionId: worker.runtimeSessionId,
    turnId: worker.turnId,
    providerInstanceId: worker.run.selection.instanceId,
  };
}

export function makeFetchWorkerTransport(dependencies: FetchWorkerTransportDependencies) {
  const awaitAdmission = (worker: ActiveFetchWorker) => {
    if (dependencies.resourceGovernor === undefined) return Effect.succeed(true);
    return dependencies.resourceGovernor.awaitAdmission({
      threadId: worker.syntheticThreadId,
      provider: worker.run.providerDriver,
      providerInstanceId: worker.run.selection.instanceId,
      configurationKey: ResourceProtection.resourceConfigurationKey([
        "fetch-worker",
        worker.run.providerDriver,
        worker.run.selection.instanceId,
        worker.run.selection,
      ]),
    });
  };

  const interrupt = (worker: ActiveFetchWorker) =>
    Effect.gen(function* () {
      if (dependencies.resourceGovernor !== undefined) {
        yield* dependencies.resourceGovernor.cancelThread(worker.syntheticThreadId);
      }
      if (!worker.sessionStarted) return;
      yield* dependencies.providerService.interruptAbortTarget(abortTarget(worker)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Fetch worker cooperative interrupt failed", {
            threadId: worker.syntheticThreadId,
            runtimeSessionId: worker.runtimeSessionId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    });

  const forceStop = (worker: ActiveFetchWorker) =>
    worker.sessionStarted
      ? dependencies.providerService.forceStopAbortTarget(abortTarget(worker)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Fetch worker force stop failed", {
              threadId: worker.syntheticThreadId,
              runtimeSessionId: worker.runtimeSessionId,
              cause: Cause.pretty(cause),
            }),
          ),
          Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY),
          Effect.asVoid,
        )
      : Effect.void;

  const cleanup = (worker: ActiveFetchWorker) =>
    Effect.gen(function* () {
      if (worker.cleanedUp) return;
      worker.cleanedUp = true;
      if (dependencies.resourceGovernor !== undefined) {
        yield* dependencies.resourceGovernor.cancelThread(worker.syntheticThreadId);
      }
      const target = {
        threadId: worker.syntheticThreadId,
        runtimeSessionId: worker.runtimeSessionId,
        providerInstanceId: worker.run.selection.instanceId,
      };
      const stopped = yield* dependencies.providerService
        .stopTransientSession(target)
        .pipe(Effect.exit, Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY));
      if (Option.isNone(stopped)) {
        yield* Effect.logWarning("Fetch transient session cleanup timed out", target);
        yield* forceStop(worker);
        return;
      }
      if (Exit.isSuccess(stopped.value)) return;
      yield* Effect.logWarning("Fetch transient session cleanup failed", {
        ...target,
        cause: Cause.pretty(stopped.value.cause),
      });
      yield* forceStop(worker);
    });

  const startSession = (worker: ActiveFetchWorker) =>
    dependencies.providerService.startTransientSession(
      worker.syntheticThreadId,
      {
        threadId: worker.syntheticThreadId,
        purpose: "fetch-worker",
        runtimeSessionId: worker.runtimeSessionId,
        providerInstanceId: worker.run.selection.instanceId,
        cwd: worker.run.input.cwd,
        modelSelection: worker.run.selection,
        freshSession: true,
        approvalPolicy: "on-request",
        sandboxMode: "read-only",
        runtimeMode: "approval-required",
      },
      { workspaceContextThreadId: worker.run.input.threadId },
    );

  const sendTurn = (worker: ActiveFetchWorker, prompt: string) =>
    dependencies.providerService.sendTurn({
      threadId: worker.syntheticThreadId,
      input: prompt,
      modelSelection: worker.run.selection,
      interactionMode: "plan",
    });

  const respondToRequest = (
    worker: ActiveFetchWorker,
    requestId: string,
    decision: "accept" | "decline",
  ) =>
    dependencies.providerService.respondToRequest({
      threadId: worker.syntheticThreadId,
      requestId: ApprovalRequestId.make(requestId),
      decision,
    });

  return {
    events: dependencies.providerService.streamEvents,
    awaitAdmission,
    interrupt,
    forceStop,
    cleanup,
    startSession,
    sendTurn,
    respondToRequest,
  };
}

export type FetchWorkerTransport = ReturnType<typeof makeFetchWorkerTransport>;
