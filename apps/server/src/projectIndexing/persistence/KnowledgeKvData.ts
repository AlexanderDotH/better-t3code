import type { RocksDatabase, Transaction } from "@harperfast/rocksdb-js";

import {
  kvKey,
  kvKeyText,
  kvPrefix,
  kvStringPrefix,
  scanKvPrefix,
} from "../../knowledge/KvKeys.ts";
import type { KnowledgeRecordKind } from "./KnowledgeStoreTypes.ts";

export type KvHandle = RocksDatabase | Transaction;

export interface StoredRecord {
  readonly kind: KnowledgeRecordKind;
  readonly id: string;
  readonly filePath: string | null;
  readonly name: string;
  readonly searchText: string;
  readonly payload: string;
  readonly dependencyPaths: ReadonlyArray<string>;
  readonly entityIds: ReadonlyArray<string>;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly calls: ReadonlyArray<{ readonly callerId: string; readonly calleeId: string }>;
}

export const recordKey = (kind: KnowledgeRecordKind, id: string) => kvKey("r", kind, id);
const counterKey = (counter: string) => kvKey("count", counter);
function counters(record: StoredRecord) {
  const value = JSON.parse(record.payload) as { status?: string; resolution?: string };
  return [
    `kind:${record.kind}`,
    ...(record.kind === "files" ? [`file-status:${value.status ?? "unknown"}`] : []),
    ...(record.kind === "imports" ? [`import-resolution:${value.resolution ?? "unknown"}`] : []),
    ...(record.kind === "callsites" ? [`call-resolution:${value.resolution ?? "unknown"}`] : []),
  ];
}

async function updateCounters(
  transaction: Transaction,
  old: StoredRecord | null,
  next: StoredRecord | null,
) {
  const deltas = new Map<string, number>();
  for (const key of old ? counters(old) : []) deltas.set(key, (deltas.get(key) ?? 0) - 1);
  for (const key of next ? counters(next) : []) deltas.set(key, (deltas.get(key) ?? 0) + 1);
  for (const [key, delta] of deltas) {
    if (delta === 0) continue;
    const path = counterKey(key);
    const count = Number((await transaction.get(path)) ?? 0) + delta;
    if (count < 0) throw new Error(`Negative project knowledge counter: ${key}`);
    await transaction.put(path, count);
  }
}
const sourceKey = (record: StoredRecord) =>
  record.filePath === null ? null : kvKey("f", record.filePath, record.kind, record.id);
const dependencyKeys = (record: StoredRecord) =>
  record.dependencyPaths.map((path) => kvKey("d", path, record.kind, record.id));
const entityKeys = (record: StoredRecord) =>
  record.entityIds.map((id) => kvKey("e", id, record.kind, record.id));
const ruleEvidenceKeys = (record: StoredRecord) =>
  record.kind === "rules"
    ? record.evidenceIds.map((id) => kvKey("rule-evidence", id, record.id))
    : [];
const callKeys = (record: StoredRecord) =>
  record.calls.flatMap(({ callerId, calleeId }) => [
    ...(callerId ? [kvKey("c", "caller", callerId, record.id)] : []),
    ...(calleeId ? [kvKey("c", "callee", calleeId, record.id)] : []),
  ]);
const searchKeys = (record: StoredRecord) =>
  [...new Set(record.searchText.match(/[\p{L}\p{N}_]+/gu) ?? [])].map((term) =>
    kvKey("t", term, record.kind, record.id),
  );

function indexKeys(record: StoredRecord) {
  return [
    ...(sourceKey(record) ? [sourceKey(record)!] : []),
    ...dependencyKeys(record),
    ...entityKeys(record),
    ...ruleEvidenceKeys(record),
    ...callKeys(record),
    ...searchKeys(record),
  ];
}

export async function getKvRecord(
  database: KvHandle,
  kind: KnowledgeRecordKind,
  id: string,
): Promise<StoredRecord | null> {
  const value = await database.get(recordKey(kind, id));
  return value === undefined ? null : (value as StoredRecord);
}

