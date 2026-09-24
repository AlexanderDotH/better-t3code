// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { validateKnowledgeJobSource } from "./KnowledgeJobSource.ts";
import { boundedPageSize, readKnowledgeRevision } from "./KnowledgeReads.ts";
import { putKnowledgeBatch } from "./KnowledgeRecords.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";
import type {
  KnowledgeBatch,
  KnowledgeJob,
  KnowledgeJobInput,
  KnowledgeJobKind,
  KnowledgeJobState,
  KnowledgeWriteGuard,
} from "./KnowledgeStoreTypes.ts";

const JOB_COLUMNS = `revision, id, idempotency_key AS idempotencyKey, kind, file_path AS filePath, content_hash AS contentHash, entity_id AS entityId, input_json AS inputJson, state, attempts, detail, claim_token AS claimToken, updated_at AS updatedAt`;

export type GuardWrite = <A, E>(
  input: KnowledgeWriteGuard,
  effect: Effect.Effect<A, E>,
) => Effect.Effect<A, KnowledgeStoreError>;

export function makeKnowledgeJobs(
  sql: SqlClient.SqlClient,
  workspaceRoot: string,
  guardWrite: GuardWrite,
) {
  const enqueueJobs = Effect.fn("KnowledgeStore.enqueueJobs")(
    function* (input: KnowledgeWriteGuard & { readonly jobs: ReadonlyArray<KnowledgeJobInput> }) {
      return yield* guardWrite(
        input,
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          for (const job of input.jobs) {
            if (
              (job.filePath !== "" && !isSafeProjectSourcePath(job.filePath)) ||
              job.inputJson.length > 1_048_576
            )
              return yield* new KnowledgeStoreError({
                code: "invalid-job",
                detail: "Indexing job input is outside the supported source or size limits.",
              });
            yield* sql`INSERT INTO knowledge_jobs(revision, id, idempotency_key, kind, file_path, content_hash, entity_id, input_json, updated_at)
          VALUES (${input.revision}, ${job.id}, ${job.idempotencyKey}, ${job.kind}, ${job.filePath}, ${job.contentHash}, ${job.entityId ?? null}, ${job.inputJson}, ${now})
          ON CONFLICT(revision, idempotency_key) DO UPDATE SET state = CASE WHEN knowledge_jobs.attempts >= 3 THEN 'failed' ELSE 'pending' END, detail = NULL, claim_token = NULL, claim_lease_token = NULL, updated_at = excluded.updated_at
          WHERE knowledge_jobs.state = 'cancelled' AND knowledge_jobs.content_hash = excluded.content_hash`;
          }
        }),
      );
    },
    Effect.mapError(asStoreError("enqueue jobs")),
  );

  const listJobs = Effect.fn("KnowledgeStore.listJobs")(
    function* (input: {
      readonly revision: number;
      readonly state?: KnowledgeJobState;
      readonly kind?: KnowledgeJobKind;
      readonly kinds?: ReadonlyArray<KnowledgeJobKind>;
      readonly limit?: number;
      readonly afterId?: string;
    }) {
      yield* readKnowledgeRevision(sql, input.revision);
      const limit = boundedPageSize(input.limit);
      const filters = ["revision = ?", "id > ?"];
      const parameters: Array<string | number> = [input.revision, input.afterId ?? ""];
      if (input.state) {
        filters.push("state = ?");
        parameters.push(input.state);
      }
      if (input.kind) {
        filters.push("kind = ?");
        parameters.push(input.kind);
      }
      if (input.kinds !== undefined) {
        if (input.kinds.length === 0)
          return { revision: input.revision, items: [], nextCursor: null };
        if (input.kinds.length > 8)
          return yield* new KnowledgeStoreError({
            code: "query-limit",
            detail: "A job query accepts at most eight kinds.",
          });
        filters.push(`kind IN (${input.kinds.map(() => "?").join(",")})`);
        parameters.push(...input.kinds);
      }
      parameters.push(limit + 1);
      const rows = yield* sql.unsafe<
        Omit<KnowledgeJob, "entityId"> & { readonly entityId: string | null }
      >(
        `SELECT ${JOB_COLUMNS} FROM knowledge_jobs WHERE ${filters.join(" AND ")} ORDER BY id LIMIT ?`,
        parameters,
      );
      const items = rows
        .slice(0, limit)
        .map(({ entityId, ...row }) => ({ ...row, ...(entityId === null ? {} : { entityId }) }));
      return {
        items,
        revision: input.revision,
        nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
      };
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("list jobs")),
  );

  const claimJobs = Effect.fn("KnowledgeStore.claimJobs")(
    function* (
      input: KnowledgeWriteGuard & {
        readonly kind?: KnowledgeJobKind;
        readonly kinds?: ReadonlyArray<KnowledgeJobKind>;
        readonly limit?: number;
      },
    ) {
      return yield* guardWrite(
        input,
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE knowledge_jobs SET state = 'failed', detail = 'Maximum indexing attempts reached', updated_at = ${now} WHERE revision = ${input.revision} AND state = 'pending' AND attempts >= 3`;
          const page = yield* listJobs({
            revision: input.revision,
            state: "pending",
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.kinds ? { kinds: input.kinds } : {}),
            limit: boundedPageSize(input.limit, 32),
          });
          const jobs: Array<KnowledgeJob & { readonly claimToken: string }> = [];
          for (const job of page.items) {
            const claimToken = NodeCrypto.randomBytes(16).toString("hex");
            yield* sql`UPDATE knowledge_jobs SET state = 'running', attempts = attempts + 1, claim_token = ${claimToken}, claim_lease_token = ${input.lease.token}, updated_at = ${now} WHERE revision = ${input.revision} AND id = ${job.id} AND state = 'pending'`;
            jobs.push({
              ...job,
              state: "running",
              attempts: job.attempts + 1,
              claimToken,
              updatedAt: now,
            });
          }
          return jobs;
        }),
      );
    },
    Effect.mapError(asStoreError("claim jobs")),
  );

  const completeJob = Effect.fn("KnowledgeStore.completeJob")(
    function* (
      input: KnowledgeWriteGuard & {
        readonly jobId: string;
        readonly claimToken: string;
        readonly batch?: KnowledgeBatch;
      },
    ) {
      return yield* guardWrite(
        input,
        Effect.gen(function* () {
          const rows = yield* sql.unsafe<
            KnowledgeJob & { readonly claim_lease_token: string | null }
          >(
            `SELECT ${JOB_COLUMNS}, claim_lease_token FROM knowledge_jobs WHERE revision = ? AND id = ?`,
            [input.revision, input.jobId],
          );
          const job = rows[0];
          if (job?.state === "completed" && job.claimToken === input.claimToken) return;
          if (
            !job ||
            job.state !== "running" ||
            job.claimToken !== input.claimToken ||
            job.claim_lease_token !== input.lease.token
          )
            return yield* new KnowledgeStoreError({
              code: "job-conflict",
              detail: "This indexing job is no longer owned by the worker.",
            });
          yield* validateKnowledgeJobSource(workspaceRoot, job);
          yield* putKnowledgeBatch(sql, input.revision, input.batch ?? {});
          const now = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE knowledge_jobs SET state = 'completed', claim_lease_token = NULL, detail = NULL, updated_at = ${now} WHERE revision = ${input.revision} AND id = ${input.jobId}`;
        }),
      );
    },
    Effect.mapError(asStoreError("complete job")),
  );

  const failJob = Effect.fn("KnowledgeStore.failJob")(
    function* (
      input: KnowledgeWriteGuard & {
        readonly jobId: string;
        readonly claimToken: string;
        readonly retryable: boolean;
        readonly detail: string;
        readonly maxAttempts?: number;
      },
    ) {
      return yield* guardWrite(
        input,
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const bound = Math.max(1, Math.min(3, input.maxAttempts ?? 3));
          const rows = yield* sql<{
            state: KnowledgeJobState;
          }>`UPDATE knowledge_jobs SET state = CASE WHEN ${input.retryable ? 1 : 0} = 1 AND attempts < ${bound} THEN 'pending' ELSE 'failed' END, detail = ${input.detail.slice(0, 16000)}, claim_token = NULL, claim_lease_token = NULL, updated_at = ${now} WHERE revision = ${input.revision} AND id = ${input.jobId} AND state = 'running' AND claim_token = ${input.claimToken} AND claim_lease_token = ${input.lease.token} RETURNING state`;
          if (!rows[0])
            return yield* new KnowledgeStoreError({
              code: "job-conflict",
              detail: "This indexing job is no longer owned by the worker.",
            });
          return rows[0].state;
        }),
      );
    },
    Effect.mapError(asStoreError("fail job")),
  );

  const recoverJobs = Effect.fn("KnowledgeStore.recoverJobs")(
    function* (input: KnowledgeWriteGuard) {
      return yield* guardWrite(
        input,
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE knowledge_jobs SET state = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, claim_token = NULL, claim_lease_token = NULL, detail = 'Worker interrupted before completing this unit', updated_at = ${now} WHERE revision = ${input.revision} AND state = 'running' AND (claim_lease_token IS NULL OR claim_lease_token <> ${input.lease.token})`;
        }),
      );
    },
    Effect.mapError(asStoreError("recover jobs")),
  );

  const getJobsSummary = Effect.fn("KnowledgeStore.getJobsSummary")(
    function* (revision: number) {
      yield* readKnowledgeRevision(sql, revision);
      return yield* sql<{
        kind: KnowledgeJobKind;
        state: KnowledgeJobState;
        count: number;
        attempts: number;
      }>`SELECT kind, state, COUNT(*) AS count, SUM(attempts) AS attempts FROM knowledge_jobs WHERE revision = ${revision} GROUP BY kind, state`;
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("count jobs")),
  );

  return { enqueueJobs, listJobs, claimJobs, completeJob, failJob, recoverJobs, getJobsSummary };
}
