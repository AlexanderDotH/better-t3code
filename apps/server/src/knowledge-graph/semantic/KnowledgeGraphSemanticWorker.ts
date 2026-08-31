import {
  type EnvironmentId,
  KnowledgeGraphSemanticFailureCategory,
  type KnowledgeGraphSemanticModelRequestV1,
  NonNegativeInt,
  type TextGenerationError,
  type KnowledgeGraphScopeId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  KnowledgeGraphRepository,
  type KnowledgeGraphRepositoryError,
} from "../persistence/KnowledgeGraphRepository.ts";
import {
  KnowledgeGraphSemanticQueueRepository,
  type KnowledgeGraphSemanticQueueRepositoryError,
} from "../persistence/KnowledgeGraphSemanticQueueRepository.ts";
import {
  buildKnowledgeGraphSemanticModelRequest,
  KNOWLEDGE_GRAPH_SEMANTIC_BATCH_SIZE,
} from "./KnowledgeGraphSemanticRequest.ts";
import {
  validateKnowledgeGraphSemanticOutput,
  type KnowledgeGraphSemanticValidationError,
} from "./KnowledgeGraphSemanticValidation.ts";

const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 60 * 1_000;

export class KnowledgeGraphSemanticModelError extends Schema.TaggedErrorClass<KnowledgeGraphSemanticModelError>()(
  "KnowledgeGraphSemanticModelError",
  {
    category: KnowledgeGraphSemanticFailureCategory,
    retryable: Schema.Boolean,
    retryAt: Schema.optional(NonNegativeInt),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class KnowledgeGraphSemanticWorkerError extends Schema.TaggedErrorClass<KnowledgeGraphSemanticWorkerError>()(
  "KnowledgeGraphSemanticWorkerError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Knowledge Graph semantic worker failed in ${this.operation}: ${this.detail}`;
  }
}

export function knowledgeGraphSemanticModelErrorFromTextGeneration(
  error: TextGenerationError,
): KnowledgeGraphSemanticModelError {
  const category = error.reason ?? "internal";
  return new KnowledgeGraphSemanticModelError({
    category,
    retryable: category === "rate-limited" || category === "internal",
    detail: error.detail,
    ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
    cause: error,
  });
}

export type KnowledgeGraphSemanticWorkerOutcome =
  | { readonly status: "idle"; readonly environmentId: EnvironmentId }
  | {
      readonly status: "committed";
      readonly environmentId: EnvironmentId;
      readonly scopeId: KnowledgeGraphScopeId;
      readonly revision: number;
      readonly processedJobCount: number;
    }
  | {
      readonly status: "requeued";
      readonly environmentId: EnvironmentId;
      readonly scopeId: KnowledgeGraphScopeId;
      readonly category: KnowledgeGraphSemanticFailureCategory;
      readonly retryAt: number;
      readonly paused: boolean;
    }
  | {
      readonly status: "rate-limited";
      readonly environmentId: EnvironmentId;
      readonly scopeId: KnowledgeGraphScopeId;
      readonly retryAt: number;
    };

export type KnowledgeGraphSemanticEnricher = (
  request: KnowledgeGraphSemanticModelRequestV1,
) => Effect.Effect<unknown, KnowledgeGraphSemanticModelError>;

export interface RunKnowledgeGraphSemanticBatchInput {
  readonly environmentId: EnvironmentId;
  readonly enrich: KnowledgeGraphSemanticEnricher;
  readonly now?: number;
}

export class KnowledgeGraphSemanticWorker extends Context.Service<
  KnowledgeGraphSemanticWorker,
  {
    readonly recover: Effect.Effect<void, KnowledgeGraphSemanticWorkerError>;
    readonly recoverEnvironment: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<void, KnowledgeGraphSemanticWorkerError>;
    readonly pauseEnvironment: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<void, KnowledgeGraphSemanticWorkerError>;
    readonly resumeEnvironment: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<void, KnowledgeGraphSemanticWorkerError>;
    readonly runNextBatch: (
      input: RunKnowledgeGraphSemanticBatchInput,
    ) => Effect.Effect<KnowledgeGraphSemanticWorkerOutcome, KnowledgeGraphSemanticWorkerError>;
  }
>()("t3/knowledge-graph/semantic/KnowledgeGraphSemanticWorker") {}

function workerError(
  operation: string,
  detail: string,
  cause: KnowledgeGraphSemanticQueueRepositoryError | KnowledgeGraphRepositoryError,
) {
  return new KnowledgeGraphSemanticWorkerError({ operation, detail, cause });
}

function retryAtFor(input: {
  readonly now: number;
  readonly attemptCount: number;
  readonly failure: KnowledgeGraphSemanticModelError;
}): number {
  if (input.failure.retryAt !== undefined) return input.failure.retryAt;
  if (input.failure.category === "rate-limited") {
    return input.now + DEFAULT_RATE_LIMIT_DELAY_MS;
  }
  const delay = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(10, input.attemptCount));
  return input.now + delay;
}

