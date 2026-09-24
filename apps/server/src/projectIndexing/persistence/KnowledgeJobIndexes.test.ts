// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it, vi } from "vite-plus/test";

import { openKnowledgeKvDatabase } from "../../knowledge/KvKeys.ts";
import {
  clearKnowledgeJobs,
  ensureKnowledgeJobIndexes,
  knowledgeJobKey,
  putKnowledgeJob,
  scanKnowledgeJobs,
  summarizeKnowledgeJobs,
  type StoredKnowledgeJob,
} from "./KnowledgeJobIndexes.ts";

const job = (id: string, patch: Partial<StoredKnowledgeJob> = {}): StoredKnowledgeJob => ({
  id,
  revision: 1,
  idempotencyKey: id,
  kind: "extract",
  state: "pending",
  filePath: `${id}.ts`,
  contentHash: "source-hash",
  inputJson: "{}",
  attempts: 0,
  detail: null,
  claimToken: null,
  claimLeaseToken: null,
  updatedAt: 0,
  ...patch,
});

async function withDatabase(
  run: (database: ReturnType<typeof openKnowledgeKvDatabase>) => Promise<void>,
) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-job-indexes-"));
  const database = openKnowledgeKvDatabase(root);
  try {
    await run(database);
  } finally {
    database.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
}

it("finds pending work, source jobs, and progress without reading the unrelated queue", () =>
  withDatabase(async (database) => {
    await ensureKnowledgeJobIndexes(database);
    const selected = job("z-resolve", { kind: "resolve" });
    await database.transaction(async (transaction) => {
      for (let index = 0; index < 2_000; index++)
        await putKnowledgeJob(
          transaction,
          job(`source-${index}`, {
            state: index < 1_000 ? "completed" : "pending",
            attempts: index < 1_000 ? 1 : 0,
          }),
        );
      await putKnowledgeJob(transaction, selected);
    });
    const getRange = database.getRange.bind(database);
    let recordsRead = 0;
    const spy = vi.spyOn(database, "getRange").mockImplementation((options) =>
      (async function* () {
        for await (const entry of getRange(options)) {
          recordsRead++;
          yield entry;
        }
      })(),
    );
    try {
      expect(
        await Array.fromAsync(scanKnowledgeJobs(database, { kind: "resolve", state: "pending" })),
      ).toEqual([selected]);
      expect(
        await Array.fromAsync(scanKnowledgeJobs(database, { filePath: selected.filePath })),
      ).toEqual([selected]);
      expect(await summarizeKnowledgeJobs(database)).toEqual([
        { kind: "extract", state: "completed", count: 1_000, attempts: 1_000 },
        { kind: "extract", state: "pending", count: 1_000, attempts: 0 },
        { kind: "resolve", state: "pending", count: 1, attempts: 0 },
      ]);
      expect(recordsRead).toBeLessThanOrEqual(5);
    } finally {
      spy.mockRestore();
    }
  }));

it("keeps progress correct through retry, cancellation, recovery, and generation reset", () =>
  withDatabase(async (database) => {
    await ensureKnowledgeJobIndexes(database);
    for (const update of [
      job("source"),
      job("source", { state: "running", attempts: 1 }),
      job("source", { state: "pending", attempts: 1 }),
      job("source", { state: "running", attempts: 2 }),
      job("source", { state: "cancelled", attempts: 2 }),
      job("source", { state: "pending", attempts: 2 }),
      job("source", { state: "completed", attempts: 3 }),
    ]) {
      await database.transaction((transaction) => putKnowledgeJob(transaction, update));
      expect(await summarizeKnowledgeJobs(database)).toEqual([
        { kind: update.kind, state: update.state, count: 1, attempts: update.attempts },
      ]);
      expect(await Array.fromAsync(scanKnowledgeJobs(database, { state: "pending" }))).toEqual(
        update.state === "pending" ? [update] : [],
      );
    }
    await clearKnowledgeJobs(database);
    expect(await summarizeKnowledgeJobs(database)).toEqual([]);
    expect(await Array.fromAsync(scanKnowledgeJobs(database, { filePath: "source.ts" }))).toEqual(
      [],
    );
    expect(await database.get(knowledgeJobKey("source"))).toBeUndefined();
  }));

it("upgrades paused queues without losing jobs and supports paginated reads before the upgrade", () =>
  withDatabase(async (database) => {
    const jobs = [job("first"), job("second"), job("third", { state: "completed", attempts: 2 })];
    for (const saved of jobs) await database.put(knowledgeJobKey(saved.id), saved);
    const summary = await summarizeKnowledgeJobs(database);
    expect(
      await Array.fromAsync(scanKnowledgeJobs(database, { state: "pending", afterId: "first" })),
    ).toEqual([jobs[1]]);
    await Promise.all([ensureKnowledgeJobIndexes(database), ensureKnowledgeJobIndexes(database)]);
    expect(await summarizeKnowledgeJobs(database)).toEqual(expect.arrayContaining(summary));
    expect(await Array.fromAsync(scanKnowledgeJobs(database))).toEqual(jobs);
    expect(
      await Array.fromAsync(scanKnowledgeJobs(database, { state: "pending", afterId: "first" })),
    ).toEqual([jobs[1]]);
  }));