export async function putKvRecord(transaction: Transaction, record: StoredRecord) {
  const old = await getKvRecord(transaction, record.kind, record.id);
  await updateCounters(transaction, old, record);
  if (old) for (const key of indexKeys(old)) await transaction.remove(key);
  await transaction.put(recordKey(record.kind, record.id), record);
  for (const key of indexKeys(record)) await transaction.put(key, record.id);
  return old === null;
}

export async function removeKvRecord(
  transaction: Transaction,
  kind: KnowledgeRecordKind,
  id: string,
) {
  const old = await getKvRecord(transaction, kind, id);
  if (!old) return false;
  await updateCounters(transaction, old, null);
  await transaction.remove(recordKey(kind, id));
  for (const key of indexKeys(old)) await transaction.remove(key);
  return true;
}

export async function* scanKvRecords(database: KvHandle, kind: KnowledgeRecordKind, afterId = "") {
  const range = kvPrefix("r", kind);
  for await (const { key, value } of database.getRange({
    start: afterId ? recordKey(kind, afterId) : range.start,
    end: range.end,
  })) {
    if (afterId && kvKeyText(key) === recordKey(kind, afterId)) continue;
    yield value as StoredRecord;
  }
}

export async function indexedRecordIds(database: KvHandle, ...parts: ReadonlyArray<string>) {
  const ids: string[] = [];
  for await (const { value } of scanKvPrefix(database, ...parts)) ids.push(String(value));
  return ids;
}

export async function recordsForDependencyPath(database: KvHandle, filePath: string) {
  const records: StoredRecord[] = [];
  for await (const { key } of scanKvPrefix(database, "d", filePath)) {
    const [, , kind, id] = key.split("\0");
    const record = await getKvRecord(database, kind as KnowledgeRecordKind, id!);
    if (record) records.push(record);
  }
  return records;
}

export async function recordsForDependencyPrefix(
  database: KvHandle,
  prefix: string,
  kind: KnowledgeRecordKind,
) {
  const path = prefix.replace(/\/+$/u, "");
  const start = kvKey("d", path);
  const ids = new Set<string>();
  for await (const { key } of database.getRange(kvStringPrefix(start))) {
    const [, dependency, recordKind, id] = kvKeyText(key).split("\0");
    if (recordKind === kind && (dependency === path || dependency?.startsWith(`${path}/`)))
      ids.add(id!);
  }
  const records: StoredRecord[] = [];
  for (const id of ids) {
    const record = await getKvRecord(database, kind, id);
    if (record) records.push(record);
  }
  return records;
}

export async function recordsForSourcePath(database: KvHandle, filePath: string) {
  const records: StoredRecord[] = [];
  for await (const { key } of scanKvPrefix(database, "f", filePath)) {
    const [, , kind, id] = key.split("\0");
    const record = await getKvRecord(database, kind as KnowledgeRecordKind, id!);
    if (record) records.push(record);
  }
  return records;
}

export async function countKvRecords(database: KvHandle, kind: KnowledgeRecordKind) {
  return Number((await database.get(counterKey(`kind:${kind}`))) ?? 0);
}

export async function getKvCounter(database: KvHandle, key: string) {
  return Number((await database.get(counterKey(key))) ?? 0);
}

export async function searchKvRecordIds(
  database: KvHandle,
  term: string,
  kinds: ReadonlySet<KnowledgeRecordKind>,
  limit: number,
) {
  const ids = new Set<string>();
  const start = kvKey("t", term);
  for await (const { key } of database.getRange(kvStringPrefix(start))) {
    const parts = kvKeyText(key).split("\0");
    const kind = parts[2] as KnowledgeRecordKind;
    if (kinds.has(kind)) ids.add(kvKey(kind, parts[3]!));
    if (ids.size >= limit) break;
  }
  return ids;
}
