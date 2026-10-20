import { CommandId, MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  DeepPlanValidationDispatcher,
  DeepPlanValidationDispatchError,
} from "./DeepPlanValidationReactor.ts";
import { DeepPlanWorkflow } from "./DeepPlanWorkflow.ts";
import { deepPlanMarkdown } from "./deepPlanMarkdown.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const workflow = yield* DeepPlanWorkflow;
  return DeepPlanValidationDispatcher.of({
    dispatch: (requestedRun, requestId) =>
      workflow
        .withRunLock(
          requestedRun.id,
          Effect.gen(function* () {
            const run = yield* workflow.getRun({
              threadId: requestedRun.threadId,
              runId: requestedRun.id,
            });
            if (!run?.plan || !run.approval || run.phase !== "validating")
              return "deferred" as const;
            const targetId = run.approval.implementationThreadId;
            const target = yield* query.getThreadShellById(targetId);
            if (Option.isNone(target) || target.value.archivedAt !== null) {
              return yield* new DeepPlanValidationDispatchError({
                message: "The implementing thread is unavailable for final validation.",
              });
            }
            if (
              target.value.session?.status === "running" ||
              target.value.session?.status === "starting" ||
              target.value.latestTurn?.state === "running"
            )
              return "deferred" as const;
            const actor = {
              implementerId: run.approval.implementerId,
              model: run.approval.implementation,
            };
            if (run.finalValidation.status === "pending") {
              yield* workflow.update({
                threadId: run.threadId,
                runId: run.id,
                expectedRevision: run.revision,
                operationId: requestId + ":start",
                mutation: { type: "validation-start", requestId, actor },
              });
            } else if (run.finalValidation.requestId !== requestId) {
              return "deferred" as const;
            }
            const prompt = [
              "Perform the explicit final overall validation of the approved Deep Plan now.",
              `Run: ${run.id}; owner thread: ${run.threadId}; plan version: ${run.plan.version}; validation request: ${requestId}.`,
              "Use deep_plan_state to read the current revision and deep_plan_validation to record the result with concrete evidence.",
              "You are the implementing agent. Use the approved model selection. Check every acceptance criterion and the result as a whole: integration, regressions, affected clients, required tests, and remaining work.",
              "Fix problems within the approved scope and repeat the affected checks. Leave unavailable checks visibly unresolved. Do not declare success until all checks pass.",
              "Changes to the goal, scope or acceptance criteria require a new plan version and approval.",
              deepPlanMarkdown(run.plan),
            ].join("\n\n");
            yield* engine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make(requestId),
              threadId: targetId,
              message: {
                messageId: MessageId.make(requestId + ":message"),
                role: "user",
                text: prompt,
                attachments: [],
              },
              background: { runId: run.id },
              idleGuard: {},
              modelSelection: {
                instanceId: run.approval.implementation.instanceId,
                model: run.approval.implementation.model,
                ...(run.approval.implementation.options === undefined
                  ? {}
                  : { options: run.approval.implementation.options }),
              },
              runtimeMode: target.value.runtimeMode,
              interactionMode: "default",
              createdAt: DateTime.formatIso(yield* DateTime.now),
            });
            return "dispatched" as const;
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(DeepPlanValidationDispatchError)(cause)
              ? cause
              : new DeepPlanValidationDispatchError({
                  message: "Could not start Deep Plan final validation.",
                  cause,
                }),
          ),
        ),
  });
});

export const DeepPlanValidationDispatcherLive = Layer.effect(DeepPlanValidationDispatcher, make);
