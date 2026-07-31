import {
  isPlanParallelismReviewDriverKind,
  PlanParallelismReviewError,
  type PlanParallelismReviewErrorReason,
  type PlanParallelismReviewInput,
  type PlanParallelismReviewResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import {
  PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
  PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
  truncatePlanParallelismReviewContext,
} from "../textGeneration/TextGenerationPrompts.ts";

const REVIEW_TIMEOUT = Duration.seconds(20);

function reviewError(
  reason: PlanParallelismReviewErrorReason,
  message: string,
): PlanParallelismReviewError {
  return new PlanParallelismReviewError({ reason, message });
}

export class PlanParallelismReview extends Context.Service<
  PlanParallelismReview,
  {
    readonly review: (
      input: PlanParallelismReviewInput,
    ) => Effect.Effect<PlanParallelismReviewResult, PlanParallelismReviewError>;
  }
>()("t3/plan/PlanParallelismReview") {}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerInstanceRegistry = yield* ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettingsService;
  const textGeneration = yield* TextGeneration;

  const review: PlanParallelismReview["Service"]["review"] = Effect.fn(
    "PlanParallelismReview.review",
  )(function* (input) {
    const threadOption = yield* projectionSnapshotQuery
      .getThreadDetailById(input.threadId)
      .pipe(
        Effect.mapError(() =>
          reviewError("plan-not-found", "The proposed plan could not be loaded."),
        ),
      );
    if (Option.isNone(threadOption)) {
      return yield* reviewError("plan-not-found", "The proposed plan was not found.");
    }
    const thread = threadOption.value;
    const plan = thread.proposedPlans.find((candidate) => candidate.id === input.planId);
    if (!plan) {
      return yield* reviewError("plan-not-found", "The proposed plan was not found.");
    }
    if (plan.updatedAt !== input.expectedPlanUpdatedAt) {
      return yield* reviewError(
        "plan-stale",
        "The proposed plan changed before its parallelism review completed.",
      );
    }

    const projectOption = yield* projectionSnapshotQuery
      .getProjectShellById(thread.projectId)
      .pipe(
        Effect.mapError(() =>
          reviewError("plan-not-found", "The project for the proposed plan could not be loaded."),
        ),
      );
    if (Option.isNone(projectOption)) {
      return yield* reviewError(
        "plan-not-found",
        "The project for the proposed plan was not found.",
      );
    }

    const implementationProvider = yield* providerInstanceRegistry.getInstance(
      input.implementationProviderInstanceId,
    );
    if (!implementationProvider?.enabled) {
      return yield* reviewError(
        "implementation-provider-unsupported",
        "The implementation provider is unavailable.",
      );
    }
    const implementationSnapshot = yield* implementationProvider.snapshot.getSnapshot;
    const maxSubagents = implementationSnapshot.nativeSubagents?.maxRecommendedSubagents;
    if (maxSubagents === undefined || maxSubagents < 2) {
      return yield* reviewError(
        "implementation-provider-unsupported",
        "The implementation provider does not advertise native subagent support.",
      );
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() =>
        reviewError("reviewer-unavailable", "The plan review model setting could not be loaded."),
      ),
    );
    const modelSelection = settings.parallelPlanReviewModelSelection;
    const reviewer = yield* providerInstanceRegistry.getInstance(modelSelection.instanceId);
    if (!reviewer?.enabled || !isPlanParallelismReviewDriverKind(reviewer.driverKind)) {
      return yield* reviewError(
        "reviewer-unavailable",
        "The selected provider cannot review plan parallelism.",
      );
    }

    const userRequest =
      plan.turnId === null
        ? undefined
        : thread.messages.find(
            (message) => message.role === "user" && message.turnId === plan.turnId,
          )?.text;
    const cwd = thread.worktreePath ?? projectOption.value.workspaceRoot;
    const generation = textGeneration
      .reviewPlanParallelism({
        cwd,
        planMarkdown: truncatePlanParallelismReviewContext(
          plan.planMarkdown,
          PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
        ),
        ...(userRequest === undefined
          ? {}
          : {
              userRequest: truncatePlanParallelismReviewContext(
                userRequest,
                PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
              ),
            }),
        maxSubagents,
        modelSelection,
      })
      .pipe(
        Effect.mapError(() =>
          reviewError("generation-failed", "The plan review model failed to generate a count."),
        ),
        Effect.timeoutOption(REVIEW_TIMEOUT),
      );
    const [elapsed, generationExit] = yield* generation.pipe(Effect.exit, Effect.timed);
    const durationMs = Duration.toMillis(elapsed);

    if (Exit.isFailure(generationExit)) {
      yield* Effect.logWarning("Plan parallelism review generation failed", {
        reviewerProvider: reviewer.driverKind,
        reviewerModel: modelSelection.model,
        durationMs,
        errorReason: "generation-failed",
      });
      return yield* Effect.failCause(generationExit.cause);
    }
    if (Option.isNone(generationExit.value)) {
      yield* Effect.logWarning("Plan parallelism review generation timed out", {
        reviewerProvider: reviewer.driverKind,
        reviewerModel: modelSelection.model,
        durationMs,
        errorReason: "timeout",
      });
      return yield* reviewError(
        "timeout",
        "The plan review model did not respond within 20 seconds.",
      );
    }

    const countSchema = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: maxSubagents }));
    const recommendedSubagents = yield* Schema.decodeUnknownEffect(countSchema)(
      generationExit.value.value.recommendedSubagents,
    ).pipe(
      Effect.mapError(() =>
        reviewError(
          "invalid-output",
          "The plan review model returned a count outside the provider capability.",
        ),
      ),
    );

    yield* Effect.logInfo("Plan parallelism review completed", {
      reviewerProvider: reviewer.driverKind,
      reviewerModel: modelSelection.model,
      durationMs,
      recommendedSubagents,
    });
    return {
      planId: plan.id,
      planUpdatedAt: plan.updatedAt,
      implementationProviderInstanceId: input.implementationProviderInstanceId,
      recommendedSubagents,
    } satisfies PlanParallelismReviewResult;
  });

  return PlanParallelismReview.of({ review });
});

export const layer = Layer.effect(PlanParallelismReview, make);
