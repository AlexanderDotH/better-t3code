import {
  type EnvironmentId,
  KnowledgeGraphClaimToken,
  KnowledgeGraphSemanticCandidateV1,
  type KnowledgeGraphSemanticClaimCompletionV1,
  type KnowledgeGraphSemanticClaimV1,
  type KnowledgeGraphSemanticEnqueueV1,
  type KnowledgeGraphSemanticFailureV1,
  type KnowledgeGraphSemanticQueueItemV1,
  type KnowledgeGraphScopeId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export class KnowledgeGraphSemanticQueueRepositoryError extends Schema.TaggedErrorClass<KnowledgeGraphSemanticQueueRepositoryError>()(
  "KnowledgeGraphSemanticQueueRepositoryError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Knowledge Graph semantic queue failed in ${this.operation}.`;
  }
}

export interface KnowledgeGraphSemanticQueueStatus {
  readonly environmentId: EnvironmentId;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly paused: boolean;
  readonly rateLimitedUntil: number | null;
}

export type KnowledgeGraphClaimCompletionStatus = "committed" | "stale";

export type KnowledgeGraphClaimCommitResult<A, E> =
  | { readonly status: "committed"; readonly value: A }
  | { readonly status: "stale" }
  | { readonly status: "commit-failed"; readonly cause: E };

