import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

const ChatGptAuthFile = Schema.Struct({
  auth_mode: Schema.optionalKey(Schema.Literal("chatgpt")),
  OPENAI_API_KEY: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
  codexMultiAuthSyncVersion: Schema.optionalKey(Schema.Number),
  email: Schema.optionalKey(Schema.String),
  tokens: Schema.Struct({
    id_token: NonEmptyString,
    access_token: NonEmptyString,
    refresh_token: NonEmptyString,
    account_id: NonEmptyString,
  }),
  last_refresh: Schema.optionalKey(NonEmptyString),
});

const decodeAuthFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ChatGptAuthFile));

export class ChatGptCredentialError extends Schema.TaggedErrorClass<ChatGptCredentialError>()(
  "ChatGptCredentialError",
  {
    operation: Schema.Literals(["prepare", "read", "decode", "remove"]),
    message: Schema.String,
  },
) {}

export interface ChatGptCredential {
  readonly accessToken: Redacted.Redacted<string>;
  readonly refreshToken: Redacted.Redacted<string>;
  readonly idToken: Redacted.Redacted<string>;
  readonly accountId: string;
  readonly lastRefresh?: string;
}

export interface ChatGptCredentialStore {
  readonly home: string;
  readonly authFilePath: string;
  readonly prepare: Effect.Effect<void, ChatGptCredentialError>;
  readonly read: Effect.Effect<Option.Option<ChatGptCredential>, ChatGptCredentialError>;
  readonly remove: Effect.Effect<void, ChatGptCredentialError>;
}

const credentialError = (
  operation: ChatGptCredentialError["operation"],
  message: string,
): ChatGptCredentialError => new ChatGptCredentialError({ operation, message });

export const makeChatGptCredentialStore = Effect.fn("makeChatGptCredentialStore")(function* (
  instanceId: ProviderInstanceId,
): Effect.fn.Return<
  ChatGptCredentialStore,
  never,
  FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const providersDirectory = path.join(serverConfig.secretsDir, "providers");
  const chatGptDirectory = path.join(providersDirectory, "chatgpt");
  const instanceDirectory = path.join(chatGptDirectory, instanceId);
  const home = path.join(instanceDirectory, "codex-home");
  const authFilePath = path.join(home, "auth.json");
  const securedDirectories = [
    serverConfig.secretsDir,
    providersDirectory,
    chatGptDirectory,
    instanceDirectory,
    home,
  ];

  const prepare = Effect.forEach(
    securedDirectories,
    (directory) =>
      fileSystem
        .makeDirectory(directory, { recursive: true, mode: 0o700 })
        .pipe(Effect.andThen(fileSystem.chmod(directory, 0o700))),
    { discard: true },
  ).pipe(
    Effect.mapError(() =>
      credentialError("prepare", "Could not prepare the isolated ChatGPT credential home"),
    ),
  );

  const read = Effect.gen(function* () {
    yield* prepare;
    const exists = yield* fileSystem
      .exists(authFilePath)
      .pipe(Effect.mapError(() => credentialError("read", "Could not inspect ChatGPT auth.json")));
    if (!exists) {
      return Option.none<ChatGptCredential>();
    }
    yield* fileSystem
      .chmod(authFilePath, 0o600)
      .pipe(Effect.mapError(() => credentialError("read", "Could not secure ChatGPT auth.json")));
    const contents = yield* fileSystem
      .readFileString(authFilePath)
      .pipe(Effect.mapError(() => credentialError("read", "Could not read ChatGPT auth.json")));
    const decoded = yield* decodeAuthFile(contents, { onExcessProperty: "error" }).pipe(
      Effect.mapError(() => credentialError("decode", "ChatGPT auth.json schema is invalid")),
    );
    return Option.some({
      accessToken: Redacted.make(decoded.tokens.access_token),
      refreshToken: Redacted.make(decoded.tokens.refresh_token),
      idToken: Redacted.make(decoded.tokens.id_token),
      accountId: decoded.tokens.account_id,
      ...(decoded.last_refresh === undefined ? {} : { lastRefresh: decoded.last_refresh }),
    });
  });

  const remove = fileSystem
    .remove(authFilePath, { force: true })
    .pipe(Effect.mapError(() => credentialError("remove", "Could not remove ChatGPT auth.json")));

  return { home, authFilePath, prepare, read, remove } satisfies ChatGptCredentialStore;
});
