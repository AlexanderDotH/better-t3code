// @effect-diagnostics nodeBuiltinImport:off - The local cipher owns private key files and authenticated encryption at the platform boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const HEADER = Buffer.from("T3LOCAL1\0");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretCipher {
  readonly encrypt: (value: string) => Promise<Uint8Array>;
  readonly decrypt: (value: Uint8Array) => Promise<string>;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isLocalSecret(value: Uint8Array): boolean {
  return Buffer.from(value).subarray(0, HEADER.length).equals(HEADER);
}

export async function writePrivateFile(path: string, value: Uint8Array | string): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.writeFile(temporary, value, { mode: 0o600, flag: "wx", flush: true });
    await NodeFSP.rename(temporary, path);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
}

export function createLocalSecretCipher(
  keyPath: string,
  encryptedFiles: ReadonlyArray<string> = [],
): SecretCipher {
  let keyPromise: Promise<Buffer> | undefined;
  const readKey = async () => {
    const file = await NodeFSP.open(
      keyPath,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || (process.getuid !== undefined && info.uid !== process.getuid())) {
        throw new Error("The local encryption key must be a regular file owned by this user.");
      }
      const key = await file.readFile();
      if (key.length !== KEY_BYTES) throw new Error("The local encryption key is invalid.");
      await file.chmod(0o600);
      return key;
    } finally {
      await file.close();
    }
  };
  const loadKey = async () => {
    try {
      return await readKey();
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    for (const encryptedFile of encryptedFiles) {
      try {
        await NodeFSP.access(encryptedFile);
        throw new Error(
          "The local encryption key is missing; existing credentials were preserved.",
        );
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    }
    await NodeFSP.mkdir(NodePath.dirname(keyPath), { recursive: true, mode: 0o700 });
    const temporary = `${keyPath}.${NodeCrypto.randomUUID()}.tmp`;
    try {
      await NodeFSP.writeFile(temporary, NodeCrypto.randomBytes(KEY_BYTES), {
        mode: 0o600,
        flag: "wx",
        flush: true,
      });
      // Publish a complete key without replacing one created by another instance.
      try {
        await NodeFSP.link(temporary, keyPath);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      return await readKey();
    } finally {
      await NodeFSP.rm(temporary, { force: true });
    }
  };
  const getKey = () => {
    keyPromise ??= loadKey().catch((error) => {
      keyPromise = undefined;
      throw error;
    });
    return keyPromise;
  };
  return {
    encrypt: async (value) => {
      const key = await getKey();
      const nonce = NodeCrypto.randomBytes(NONCE_BYTES);
      const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(HEADER);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([HEADER, nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt: async (value) => {
      if (!isLocalSecret(value)) {
        throw new Error("Import older credentials from the app menu before using them.");
      }
      if (value.length < HEADER.length + NONCE_BYTES + TAG_BYTES) {
        throw new Error("The encrypted local secret is incomplete.");
      }
      // A missing key must never be silently replaced when decrypting saved data.
      const key = await readKey();
      const bytes = Buffer.from(value);
      const nonceEnd = HEADER.length + NONCE_BYTES;
      const tagEnd = nonceEnd + TAG_BYTES;
      const decipher = NodeCrypto.createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(HEADER.length, nonceEnd),
      );
      decipher.setAAD(HEADER);
      decipher.setAuthTag(bytes.subarray(nonceEnd, tagEnd));
      return Buffer.concat([decipher.update(bytes.subarray(tagEnd)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}

type TokenValues = Record<string, string>;

async function readTokenValues(path: string): Promise<TokenValues> {
  let raw: string;
  try {
    raw = await NodeFSP.readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return Object.create(null) as TokenValues;
    throw error;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("The encrypted account storage is invalid.");
  }
  if (
    decoded === null ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    !Object.values(decoded).every((value) => typeof value === "string")
  ) {
    throw new Error("The encrypted account storage is invalid.");
  }
  return Object.assign(Object.create(null) as TokenValues, decoded);
}

export function createLocalTokenStorage(path: string, cipher: SecretCipher) {
  let mutations: Promise<void> = Promise.resolve();
  const mutate = (update: (values: TokenValues) => Promise<void>) => {
    const result = mutations.then(async () => {
      const values = await readTokenValues(path);
      await update(values);
      await writePrivateFile(path, JSON.stringify(values));
    });
    // Return failures to the caller while keeping later mutations usable.
    mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    getItem: async (key: string): Promise<string | null> => {
      await mutations;
      const values = await readTokenValues(path);
      const encrypted = Object.hasOwn(values, key) ? values[key] : undefined;
      return encrypted === undefined ? null : cipher.decrypt(Buffer.from(encrypted, "base64"));
    },
    setItem: (key: string, value: string) =>
      mutate(async (values) => {
        values[key] = Buffer.from(await cipher.encrypt(value)).toString("base64");
      }),
    removeItem: (key: string) =>
      mutate(async (values) => {
        delete values[key];
      }),
    importItems: (entries: ReadonlyArray<readonly [string, string]>) =>
      mutate(async (values) => {
        for (const [key, value] of entries) {
          if (Object.hasOwn(values, key)) continue;
          values[key] = Buffer.from(await cipher.encrypt(value)).toString("base64");
        }
      }),
  };
}

export class DesktopLocalSecrets extends Context.Service<
  DesktopLocalSecrets,
  {
    readonly cipher: SecretCipher;
    readonly tokens: ReturnType<typeof createLocalTokenStorage>;
  }
>()("@t3tools/desktop/app/DesktopLocalSecrets") {}

export const layer = Layer.effect(
  DesktopLocalSecrets,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const tokenPath = environment.path.join(environment.stateDir, "clerk-tokens.local.json");
    const catalogPath = environment.path.join(
      environment.stateDir,
      "connection-catalog.local.json",
    );
    const cipher = createLocalSecretCipher(
      environment.path.join(environment.stateDir, "secrets", "desktop-storage.key"),
      [tokenPath, catalogPath],
    );
    return { cipher, tokens: createLocalTokenStorage(tokenPath, cipher) };
  }),
);
