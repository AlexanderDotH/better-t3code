// @effect-diagnostics nodeBuiltinImport:off - Legacy-file inspection is read-only; keychain decryption runs only from the user's menu action.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Electron from "electron";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLocalSecrets from "./DesktopLocalSecrets.ts";
import * as DesktopConnectionCatalogStore from "./DesktopConnectionCatalogStore.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const decodeCatalog = Schema.decodeOption(Schema.fromJsonString(ConnectionCatalogDocument));
const encodeCatalog = Schema.encodeEffect(Schema.fromJsonString(ConnectionCatalogDocument));
const decodeEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    version: Schema.Literal(1),
    encryptedCatalog: Schema.String,
  }),
);

export const LegacySecretDecrypt = Context.Reference<(bytes: Uint8Array) => Promise<string>>(
  "@t3tools/desktop/app/LegacySecretDecrypt",
  {
    defaultValue: () => async (bytes) =>
      (await Electron.safeStorage.decryptStringAsync(Buffer.from(bytes))).result,
  },
);

export class DesktopCredentialMigrationError extends Schema.TaggedError<DesktopCredentialMigrationError>()(
  "DesktopCredentialMigrationError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Saved credentials could not be imported. The original files were preserved.";
  }
}

export class DesktopCredentialMigration extends Context.Service<
  DesktopCredentialMigration,
  {
    readonly pending: Effect.Effect<boolean, DesktopCredentialMigrationError>;
    readonly run: Effect.Effect<void, DesktopCredentialMigrationError>;
  }
>()("@t3tools/desktop/app/DesktopCredentialMigration") {}

function mergeByKey<A>(
  older: ReadonlyArray<A>,
  current: ReadonlyArray<A>,
  key: (value: A) => string,
): ReadonlyArray<A> {
  return [...new Map([...older, ...current].map((value) => [key(value), value])).values()];
}

