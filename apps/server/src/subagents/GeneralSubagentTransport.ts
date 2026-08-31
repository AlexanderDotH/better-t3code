import type { ApprovalRequestId, ProviderApprovalDecision } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import type { ActiveGeneralSubagent } from "./GeneralSubagentState.ts";

export const GENERAL_SUBAGENT_ABORT_FORCE_DELAY = Duration.seconds(5);

export interface GeneralSubagentTransportDependencies {
  readonly providerService: ProviderService["Service"];
  readonly resourceGovernor?: ResourceProtection.SubagentResourceGovernor["Service"];
}

export function makeGeneralSubagentTransport(dependencies: GeneralSubagentTransportDependencies) {
  const abortTarget = (worker: ActiveGeneralSubagent) => ({
    threadId: worker.syntheticThreadId,
    runtimeSessionId: worker.runtimeSessionId,
    turnId: worker.turnId,
    providerInstanceId: worker.selection.instanceId,
  });

  const awaitAdmission = (worker: ActiveGeneralSubagent) =>
    dependencies.resourceGovernor
      ? dependencies.resourceGovernor.awaitAdmission({
          threadId: worker.syntheticThreadId,
          provider: worker.providerDriver,
          providerInstanceId: worker.selection.instanceId,
          configurationKey: ResourceProtection.resourceConfigurationKey([
            "general-subagent",
            worker.providerDriver,
            worker.selection.instanceId,
            worker.selection,
          ]),
        })
      : Effect.succeed(true);

  const startSession = (worker: ActiveGeneralSubagent) =>
    dependencies.providerService.startTransientSession(
      worker.syntheticThreadId,
      {
        threadId: worker.syntheticThreadId,
        purpose: "subagent-worker",
        runtimeSessionId: worker.runtimeSessionId,
        providerInstanceId: worker.selection.instanceId,
        cwd: worker.cwd,
        modelSelection: worker.selection,
        freshSession: worker.turnSequence === 0,
        runtimeMode: worker.runtimeMode,
      },
      { workspaceContextThreadId: worker.parentThreadId, mcpMode: "full" },
    );

  const sendTurn = (worker: ActiveGeneralSubagent, prompt: string) =>
    dependencies.providerService.sendTurn({
      threadId: worker.syntheticThreadId,
      input: prompt,
      modelSelection: worker.selection,
      interactionMode: "default",
    });

  const respondToRequest = (
    worker: ActiveGeneralSubagent,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) =>
    dependencies.providerService.respondToRequest({
      threadId: worker.syntheticThreadId,
      requestId,
      decision,
    });

  const cancelResourceOwnership = (worker: ActiveGeneralSubagent, operation: string) =>
    dependencies.resourceGovernor
      ? dependencies.resourceGovernor.cancelThread(worker.syntheticThreadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`General subagent resource ${operation} failed`, {
              subagentId: worker.subagentId,
              cause: Cause.pretty(cause),
            }),
          ),
        )
      : Effect.void;

  const interrupt = (worker: ActiveGeneralSubagent) =>
    Effect.gen(function* () {
      yield* cancelResourceOwnership(worker, "cancellation");
      if (!worker.sessionStarted) return;
      yield* dependencies.providerService.interruptAbortTarget(abortTarget(worker)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent cooperative interrupt failed", {
            subagentId: worker.subagentId,
            runtimeSessionId: worker.runtimeSessionId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    });

  const forceStop = (worker: ActiveGeneralSubagent) =>
    worker.sessionStarted
      ? dependencies.providerService.forceStopAbortTarget(abortTarget(worker)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("General subagent force stop failed", {
              subagentId: worker.subagentId,
              runtimeSessionId: worker.runtimeSessionId,
              cause: Cause.pretty(cause),
            }),
          ),
          Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
          Effect.asVoid,
        )
      : Effect.void;

  const cleanup = Effect.fn("GeneralSubagentTransport.cleanup")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    yield* cancelResourceOwnership(worker, "cleanup");
    if (!worker.sessionStarted) return;
    const target = {
      threadId: worker.syntheticThreadId,
      runtimeSessionId: worker.runtimeSessionId,
      providerInstanceId: worker.selection.instanceId,
    };
    const stopped = yield* dependencies.providerService
      .stopTransientSession(target)
      .pipe(Effect.exit, Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY));
    if (Option.isNone(stopped) || Exit.isFailure(stopped.value)) {
      yield* forceStop(worker);
    }
    worker.sessionStarted = false;
  });

  return {
    events: dependencies.providerService.streamEvents,
    awaitAdmission,
    startSession,
    sendTurn,
    respondToRequest,
    interrupt,
    forceStop,
    cleanup,
  };
}

export type GeneralSubagentTransport = ReturnType<typeof makeGeneralSubagentTransport>;
