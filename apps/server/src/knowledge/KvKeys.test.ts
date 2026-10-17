// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

import { afterEach, expect, it } from "vite-plus/test";

import {
  iterateKvItems,
  kvKey,
  kvStringPrefix,
  openKnowledgeKvDatabase,
  scanKvPrefix,
} from "./KvKeys.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

it("lets native I/O run before a large transaction batch finishes", async () => {
  let processed = 0;
  let processedAtIo = 0;
  const ioTurn = NodeTimersPromises.setImmediate().then(() => {
    processedAtIo = processed;
  });
  for await (const value of iterateKvItems(Array.from({ length: 1_024 }, (_, index) => index))) {
    expect(value).toBe(processed);
    processed += 1;
  }
  await ioTurn;
  expect(processed).toBe(1_024);
  expect(processedAtIo).toBeGreaterThan(0);
  expect(processedAtIo).toBeLessThan(processed);
});

it("keeps scoped keys separate across workspaces and survives a checkpoint", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-kv-"));
  roots.push(root);
  const source = openKnowledgeKvDatabase(NodePath.join(root, "source"));
  try {
    await source.put(kvKey("record", "scope-a", "first"), "one");
    await source.put(kvKey("record", "scope-a", "second"), "two");
    await source.put(kvKey("record", "scope-b", "third"), "three");
    await source.createCheckpoint(NodePath.join(root, "checkpoint"));
    const checkpoint = openKnowledgeKvDatabase(NodePath.join(root, "checkpoint"));
    try {
      await checkpoint.put(kvKey("record", "scope-a", "first"), "updated");
      const sourceEntries = [];
      for await (const entry of scanKvPrefix(source, "record", "scope-a"))
        sourceEntries.push(entry.value);
      expect(sourceEntries).toEqual(["one", "two"]);
      expect(await checkpoint.get(kvKey("record", "scope-a", "first"))).toBe("updated");
    } finally {
      checkpoint.close();
    }
  } finally {
    source.close();
  }
});

it("rolls back a failed multi-key write", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-kv-"));
  roots.push(root);
  const database = openKnowledgeKvDatabase(NodePath.join(root, "database"));
  try {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.put(kvKey("record", "one"), "value");
        throw new Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    expect(await database.get(kvKey("record", "one"))).toBeUndefined();
  } finally {
    database.close();
  }
});

it("scans UTF-8 key prefixes without including the next path", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-kv-"));
  roots.push(root);
  const database = openKnowledgeKvDatabase(NodePath.join(root, "database"));
  try {
    await database.put(kvKey("dependency", "src/café", "first"), "match");
    await database.put(kvKey("dependency", "src/cafétéria", "second"), "match");
    await database.put(kvKey("dependency", "src/cafê", "third"), "different");
    const entries = [];
    for await (const entry of database.getRange(kvStringPrefix(kvKey("dependency", "src/café"))))
      entries.push(entry.value);
    expect(entries).toEqual(["match", "match"]);
  } finally {
    database.close();
  }
});
