import type { RocksDatabase, Transaction } from "@harperfast/rocksdb-js";

import { kvKey, kvPrefix, scanKvPrefix } from "../../knowledge/KvKeys.ts";
import type { KnowledgeJob, KnowledgeJobKind, KnowledgeJobState } from "./KnowledgeStoreTypes.ts";

export type StoredKnowledgeJob = KnowledgeJob & { readonly claimLeaseToken: string | null };

interface JobSummary {
  readonly kind: KnowledgeJobKind;
  readonly state: KnowledgeJobState;
  readonly count: number;
  readonly attempts: number;
}

const INDEX_VERSION_KEY = kvKey("job-index-version");
const INDEX_PREFIXES = ["job-state", "job-kind-state", "job-file", "job-summary"];
const indexPreparations = new WeakMap<RocksDatabase, Promise<void>>();
export const knowledgeJobKey = (id: string) => kvKey("job", id);

const indexKeys = (job: StoredKnowledgeJob) => [
  kvKey("job-state", job.state, job.id),
  kvKey("job-kind-state", job.kind, job.state, job.id),
  kvKey("job-file", job.filePath, job.id),
];

async function updateSummary(transaction: Transaction, job: StoredKnowledgeJob, delta: number) {
  const key = kvKey("job-summary", job.kind, job.state);
  const previous = (await transaction.get(key)) as JobSummary | undefined;
  const count = (previous?.count ?? 0) + delta;
  const attempts = (previous?.attempts ?? 0) + delta * job.attempts;
  if (count < 0 || attempts < 0) throw new Error("Invalid project indexing job counters.");
  if (count === 0) await transaction.remove(key);
  else await transaction.put(key, { kind: job.kind, state: job.state, count, attempts });
}

export async function putKnowledgeJob(transaction: Transaction, job: StoredKnowledgeJob) {
  const previous = (await transaction.get(knowledgeJobKey(job.id))) as
    | StoredKnowledgeJob
    | undefined;
  if (previous) {
    for (const key of indexKeys(previous)) await transaction.remove(key);
    await updateSummary(transaction, previous, -1);
  }
  await transaction.put(knowledgeJobKey(job.id), job);
  for (const key of indexKeys(job)) await transaction.put(key, job.id);
  await updateSummary(transaction, job, 1);
}

/** Upgrade derived queue indexes once, preserving work paused by earlier builds. */
async function buildKnowledgeJobIndexes(database: RocksDatabase) {
  if ((await database.get(INDEX_VERSION_KEY)) === 1) return;
  await database.transaction(async (transaction) => {
    for (const prefix of INDEX_PREFIXES)
      for await (const { key } of scanKvPrefix(transaction, prefix)) await transaction.remove(key);
    for await (const { value } of scanKvPrefix(transaction, "job")) {
      const job = value as StoredKnowledgeJob;
      for (const key of indexKeys(job)) await transaction.put(key, job.id);
      await updateSummary(transaction, job, 1);
    }
    await transaction.put(INDEX_VERSION_KEY, 1);
  });
}

export function ensureKnowledgeJobIndexes(database: RocksDatabase): Promise<void> {
  const existing = indexPreparations.get(database);
  if (existing) return existing;
  const preparation = buildKnowledgeJobIndexes(database);
  indexPreparations.set(database, preparation);
  void preparation.catch(() => indexPreparations.delete(database));
  return preparation;
}

export async function clearKnowledgeJobs(database: RocksDatabase) {
  await database.transaction(async (transaction) => {
    for (const prefix of ["job", "job-idempotency", ...INDEX_PREFIXES])
      for await (const { key } of scanKvPrefix(transaction, prefix)) await transaction.remove(key);
    await transaction.put(INDEX_VERSION_KEY, 1);
  });
}

export async function* scanKnowledgeJobs(
  database: RocksDatabase | Transaction,
  query: {
    readonly state?: KnowledgeJobState;
    readonly kind?: KnowledgeJobKind;
    readonly filePath?: string;
    readonly afterId?: string;
  } = {},
): AsyncGenerator<StoredKnowledgeJob> {
  const indexed = (await database.get(INDEX_VERSION_KEY)) === 1;
  const prefix = !indexed
    ? ["job"]
    : query.filePath !== undefined
      ? ["job-file", query.filePath]
      : query.state && query.kind
        ? ["job-kind-state", query.kind, query.state]
        : query.state
          ? ["job-state", query.state]
          : ["job"];
  const range = kvPrefix(...prefix);
  for await (const { value } of database.getRange({
    ...range,
    ...(query.afterId === undefined ? {} : { start: kvKey(...prefix, query.afterId) }),
  })) {
    const job = (
      prefix[0] === "job" ? value : await database.get(knowledgeJobKey(String(value)))
    ) as StoredKnowledgeJob | undefined;
    if (
      job &&
      (query.afterId === undefined || job.id > query.afterId) &&
      (query.state === undefined || job.state === query.state) &&
      (query.kind === undefined || job.kind === query.kind) &&
      (query.filePath === undefined || job.filePath === query.filePath)
    )
      yield job;
  }
}

export async function summarizeKnowledgeJobs(database: RocksDatabase): Promise<JobSummary[]> {
  if ((await database.get(INDEX_VERSION_KEY)) === 1) {
    const summaries: JobSummary[] = [];
    for await (const { value } of scanKvPrefix(database, "job-summary"))
      summaries.push(value as JobSummary);
    return summaries;
  }
  const summaries = new Map<string, JobSummary>();
  for await (const job of scanKnowledgeJobs(database)) {
    const key = kvKey(job.kind, job.state);
    const previous = summaries.get(key);
    summaries.set(key, {
      kind: job.kind,
      state: job.state,
      count: (previous?.count ?? 0) + 1,
      attempts: (previous?.attempts ?? 0) + job.attempts,
    });
  }
  return [...summaries.values()];
}
