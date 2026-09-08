import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

const openDatabaseAsync = vi.hoisted(() => vi.fn());

vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

import { decodeLegacyCacheRecord, make } from "./mobile-database";

describe("mobile database legacy cache migration", () => {
  it.effect("keeps acquisition failures typed on database operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        openDatabaseAsync.mockRejectedValueOnce(new Error("SQLite unavailable"));

        const database = yield* make;
        const result = yield* Effect.result(database.loadPreferencesJson);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "MobileDatabaseError", operation: "open" },
        });
      }),
    ),
  );

  it("maps legacy thread records to their SQLite identity", () => {
    const payload = JSON.stringify({
      schemaVersion: 2,
      environmentId: "environment-1",
      threadId: "thread-1",
      snapshot: {},
    });

    expect(decodeLegacyCacheRecord("connection-thread-snapshots", payload)).toEqual({
      environmentId: "environment-1",
      kind: "thread",
      cacheKey: "thread-1",
      schemaVersion: 2,
      payload,
    });
  });

  it("preserves the old shell payload for schema decoding after migration", () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      environmentId: "environment-1",
      snapshotReceivedAt: "2026-07-01T00:00:00.000Z",
      snapshot: {},
    });

    expect(decodeLegacyCacheRecord("shell-snapshots", payload)).toEqual({
      environmentId: "environment-1",
      kind: "shell",
      cacheKey: "snapshot",
      schemaVersion: 1,
      payload,
    });
  });

  it("skips malformed legacy records", () => {
    expect(decodeLegacyCacheRecord("connection-vcs-refs", "{not-json")).toBeNull();
    expect(
      decodeLegacyCacheRecord(
        "connection-vcs-refs",
        JSON.stringify({ schemaVersion: 1, environmentId: "environment-1" }),
      ),
    ).toBeNull();
  });
});

describe("mobile database cache freshness", () => {
  it.effect("returns the newest persisted cache timestamp for one environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const databaseHandle = {
          closeAsync: vi.fn(async () => undefined),
          execAsync: vi.fn(async () => undefined),
          withExclusiveTransactionAsync: vi.fn(async (run) =>
            run({ execAsync: vi.fn(async () => undefined) }),
          ),
          getFirstAsync: vi.fn(async (sql: string) => {
            if (sql === "PRAGMA user_version") return { user_version: 1 };
            if (sql.includes("MAX(updated_at)")) return { updatedAt: 1_787_169_600_000 };
            return null;
          }),
          runAsync: vi.fn(async () => undefined),
          getAllAsync: vi.fn(async () => []),
        };
        openDatabaseAsync.mockResolvedValueOnce(databaseHandle);
        const database = yield* make;

        const updatedAt = yield* database.loadEnvironmentCacheUpdatedAt(
          EnvironmentId.make("environment-1"),
        );

        expect(Option.getOrNull(updatedAt)).toBe(1_787_169_600_000);
        expect(databaseHandle.getFirstAsync).toHaveBeenCalledWith(
          expect.stringContaining("MAX(updated_at)"),
          "environment-1",
        );
      }),
    ),
  );
});
