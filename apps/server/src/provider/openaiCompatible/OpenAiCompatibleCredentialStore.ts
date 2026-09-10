import { normalizeAiEndpointBaseUrl, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";

const StoredCredential = Schema.fromJsonString(
  Schema.Struct({
    baseUrl: Schema.String,
    apiKey: Schema.String.check(Schema.isMinLength(1)),
  }),
);
const decodeCredential = Schema.decodeUnknownEffect(StoredCredential);
const encodeCredential = Schema.encodeEffect(StoredCredential);
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export class OpenAiCompatibleCredentialStoreError extends Schema.TaggedError<OpenAiCompatibleCredentialStoreError>()(
  "OpenAiCompatibleCredentialStoreError",
  {
    operation: Schema.Literals(["read", "write", "remove", "resolve"]),
    message: Schema.String,
  },
) {}

export interface OpenAiCompatibleCredentialStore {
  readonly instanceId: ProviderInstanceId;
  readonly baseUrl: string;
  readonly readStored: Effect.Effect<
    Option.Option<Redacted.Redacted<string>>,
    OpenAiCompatibleCredentialStoreError
  >;
  readonly setStored: (apiKey: string) => Effect.Effect<void, OpenAiCompatibleCredentialStoreError>;
  readonly removeStored: Effect.Effect<void, OpenAiCompatibleCredentialStoreError>;
}

export function openAiCompatibleApiKeySecretName(instanceId: ProviderInstanceId | string): string {
  return `provider-openai-compatible-api-key-${Buffer.from(instanceId, "utf8").toString("base64url")}`;
}

const storeError = (
  operation: OpenAiCompatibleCredentialStoreError["operation"],
  message: string,
) => new OpenAiCompatibleCredentialStoreError({ operation, message });

export const makeOpenAiCompatibleCredentialStore = Effect.fn("makeOpenAiCompatibleCredentialStore")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly baseUrl: string;
  }): Effect.fn.Return<
    OpenAiCompatibleCredentialStore,
    OpenAiCompatibleCredentialStoreError,
    ServerSecretStore.ServerSecretStore
  > {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const baseUrl = yield* Effect.try({
      try: () => normalizeAiEndpointBaseUrl(input.baseUrl),
      catch: () =>
        storeError("resolve", "Configure a valid endpoint base URL before using an API key."),
    });
    const secretName = openAiCompatibleApiKeySecretName(input.instanceId);

    const readStored = Effect.gen(function* () {
      const stored = yield* secrets.get(secretName);
      if (Option.isNone(stored)) return Option.none<Redacted.Redacted<string>>();
      const credential = yield* decodeCredential(textDecoder.decode(stored.value));
      return baseUrl && credential.baseUrl === baseUrl
        ? Option.some(Redacted.make(credential.apiKey))
        : Option.none<Redacted.Redacted<string>>();
    }).pipe(
      Effect.mapError(() => storeError("read", "Could not read the stored endpoint API key.")),
    );

    const setStored: OpenAiCompatibleCredentialStore["setStored"] = Effect.fn(
      "OpenAiCompatibleCredentialStore.setStored",
    )(function* (apiKey) {
      const normalized = apiKey.trim();
      if (!baseUrl) {
        return yield* storeError(
          "write",
          "Configure an endpoint base URL before saving an API key.",
        );
      }
      if (!normalized) return yield* storeError("write", "API key must not be empty.");
      const encoded = yield* encodeCredential({ baseUrl, apiKey: normalized }).pipe(
        Effect.mapError(() => storeError("write", "Could not encode the endpoint API key.")),
      );
      yield* secrets
        .set(secretName, textEncoder.encode(encoded))
        .pipe(
          Effect.mapError(() =>
            storeError("write", "Could not persist the endpoint API key securely."),
          ),
        );
    });

    const removeStored = secrets
      .remove(secretName)
      .pipe(
        Effect.mapError(() =>
          storeError("remove", "Could not remove the stored endpoint API key."),
        ),
      );

    return { instanceId: input.instanceId, baseUrl, readStored, setStored, removeStored };
  },
);
