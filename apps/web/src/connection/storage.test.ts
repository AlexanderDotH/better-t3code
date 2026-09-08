import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument, ConnectionTargetStore } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import {
  connectionStorageLayer,
  makeCatalogBackend,
  makeCatalogStore,
  upgradeConnectionStorageDatabase,
} from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.effect("reopens the version-5 cache shipped by Better T3", () =>
  Effect.gen(function* () {
    const database = { close: vi.fn() };
    vi.stubGlobal("indexedDB", {
      open: (_name: string, version: number) => {
        const request = Object.assign(new EventTarget(), {
          result: database,
          error:
            version < 5
              ? new DOMException("The existing database is version 5.", "VersionError")
              : null,
        });
        queueMicrotask(() =>
          request.dispatchEvent(new Event(request.error === null ? "success" : "error")),
        );
        return request;
      },
    });
    vi.stubGlobal("window", {
      desktopBridge: {
        getConnectionCatalog: async () => JSON.stringify(emptyCatalog),
        setConnectionCatalog: vi.fn(),
      },
    });

    const targets = yield* ConnectionTargetStore.use((store) => store.list).pipe(
      Effect.provide(connectionStorageLayer),
    );

    expect(targets).toEqual([]);
    expect(database.close).toHaveBeenCalledOnce();
  }),
);

describe("upgradeConnectionStorageDatabase", () => {
  it("clears only pre-pagination thread snapshots when upgrading from version 4", () => {
    const clear = vi.fn();
    const objectStore = vi.fn(() => ({ clear }));
    const createObjectStore = vi.fn();
    const request = {
      result: {
        objectStoreNames: { contains: () => true },
        createObjectStore,
      },
      transaction: { objectStore },
    } as unknown as IDBOpenDBRequest;

    upgradeConnectionStorageDatabase(request, 4);

    expect(objectStore.mock.calls).toEqual([["thread"]]);
    expect(clear).toHaveBeenCalledOnce();
    expect(createObjectStore).not.toHaveBeenCalled();
  });

  it("preserves current snapshots and initializes all stores on a fresh install", () => {
    const createObjectStore = vi.fn();
    const objectStore = vi.fn();
    const request = {
      result: {
        objectStoreNames: { contains: () => false },
        createObjectStore,
      },
      transaction: { objectStore },
    } as unknown as IDBOpenDBRequest;

    upgradeConnectionStorageDatabase(request, 0);
    expect(createObjectStore.mock.calls).toEqual([
      ["catalog"],
      ["shell"],
      ["thread"],
      ["server-config"],
      ["vcs-refs"],
    ]);
    upgradeConnectionStorageDatabase(request, 5);
    expect(objectStore).not.toHaveBeenCalled();
  });
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});
