import {
  CommandId,
  type DeepPlanRun,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { canContinueDeepPlan } from "./DeepPlanContinuation.ts";
import type { OrchestrationCommandReceiptRepository } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import type { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

type TurnStartEvent = Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>;

export function canDispatchDeepPlanValidationRequest(
  event: TurnStartEvent,
  run: DeepPlanRun | null | undefined,
): boolean {
  const commandId = event.commandId;
  const validationRequest =
    commandId?.startsWith("deep-plan:") === true &&
    event.payload.messageId === commandId + ":message";
  if (!validationRequest) return true;
  return (
    run?.phase === "validating" &&
    run.finalValidation.requestId === commandId &&
    run.approval?.implementationThreadId === event.payload.threadId
  );
}

export const pendingDeepPlanTurnRequests = Effect.fn("pendingDeepPlanTurnRequests")(
  function* (input: {
    readonly readModel: OrchestrationReadModel;
    readonly receipts: OrchestrationCommandReceiptRepository["Service"];
    readonly turns: ProjectionTurnRepository["Service"];
    readonly engine: Pick<OrchestrationEngineService["Service"], "readThreadEvents">;
  }) {
    const runs = new Map<string, DeepPlanRun>();
    for (const thread of input.readModel.threads) {
      const run = thread.deepPlan;
      if (thread.deletedAt !== null || thread.archivedAt !== null || run?.threadId !== thread.id)
        continue;
      // The reactor also recovers requests from before a mode change to release their reservations.
      if (canContinueDeepPlan(run, "plan")) runs.set(run.id, run);
    }
    const events: Array<TurnStartEvent> = [];
    for (const run of runs.values()) {
      const targetId = run.approval?.implementationThreadId ?? run.threadId;
      const target = input.readModel.threads.find((thread) => thread.id === targetId);
      if (!target || target.deletedAt !== null || target.archivedAt !== null) continue;
      const pending = yield* input.turns.getPendingTurnStartByThreadId({ threadId: targetId });
      if (Option.isNone(pending) || !pending.value.messageId.endsWith(":message")) continue;
      const requestId = pending.value.messageId.slice(0, -":message".length);
      const receipt = yield* input.receipts.getByCommandId({
        commandId: CommandId.make(requestId),
      });
      if (
        Option.isNone(receipt) ||
        receipt.value.status !== "accepted" ||
        receipt.value.aggregateKind !== "thread" ||
        receipt.value.aggregateId !== targetId ||
        receipt.value.error !== null ||
        receipt.value.resultSequence < 1
      )
        continue;
      const event = yield* input.engine
        .readThreadEvents({
          threadId: targetId,
          fromSequenceExclusive: receipt.value.resultSequence - 1,
          toSequenceInclusive: receipt.value.resultSequence,
          limit: 1,
        })
        .pipe(Stream.runHead);
      if (
        Option.isSome(event) &&
        event.value.type === "thread.turn-start-requested" &&
        event.value.commandId === requestId &&
        event.value.payload.messageId === pending.value.messageId &&
        (event.value.payload.background?.runId === run.id ||
          (run.phase === "validating" && run.finalValidation.requestId === requestId))
      )
        events.push(event.value);
    }
    return events;
  },
);
