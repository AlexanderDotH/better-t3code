// @effect-diagnostics nodeBuiltinImport:off - Migration fixtures use isolated temporary files and fake legacy decryption.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { beforeEach, afterEach, describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCatalog = Schema.decodeSync(Schema.fromJsonString(ConnectionCatalogDocument));
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLocalSecrets from "./DesktopLocalSecrets.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
import * as Catalog from "./DesktopConnectionCatalogStore.ts";
import * as Migration from "./DesktopCredentialMigration.ts";

vi.mock("electron", () => ({
  safeStorage: {
    decryptStringAsync: () => {
      throw new Error("A real keychain call is forbidden in this test.");
    },
  },
}));

let directory: string;
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-credential-import-"));
  await NodeFSP.mkdir(NodePath.join(directory, "userdata"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});
const statePath = (file: string) => NodePath.join(directory, "userdata", file);
const readFixture = (file: string) =>
  Effect.tryPromise(() => NodeFSP.readFile(statePath(file), "utf8"));
const writeFixture = (file: string, value: string) =>
  Effect.tryPromise(() => NodeFSP.writeFile(statePath(file), value));
const catalog = (label = "Older", token = "older-test-secret") => ({
  schemaVersion: 1 as const,
  targets: [
    { _tag: "BearerConnectionTarget", environmentId: "saved-server", label, connectionId: "saved" },
  ],
  profiles: [
    {
      _tag: "BearerConnectionProfile",
      connectionId: "saved",
      environmentId: "saved-server",
      label,
      httpBaseUrl: "https://example.test/",
      wsBaseUrl: "wss://example.test/",
    },
  ],
  credentials: [
    { connectionId: "saved", credential: { _tag: "BearerConnectionCredential", token } },
  ],
  remoteDpopTokens: [],
  disabledEnvironmentIds: [],
});
const legacyEnvelope = () =>
  encodeJson({
    version: 1,
    encryptedCatalog: Buffer.from(encodeJson(catalog())).toString("base64"),
  });
function makeLayer(decrypt: (bytes: Uint8Array) => Promise<string>) {
  const environment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: directory,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: directory })),
    ),
  );
  return Migration.layer.pipe(
    Layer.provideMerge(Catalog.layer.pipe(Layer.provideMerge(DesktopSavedEnvironments.layer))),
    Layer.provideMerge(ElectronSafeStorage.layer),
    Layer.provideMerge(DesktopLocalSecrets.layer),
    Layer.provideMerge(environment),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
    Layer.provide(Layer.succeed(Migration.LegacySecretDecrypt, decrypt)),
  );
}
describe("desktop credential migration", () => {
  it.effect(
    "does not unlock at startup, imports explicitly, and preserves newer values and original files",
    () =>
      Effect.gen(function* () {
        const original = legacyEnvelope();
        const originalTokens = encodeJson({
          session: "enc:" + Buffer.from("account-test-token").toString("base64"),
        });
        yield* writeFixture("connection-catalog.json", original);
        yield* writeFixture("clerk-tokens.json", originalTokens);
        let decryptCalls = 0;
        const layer = makeLayer(async (bytes) => {
          decryptCalls++;
          return Buffer.from(bytes).toString();
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const migration = yield* Migration.DesktopCredentialMigration;
            const store = yield* Catalog.DesktopConnectionCatalogStore;
            const local = yield* DesktopLocalSecrets.DesktopLocalSecrets;
            expect(yield* store.get).toEqual(Option.none());
            expect(yield* migration.pending).toBe(true);
            expect(yield* Effect.promise(() => local.tokens.getItem("session"))).toBe(null);
            expect(decryptCalls).toBe(0);
            yield* store.set(encodeJson(catalog("Newer", "newer-test-secret")));
            yield* Effect.all([migration.run, migration.run], { concurrency: "unbounded" });
            expect(decryptCalls).toBe(2);
            const saved = yield* store.get;
            expect(Option.isSome(saved)).toBe(true);
            if (Option.isSome(saved)) {
              expect(decodeCatalog(saved.value).targets[0]?.label).toBe("Newer");
              expect(decodeCatalog(saved.value).credentials[0]?.credential.token).toBe(
                "newer-test-secret",
              );
            }
            expect(yield* Effect.promise(() => local.tokens.getItem("session"))).toBe(
              "account-test-token",
            );
            expect(yield* migration.pending).toBe(false);
            yield* migration.run;
            expect(decryptCalls).toBe(2);
          }).pipe(Effect.provide(layer)),
        );
        expect(yield* readFixture("connection-catalog.json")).toBe(original);
        expect(yield* readFixture("clerk-tokens.json")).toBe(originalTokens);
        expect(
          (yield* readFixture("connection-catalog.local.json")).includes("newer-test-secret"),
        ).toBe(false);
        expect((yield* readFixture("clerk-tokens.local.json")).includes("account-test-token")).toBe(
          false,
        );
      }),
  );

  it.effect("preserves the originals after denied access and allows a later explicit retry", () =>
    Effect.gen(function* () {
      const original = legacyEnvelope();
      yield* writeFixture("connection-catalog.json", original);
      let denied = true;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const migration = yield* Migration.DesktopCredentialMigration;
          const store = yield* Catalog.DesktopConnectionCatalogStore;
          const failure = yield* migration.run.pipe(Effect.flip);
          expect(failure).toBeInstanceOf(Migration.DesktopCredentialMigrationError);
          expect(yield* store.get).toEqual(Option.none());
          expect(yield* migration.pending).toBe(true);
          denied = false;
          yield* migration.run;
          expect(Option.isSome(yield* store.get)).toBe(true);
        }).pipe(
          Effect.provide(
            makeLayer(async (bytes) => {
              if (denied) throw new Error("Access denied");
              return Buffer.from(bytes).toString();
            }),
          ),
        ),
      );
      expect(yield* readFixture("connection-catalog.json")).toBe(original);
    }),
  );

  it.effect("imports the previous saved-environment registry only after an explicit request", () =>
    Effect.gen(function* () {
      let calls = 0;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          yield* Effect.tryPromise(() =>
            NodeFSP.writeFile(
              environment.savedEnvironmentRegistryPath,
              encodeJson({
                version: 1,
                records: [
                  {
                    environmentId: "legacy-server",
                    label: "Legacy",
                    httpBaseUrl: "https://example.test/",
                    wsBaseUrl: "wss://example.test/",
                    createdAt: "2026-01-01T00:00:00Z",
                    lastConnectedAt: null,
                    encryptedBearerToken: Buffer.from("legacy-bearer").toString("base64"),
                  },
                ],
              }),
            ),
          );
          const store = yield* Catalog.DesktopConnectionCatalogStore;
          expect(yield* store.get).toEqual(Option.none());
          expect(calls).toBe(0);
          yield* (yield* Migration.DesktopCredentialMigration).run;
          const saved = yield* store.get;
          expect(Option.isSome(saved)).toBe(true);
          if (Option.isSome(saved))
            expect(decodeCatalog(saved.value).credentials[0]?.credential.token).toBe(
              "legacy-bearer",
            );
          expect(calls).toBe(1);
        }).pipe(
          Effect.provide(
            makeLayer(async (bytes) => {
              calls++;
              return Buffer.from(bytes).toString();
            }),
          ),
        ),
      );
    }),
  );
});