function mergeCredentialCatalogs(
  older: ConnectionCatalogDocument,
  current: ConnectionCatalogDocument,
): ConnectionCatalogDocument {
  const existingEnvironments = new Set(current.targets.map((target) => target.environmentId));
  const permissions = current.githubRoutingPermissions ?? older.githubRoutingPermissions;
  return {
    schemaVersion: 1,
    targets: mergeByKey(older.targets, current.targets, (value) => value.environmentId),
    profiles: mergeByKey(older.profiles, current.profiles, (value) => value.connectionId),
    credentials: mergeByKey(older.credentials, current.credentials, (value) => value.connectionId),
    remoteDpopTokens: mergeByKey(
      older.remoteDpopTokens,
      current.remoteDpopTokens,
      (value) => value.environmentId,
    ),
    ...(permissions === undefined ? {} : { githubRoutingPermissions: permissions }),
    disabledEnvironmentIds: [
      ...new Set([
        ...current.disabledEnvironmentIds,
        ...older.disabledEnvironmentIds.filter((id) => !existingEnvironments.has(id)),
      ]),
    ],
  };
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await NodeFSP.readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("A saved credential file is invalid.");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function legacyTokenEntries(value: unknown, prefix = ""): Array<readonly [string, string]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The old account-token file is invalid.");
  }
  return Object.entries(value).flatMap(([key, token]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof token === "string") {
      if (!token.startsWith("enc:") && !token.startsWith("raw:")) {
        throw new Error("An old account token has an unsupported format.");
      }
      return [[name, token] as const];
    }
    return legacyTokenEntries(token, name);
  });
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const local = yield* DesktopLocalSecrets.DesktopLocalSecrets;
  const catalogStore = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
  const decryptLegacy = yield* LegacySecretDecrypt;
  const lock = yield* Semaphore.make(1);
  const marker = NodePath.join(environment.stateDir, "keychain-import-complete.json");
  const oldCatalogPath = NodePath.join(environment.stateDir, "connection-catalog.json");
  const oldTokensPath = NodePath.join(environment.stateDir, "clerk-tokens.json");
  const pending = Effect.tryPromise(
    async () =>
      environment.platform === "darwin" &&
      !(await exists(marker)) &&
      ((await exists(oldCatalogPath)) ||
        (await exists(oldTokensPath)) ||
        (await exists(environment.savedEnvironmentRegistryPath))),
  );
  const legacyStorage = ElectronSafeStorage.ElectronSafeStorage.of({
    isEncryptionAvailable: Effect.succeed(true),
    encryptString: () => Effect.die("Legacy migration never writes OS-encrypted credentials."),
    decryptString: (value) =>
      Effect.tryPromise({
        try: () => decryptLegacy(value),
        catch: (cause) => new ElectronSafeStorage.ElectronSafeStorageDecryptError({ cause }),
      }),
    selectedStorageBackend: Effect.succeedNone,
  });
  const registry = yield* DesktopSavedEnvironments.make.pipe(
    Effect.provideService(ElectronSafeStorage.ElectronSafeStorage, legacyStorage),
  );
  const run = Effect.gen(function* () {
    if (!(yield* pending)) return;
    const oldDocument = yield* Effect.tryPromise(() => readOptionalJson(oldCatalogPath));
    let oldCatalog = EMPTY_CONNECTION_CATALOG_DOCUMENT;
    if (oldDocument !== undefined) {
      const envelope = decodeEnvelope(oldDocument);
      if (Option.isNone(envelope))
        return yield* new DesktopCredentialMigrationError({
          cause: "The old connection catalog is invalid.",
        });
      const plaintext = yield* Effect.tryPromise(() =>
        decryptLegacy(Buffer.from(envelope.value.encryptedCatalog, "base64")),
      );
      const decoded = decodeCatalog(plaintext);
      if (Option.isNone(decoded))
        return yield* new DesktopCredentialMigrationError({
          cause: "The old connection catalog is invalid.",
        });
      oldCatalog = decoded.value;
    } else {
      oldCatalog = yield* DesktopConnectionCatalogStore.migrateSavedEnvironmentRecords(
        yield* registry.getRegistry,
        registry,
        oldCatalogPath,
      );
    }
    const oldTokens = yield* Effect.tryPromise(() => readOptionalJson(oldTokensPath));
    const importedTokens: Array<readonly [string, string]> = [];
    if (oldTokens !== undefined) {
      const entries = yield* Effect.try(() => legacyTokenEntries(oldTokens));
      for (const [name, token] of entries) {
        const plaintext = token.startsWith("raw:")
          ? token.slice(4)
          : yield* Effect.tryPromise(() => decryptLegacy(Buffer.from(token.slice(4), "base64")));
        importedTokens.push([name, plaintext]);
      }
    }
    let saved = false;
    const maxMergeAttempts = 3;
    for (let attempt = 0; attempt < maxMergeAttempts && !saved; attempt++) {
      const stored = yield* catalogStore.get;
      let currentCatalog = EMPTY_CONNECTION_CATALOG_DOCUMENT;
      if (Option.isSome(stored)) {
        const current = decodeCatalog(stored.value);
        if (Option.isNone(current))
          return yield* new DesktopCredentialMigrationError({
            cause: "The current connection catalog is invalid.",
          });
        currentCatalog = current.value;
      }
      const encoded = yield* encodeCatalog(
        mergeCredentialCatalogs(oldCatalog, currentCatalog),
      ).pipe(
        Effect.mapError(
          () =>
            new DesktopCredentialMigrationError({
              cause: "The imported catalog could not be encoded.",
            }),
        ),
      );
      saved = yield* catalogStore.set(encoded, stored);
    }
    if (!saved)
      return yield* new DesktopCredentialMigrationError({
        cause: "Connections changed during import. Try again.",
      });
    yield* Effect.tryPromise(() => local.tokens.importItems(importedTokens));
    yield* Effect.tryPromise(() => DesktopLocalSecrets.writePrivateFile(marker, '{"version":1}\n'));
  }).pipe(
    lock.withPermits(1),
    Effect.mapError((cause) => new DesktopCredentialMigrationError({ cause })),
  );
  return {
    pending: pending.pipe(
      Effect.mapError((cause) => new DesktopCredentialMigrationError({ cause })),
    ),
    run,
  };
});

export const layer = Layer.effect(DesktopCredentialMigration, make);