export interface KnowledgeGraphSemanticQueueRepositoryShape {
  readonly enqueueChangedNodes: (
    input: KnowledgeGraphSemanticEnqueueV1,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly claimNextBatch: (input: {
    readonly environmentId: EnvironmentId;
    readonly limit: number;
    readonly now?: number;
  }) => Effect.Effect<
    Option.Option<KnowledgeGraphSemanticClaimV1>,
    KnowledgeGraphSemanticQueueRepositoryError
  >;
  readonly completeClaimExpected: (
    input: KnowledgeGraphSemanticClaimCompletionV1,
  ) => Effect.Effect<
    KnowledgeGraphClaimCompletionStatus,
    KnowledgeGraphSemanticQueueRepositoryError
  >;
  readonly commitClaimExpected: <A, E, R>(input: {
    readonly claim: KnowledgeGraphSemanticClaimV1;
    readonly semanticPatch: KnowledgeGraphSemanticClaimCompletionV1["semanticPatch"];
    readonly commit: Effect.Effect<A, E, R>;
  }) => Effect.Effect<
    KnowledgeGraphClaimCommitResult<A, E>,
    KnowledgeGraphSemanticQueueRepositoryError,
    R
  >;
  readonly releaseClaim: (input: {
    readonly claim: KnowledgeGraphSemanticClaimV1;
    readonly availableAt?: number;
    readonly failure?: KnowledgeGraphSemanticFailureV1;
  }) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly recoverClaims: () => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly recoverEnvironmentClaims: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly pauseEnvironment: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly resumeEnvironment: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly cancelScope: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly clearScope: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<void, KnowledgeGraphSemanticQueueRepositoryError>;
  readonly getStatus: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<KnowledgeGraphSemanticQueueStatus, KnowledgeGraphSemanticQueueRepositoryError>;
}

export class KnowledgeGraphSemanticQueueRepository extends Context.Service<
  KnowledgeGraphSemanticQueueRepository,
  KnowledgeGraphSemanticQueueRepositoryShape
>()("t3/knowledge-graph/persistence/KnowledgeGraphSemanticQueueRepository") {}

interface QueueRow {
  readonly jobId: string;
  readonly environmentId: string;
  readonly scopeId: string;
  readonly nodeId: string;
  readonly desiredNodeRevision: number;
  readonly modelGeneration: number;
  readonly candidatesJson: string;
  readonly attemptCount: number;
  readonly availableAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const CandidateList = Schema.Array(KnowledgeGraphSemanticCandidateV1);
const decodeCandidateList = Schema.decodeUnknownEffect(Schema.fromJsonString(CandidateList));
const encodeCandidateList = Schema.encodeSync(Schema.fromJsonString(CandidateList));

const queueError = (operation: string) =>
  Effect.mapError(
    (cause: unknown) => new KnowledgeGraphSemanticQueueRepositoryError({ operation, cause }),
  );

const decodeCandidates = (json: string) =>
  decodeCandidateList(json).pipe(
    Effect.mapError(
      (cause) =>
        new KnowledgeGraphSemanticQueueRepositoryError({
          operation: "decode-candidates",
          cause,
        }),
    ),
  );

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const enqueueChangedNodes = (input: KnowledgeGraphSemanticEnqueueV1) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.forEach(
        input.nodes,
        (node) => {
          const jobId = `${input.scopeId}:${node.nodeId}`;
          return sql`
            INSERT INTO knowledge_graph_semantic_queue (
              job_id, environment_id, scope_id, node_id, desired_node_revision,
              model_generation, status, claim_token, claimed_at, available_at,
              attempt_count, candidates_json, failure_category, created_at, updated_at
            ) VALUES (
              ${jobId}, ${input.environmentId}, ${input.scopeId}, ${node.nodeId},
              ${node.nodeRevision}, ${input.modelGeneration}, 'queued', NULL, NULL,
              ${now}, 0, ${encodeCandidateList(node.candidates)}, NULL, ${now}, ${now}
            ) ON CONFLICT (scope_id, node_id) DO UPDATE SET
              environment_id = excluded.environment_id,
              desired_node_revision = excluded.desired_node_revision,
              model_generation = excluded.model_generation,
              status = CASE
                WHEN knowledge_graph_semantic_queue.status = 'running' THEN 'running'
                ELSE 'queued'
              END,
              claim_token = CASE
                WHEN knowledge_graph_semantic_queue.status = 'running'
                  THEN knowledge_graph_semantic_queue.claim_token
                ELSE NULL
              END,
              claimed_at = CASE
                WHEN knowledge_graph_semantic_queue.status = 'running'
                  THEN knowledge_graph_semantic_queue.claimed_at
                ELSE NULL
              END,
              available_at = excluded.available_at,
              candidates_json = excluded.candidates_json,
              failure_category = NULL,
              updated_at = excluded.updated_at
          `;
        },
        { discard: true },
      );
    }).pipe(queueError("enqueue-changed-nodes"));

  const environmentPaused = (environmentId: EnvironmentId, now: number) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly paused: number;
        readonly rateLimitedUntil: number | null;
      }>`
        SELECT paused, rate_limited_until AS "rateLimitedUntil"
        FROM knowledge_graph_semantic_environments
        WHERE environment_id = ${environmentId}
      `;
      const row = rows[0];
      return row?.paused === 1 || (row?.rateLimitedUntil ?? 0) > now;
    });

  const fromRow = (row: QueueRow, candidates: typeof CandidateList.Type) =>
    ({
      version: 1,
      jobId: row.jobId,
      environmentId: row.environmentId,
      scopeId: row.scopeId,
      nodeId: row.nodeId,
      desiredNodeRevision: row.desiredNodeRevision,
      modelGeneration: row.modelGeneration,
      candidates,
      attemptCount: row.attemptCount,
      availableAt: row.availableAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }) as KnowledgeGraphSemanticQueueItemV1;

  const claimNextBatch = (input: {
    readonly environmentId: EnvironmentId;
    readonly limit: number;
    readonly now?: number;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const now = input.now ?? (yield* Clock.currentTimeMillis);
          if (yield* environmentPaused(input.environmentId, now)) {
            return Option.none<KnowledgeGraphSemanticClaimV1>();
          }
          yield* sql`
            UPDATE knowledge_graph_semantic_environments SET
              rate_limited_until = NULL,
              updated_at = ${now}
            WHERE environment_id = ${input.environmentId}
              AND rate_limited_until IS NOT NULL
              AND rate_limited_until <= ${now}
          `;
          const running = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count
          FROM knowledge_graph_semantic_queue
          WHERE environment_id = ${input.environmentId} AND status = 'running'
        `;
          if ((running[0]?.count ?? 0) > 0) return Option.none<KnowledgeGraphSemanticClaimV1>();

          const limit = Math.max(1, Math.min(64, Math.floor(input.limit)));
          const anchorRows = yield* sql.unsafe<QueueRow>(
            `SELECT
             job_id AS "jobId",
             environment_id AS "environmentId",
             scope_id AS "scopeId",
             node_id AS "nodeId",
             desired_node_revision AS "desiredNodeRevision",
             model_generation AS "modelGeneration",
             candidates_json AS "candidatesJson",
             attempt_count AS "attemptCount",
             available_at AS "availableAt",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
           FROM knowledge_graph_semantic_queue
           WHERE environment_id = ? AND status = 'queued' AND available_at <= ?
           ORDER BY available_at, updated_at, job_id
           LIMIT 1`,
            [input.environmentId, now],
          );
          const first = anchorRows[0];
          if (first === undefined) return Option.none<KnowledgeGraphSemanticClaimV1>();
          const rows = yield* sql.unsafe<QueueRow>(
            `SELECT
             job_id AS "jobId",
             environment_id AS "environmentId",
             scope_id AS "scopeId",
             node_id AS "nodeId",
             desired_node_revision AS "desiredNodeRevision",
             model_generation AS "modelGeneration",
             candidates_json AS "candidatesJson",
             attempt_count AS "attemptCount",
             available_at AS "availableAt",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
           FROM knowledge_graph_semantic_queue
           WHERE environment_id = ? AND scope_id = ? AND model_generation = ?
             AND status = 'queued' AND available_at <= ?
           ORDER BY available_at, updated_at, job_id
           LIMIT ?`,
            [input.environmentId, first.scopeId, first.modelGeneration, now, limit],
          );
          const claimToken = `${input.environmentId}:${now}:${first.jobId}`;
          yield* Effect.forEach(
            rows,
            (row) => sql`
            UPDATE knowledge_graph_semantic_queue SET
              status = 'running',
              claim_token = ${claimToken},
              claimed_at = ${now},
              updated_at = ${now}
            WHERE job_id = ${row.jobId} AND status = 'queued'
          `,
            { discard: true },
          );
          const items = yield* Effect.forEach(rows, (row) =>
            decodeCandidates(row.candidatesJson).pipe(
              Effect.map((candidates) => fromRow(row, candidates)),
            ),
          );
          const [firstItem, ...remainingItems] = items;
          if (firstItem === undefined) return Option.none<KnowledgeGraphSemanticClaimV1>();
          const claim: KnowledgeGraphSemanticClaimV1 = {
            version: 1 as const,
            claimToken: KnowledgeGraphClaimToken.make(claimToken),
            environmentId: input.environmentId,
            claimedAt: now,
            items: [firstItem, ...remainingItems],
          };
          return Option.some(claim);
        }),
      )
      .pipe(queueError("claim-next-batch"));

  const claimState = (input: KnowledgeGraphSemanticClaimCompletionV1) =>
    Effect.gen(function* () {
      let superseded = false;
      for (const item of input.claim.items) {
        const rows = yield* sql<{
          readonly desiredNodeRevision: number;
          readonly modelGeneration: number;
          readonly claimToken: string | null;
          readonly status: string;
        }>`
          SELECT
            desired_node_revision AS "desiredNodeRevision",
            model_generation AS "modelGeneration",
            claim_token AS "claimToken",
            status
          FROM knowledge_graph_semantic_queue
          WHERE job_id = ${item.jobId}
        `;
        const row = rows[0];
        if (
          row === undefined ||
          row.status !== "running" ||
          row.claimToken !== input.claim.claimToken ||
          item.scopeId !== input.semanticPatch.scopeId
        ) {
          return "lost" as const;
        }
        if (
          row.desiredNodeRevision !== item.desiredNodeRevision ||
          row.modelGeneration !== input.semanticPatch.modelGeneration
        ) {
          superseded = true;
        }
      }
      return superseded ? ("superseded" as const) : ("current" as const);
    });

  const requeueSupersededClaim = (claim: KnowledgeGraphSemanticClaimV1) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE knowledge_graph_semantic_queue SET
          status = 'queued',
          claim_token = NULL,
          claimed_at = NULL,
          updated_at = ${now}
        WHERE claim_token = ${claim.claimToken}
      `;
    });

  const commitClaimExpected = <A, E, R>(input: {
    readonly claim: KnowledgeGraphSemanticClaimV1;
    readonly semanticPatch: KnowledgeGraphSemanticClaimCompletionV1["semanticPatch"];
    readonly commit: Effect.Effect<A, E, R>;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE knowledge_graph_semantic_queue
            SET updated_at = updated_at
            WHERE claim_token = ${input.claim.claimToken}
          `;
          const state = yield* claimState({
            version: 1,
            claim: input.claim,
            semanticPatch: input.semanticPatch,
          });
          if (state === "lost") {
            return { status: "stale" } as const;
          }
          if (state === "superseded") {
            yield* requeueSupersededClaim(input.claim);
            return { status: "stale" } as const;
          }
          const committed = yield* input.commit.pipe(Effect.result);
          if (Result.isFailure(committed)) {
            return { status: "commit-failed", cause: committed.failure } as const;
          }
          yield* Effect.forEach(
            input.claim.items,
            (item) => sql`
            DELETE FROM knowledge_graph_semantic_queue
            WHERE job_id = ${item.jobId} AND claim_token = ${input.claim.claimToken}
          `,
            { discard: true },
          );
          return { status: "committed", value: committed.success } as const;
        }),
      )
      .pipe(queueError("commit-claim-expected"));

  const completeClaimExpected = (input: KnowledgeGraphSemanticClaimCompletionV1) =>
    commitClaimExpected({ ...input, commit: Effect.void }).pipe(
      Effect.map(
        (result): KnowledgeGraphClaimCompletionStatus =>
          result.status === "committed" ? "committed" : "stale",
      ),
    );

  const releaseClaim = (input: {
    readonly claim: KnowledgeGraphSemanticClaimV1;
    readonly availableAt?: number;
    readonly failure?: KnowledgeGraphSemanticFailureV1;
  }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const availableAt = input.availableAt ?? input.failure?.retryAt ?? now;
      yield* Effect.forEach(
        input.claim.items,
        (item) => sql`
          UPDATE knowledge_graph_semantic_queue SET
            status = 'queued',
            claim_token = NULL,
            claimed_at = NULL,
            available_at = ${availableAt},
            attempt_count = attempt_count + 1,
            failure_category = ${input.failure?.category ?? null},
            updated_at = ${now}
          WHERE job_id = ${item.jobId} AND claim_token = ${input.claim.claimToken}
        `,
        { discard: true },
      );
      if (input.failure?.category === "rate-limited") {
        yield* sql`
          INSERT INTO knowledge_graph_semantic_environments (
            environment_id, paused, rate_limited_until, updated_at
          ) VALUES (${input.claim.environmentId}, 0, ${availableAt}, ${now})
          ON CONFLICT (environment_id) DO UPDATE SET
            rate_limited_until = excluded.rate_limited_until,
            updated_at = excluded.updated_at
        `;
      }
    }).pipe(queueError("release-claim"));

  const recoverClaims = () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE knowledge_graph_semantic_queue SET
          status = 'queued',
          claim_token = NULL,
          claimed_at = NULL,
          updated_at = ${now}
        WHERE status = 'running'
      `;
    }).pipe(queueError("recover-claims"));

  const recoverEnvironmentClaims = (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE knowledge_graph_semantic_queue SET
          status = 'queued',
          claim_token = NULL,
          claimed_at = NULL,
          updated_at = ${now}
        WHERE environment_id = ${environmentId} AND status = 'running'
      `;
    }).pipe(queueError("recover-environment-claims"));

  const setEnvironmentPaused = (environmentId: EnvironmentId, paused: boolean) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (paused) {
            yield* sql`
          INSERT INTO knowledge_graph_semantic_environments (
            environment_id, paused, rate_limited_until, updated_at
          ) VALUES (${environmentId}, 1, NULL, ${now})
          ON CONFLICT (environment_id) DO UPDATE SET
            paused = 1,
            updated_at = excluded.updated_at
        `;
            yield* sql`
          UPDATE knowledge_graph_semantic_queue SET
            status = 'queued',
            claim_token = NULL,
            claimed_at = NULL,
            updated_at = ${now}
          WHERE environment_id = ${environmentId} AND status = 'running'
        `;
            return;
          }
          yield* sql`
        INSERT INTO knowledge_graph_semantic_environments (
          environment_id, paused, rate_limited_until, updated_at
        ) VALUES (${environmentId}, 0, NULL, ${now})
        ON CONFLICT (environment_id) DO UPDATE SET
          paused = 0,
          rate_limited_until = NULL,
          updated_at = excluded.updated_at
      `;
        }),
      )
      .pipe(queueError(paused ? "pause-environment" : "resume-environment"));

  const cancelScope = (scopeId: KnowledgeGraphScopeId) =>
    sql`DELETE FROM knowledge_graph_semantic_queue WHERE scope_id = ${scopeId}`.pipe(
      Effect.asVoid,
      queueError("cancel-scope"),
    );

  const getStatus = (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const [counts, environment] = yield* Effect.all([
        sql<{ readonly status: string; readonly count: number }>`
          SELECT status, count(*) AS count
          FROM knowledge_graph_semantic_queue
          WHERE environment_id = ${environmentId}
          GROUP BY status
        `,
        sql<{ readonly paused: number; readonly rateLimitedUntil: number | null }>`
          SELECT paused, rate_limited_until AS "rateLimitedUntil"
          FROM knowledge_graph_semantic_environments
          WHERE environment_id = ${environmentId}
        `,
      ]);
      const count = (status: string) => counts.find((row) => row.status === status)?.count ?? 0;
      return {
        environmentId,
        queuedCount: count("queued") + count("paused"),
        runningCount: count("running"),
        paused: environment[0]?.paused === 1,
        rateLimitedUntil: environment[0]?.rateLimitedUntil ?? null,
      };
    }).pipe(queueError("get-status"));

  return {
    enqueueChangedNodes,
    claimNextBatch,
    completeClaimExpected,
    commitClaimExpected,
    releaseClaim,
    recoverClaims,
    recoverEnvironmentClaims,
    pauseEnvironment: (environmentId) => setEnvironmentPaused(environmentId, true),
    resumeEnvironment: (environmentId) => setEnvironmentPaused(environmentId, false),
    cancelScope,
    clearScope: cancelScope,
    getStatus,
  } satisfies KnowledgeGraphSemanticQueueRepositoryShape;
});

export const KnowledgeGraphSemanticQueueRepositoryLive = Layer.effect(
  KnowledgeGraphSemanticQueueRepository,
  make,
);
