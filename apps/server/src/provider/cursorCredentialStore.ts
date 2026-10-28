// @effect-diagnostics nodeBuiltinImport:off - This adapter reads macOS credentials in a non-interactive child process.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";

const CACHE_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 5_000;
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const KeychainResponse = Schema.Struct({
  status: Schema.Number,
  token: Schema.optional(Schema.String),
});
const decodeKeychainResponse = Schema.decodeSync(Schema.fromJsonString(KeychainResponse));
const ERR_SEC_ITEM_NOT_FOUND = -25300;
const ERR_SEC_INTERACTION_NOT_ALLOWED = -25308;
const ERR_SEC_AUTH_FAILED = -25293;

// File-based Keychains can ignore per-query UI flags. Isolate the legacy UI
// guard from other app operations and restore it before the helper exits.
const KEYCHAIN_QUERY = `
ObjC.import("Foundation");
ObjC.import("Security");
ObjC.import("LocalAuthentication");

function run(args) {
  const previous = Ref();
  if ($.SecKeychainGetUserInteractionAllowed(previous) !== 0 ||
      $.SecKeychainSetUserInteractionAllowed(false) !== 0) {
    throw new Error("Could not disable Keychain interaction.");
  }
  try {
    const object = ObjC.castRefToObject;
    const query = $.NSMutableDictionary.alloc.init;
    const put = function(key, value) { query.setObjectForKey(value, object(key)); };
    put($.kSecClass, object($.kSecClassGenericPassword));
    put($.kSecAttrService, $(args[0]));
    put($.kSecAttrAccount, $(args[1]));
    put($.kSecReturnData, $(true));
    put($.kSecMatchLimit, object($.kSecMatchLimitOne));
    const context = $.LAContext.alloc.init;
    context.interactionNotAllowed = true;
    put($.kSecUseAuthenticationContext, context);
    const result = Ref();
    const status = $.SecItemCopyMatching(query, result);
    if (status !== 0) return JSON.stringify({ status: status });
    const token = $.NSString.alloc.initWithDataEncoding(object(result[0]), $.NSUTF8StringEncoding);
    if (!token) throw new Error("Invalid Cursor credential.");
    return JSON.stringify({ status: status, token: ObjC.unwrap(token) });
  } finally {
    $.SecKeychainSetUserInteractionAllowed(previous[0]);
  }
}
`;

const runKeychainQuery = async (service: string, account: string) => {
  const { stdout } = await execFile(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", KEYCHAIN_QUERY, "--", service, account],
    { encoding: "utf8", timeout: READ_TIMEOUT_MS, maxBuffer: 64 * 1024 },
  );
  return stdout;
};

/** Never authorizes, unlocks, or retries an interactive Keychain read. */
export async function readMacKeychainPassword(
  service: string,
  account: string,
  query: (service: string, account: string) => Promise<string> = runKeychainQuery,
): Promise<string | null> {
  const output = await query(service, account);
  let response: typeof KeychainResponse.Type;
  try {
    response = decodeKeychainResponse(output);
  } catch {
    throw new Error("Cursor returned an invalid credential response.");
  }
  if (
    response.status === ERR_SEC_ITEM_NOT_FOUND ||
    response.status === ERR_SEC_INTERACTION_NOT_ALLOWED ||
    response.status === ERR_SEC_AUTH_FAILED
  ) {
    return null;
  }
  if (response.status !== 0 || response.token === undefined) {
    throw new Error("Cursor credentials could not be read without user interaction.");
  }
  return response.token.trim() || null;
}

export class CursorKeychainTimeoutError extends Error {
  constructor() {
    super("Timed out reading Cursor credentials.");
  }
}

/** Share background reads and cache unavailable logins to avoid repeated OS probes. */
export function makeCachedCursorAccessTokenReader(
  read: () => Promise<string | null>,
  now: () => number = Date.now,
  timeoutMs = READ_TIMEOUT_MS,
): () => Promise<string | null> {
  let cached: { token: string | null; until: number } | null = null;
  let pending: Promise<string | null> | null = null;
  return () => {
    if (cached && cached.until > now()) return Promise.resolve(cached.token);
    pending ??= Promise.resolve()
      .then(read)
      .then((token) => {
        cached = { token, until: now() + CACHE_MS };
        return token;
      })
      .finally(() => {
        pending = null;
      });
    let timeout: ReturnType<typeof setTimeout>;
    return Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        // @effect-diagnostics-next-line globalTimers:off - This Promise boundary owns and clears each caller deadline.
        timeout = setTimeout(() => reject(new CursorKeychainTimeoutError()), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timeout));
  };
}

export const readMacCursorAccessToken = makeCachedCursorAccessTokenReader(() =>
  readMacKeychainPassword("cursor-access-token", "cursor-user"),
);