function invalidOutputFailure(
  cause: KnowledgeGraphSemanticValidationError,
): KnowledgeGraphSemanticModelError {
  return new KnowledgeGraphSemanticModelError({
    category: "invalid-output",
    retryable: true,
    detail: "The semantic model returned an invalid or stale graph relation set.",
    cause,
  });
}

const make = Effect.gen(function* () {
  const graph = yield* KnowledgeGraphRepository;
  const queue = yield* KnowledgeGraphSemanticQueueRepository;

  const recover = queue
    .recoverClaims()
    .pipe(
      Effect.mapError((cause) =>
        workerError("recover", "Interrupted semantic claims could not be recovered.", cause),
      ),
    );
  const recoverEnvironment = (environmentId: EnvironmentId) =>
    queue
      .recoverEnvironmentClaims(environmentId)
      .pipe(
        Effect.mapError((cause) =>
          workerError(
            "recover-environment",
            "Interrupted semantic claims for the environment could not be recovered.",
            cause,
          ),
        ),
      );
  const pauseEnvironment = (environmentId: EnvironmentId) =>
    queue
      .pauseEnvironment(environmentId)
      .pipe(
        Effect.mapError((cause) =>
          workerError("pause", "The semantic queue could not be paused.", cause),
        ),
      );
  const resumeEnvironment = (environmentId: EnvironmentId) =>
    queue
      .resumeEnvironment(environmentId)
      .pipe(
        Effect.mapError((cause) =>
          workerError("resume", "The semantic queue could not be resumed.", cause),
        ),
      );

  const runNextBatch = Effect.fn("KnowledgeGraphSemanticWorker.runNextBatch")(function* (
    input: RunKnowledgeGraphSemanticBatchInput,
  ) {
    const now = input.now ?? (yield* Clock.currentTimeMillis);
    const claimOption = yield* queue
      .claimNextBatch({
        environmentId: input.environmentId,
        limit: KNOWLEDGE_GRAPH_SEMANTIC_BATCH_SIZE,
        now,
      })
      .pipe(
        Effect.mapError((cause) =>
          workerError("claim", "The next semantic batch could not be claimed.", cause),
        ),
      );
    if (Option.isNone(claimOption)) {
      return {
        status: "idle",
        environmentId: input.environmentId,
      } satisfies KnowledgeGraphSemanticWorkerOutcome;
    }
    const claim = claimOption.value;
    const scopeId = claim.items[0].scopeId;
    const snapshotOption = yield* graph
      .getSnapshot(scopeId)
      .pipe(
        Effect.mapError((cause) =>
          workerError("snapshot", "The claimed graph snapshot could not be read.", cause),
        ),
      );
    if (Option.isNone(snapshotOption)) {
      yield* queue
        .cancelScope(scopeId)
        .pipe(
          Effect.mapError((cause) =>
            workerError(
              "discard-missing-scope",
              "A deleted graph scope claim could not be cleared.",
              cause,
            ),
          ),
        );
      return {
        status: "idle",
        environmentId: input.environmentId,
      } satisfies KnowledgeGraphSemanticWorkerOutcome;
    }
    const snapshot = snapshotOption.value;
    const requestResult = yield* buildKnowledgeGraphSemanticModelRequest({
      claim,
      snapshot,
    }).pipe(Effect.result);

    const releaseFailure = Effect.fn("KnowledgeGraphSemanticWorker.releaseFailure")(function* (
      failure: KnowledgeGraphSemanticModelError,
    ) {
      const retryAt = retryAtFor({
        now,
        attemptCount: Math.max(...claim.items.map(({ attemptCount }) => attemptCount)),
        failure,
      });
      yield* queue
        .releaseClaim({
          claim,
          availableAt: retryAt,
          failure: {
            category: failure.category,
            retryable: failure.retryable,
            detail: failure.detail,
            ...(failure.retryAt === undefined ? {} : { retryAt: failure.retryAt }),
          },
        })
        .pipe(
          Effect.mapError((cause) =>
            workerError("release", "The semantic claim could not be returned to its queue.", cause),
          ),
        );
      const paused = failure.category === "model-unavailable" || failure.category === "entitlement";
      if (paused) yield* pauseEnvironment(input.environmentId);
      if (failure.category === "rate-limited") {
        return {
          status: "rate-limited",
          environmentId: input.environmentId,
          scopeId,
          retryAt,
        } satisfies KnowledgeGraphSemanticWorkerOutcome;
      }
      return {
        status: "requeued",
        environmentId: input.environmentId,
        scopeId,
        category: failure.category,
        retryAt,
        paused,
      } satisfies KnowledgeGraphSemanticWorkerOutcome;
    });

    if (Result.isFailure(requestResult)) {
      return yield* releaseFailure(invalidOutputFailure(requestResult.failure));
    }
    const modelResult = yield* input.enrich(requestResult.success).pipe(Effect.result);
    if (Result.isFailure(modelResult)) return yield* releaseFailure(modelResult.failure);

    const patchResult = yield* validateKnowledgeGraphSemanticOutput({
      claim,
      snapshot,
      output: modelResult.success,
      committedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
    }).pipe(Effect.result);
    if (Result.isFailure(patchResult)) {
      return yield* releaseFailure(invalidOutputFailure(patchResult.failure));
    }

    const commitResult = yield* queue
      .commitClaimExpected({
        claim,
        semanticPatch: patchResult.success,
        commit: graph.applySemanticPatch(patchResult.success),
      })
      .pipe(
        Effect.mapError((cause) =>
          workerError(
            "complete",
            "The validated semantic claim could not be committed atomically.",
            cause,
          ),
        ),
      );
    if (commitResult.status === "stale") {
      return {
        status: "requeued",
        environmentId: input.environmentId,
        scopeId,
        category: "cancelled",
        retryAt: now,
        paused: false,
      } satisfies KnowledgeGraphSemanticWorkerOutcome;
    }
    if (commitResult.status === "commit-failed") {
      const failure = new KnowledgeGraphSemanticModelError({
        category: "internal",
        retryable: true,
        detail: "The graph changed before semantic enrichment could be committed.",
        cause: commitResult.cause,
      });
      const outcome = yield* releaseFailure(failure);
      if (commitResult.cause.reason === "revision-conflict") return outcome;
      return yield* workerError(
        "commit",
        "The semantic graph patch could not be committed.",
        commitResult.cause,
      );
    }
    return {
      status: "committed",
      environmentId: input.environmentId,
      scopeId,
      revision: commitResult.value.revision,
      processedJobCount: claim.items.length,
    } satisfies KnowledgeGraphSemanticWorkerOutcome;
  });

  return KnowledgeGraphSemanticWorker.of({
    recover,
    recoverEnvironment,
    pauseEnvironment,
    resumeEnvironment,
    runNextBatch,
  });
});

export const KnowledgeGraphSemanticWorkerLive = Layer.effect(KnowledgeGraphSemanticWorker, make);
