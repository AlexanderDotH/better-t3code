import { type ProviderInstanceEnvironment, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";

const OPENAI_API_KEY = "OPENAI_API_KEY";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export class OpenAiCredentialStoreError extends Schema.TaggedErrorClass<OpenAiCredentialStoreError>()(
  "OpenAiCredentialStoreError",
  {
    operation: Schema.Literals(["read", "write", "remove", "resolve"]),
    message: Schema.String,
  },
) {}

export type OpenAiCredentialSource = "stored" | "environment";

export interface OpenAiResolvedCredential {
  readonly apiKey: Redacted.Redacted<string>;
  readonly source: OpenAiCredentialSource;
}

export interface OpenAiCredentialStore {
  readonly instanceId: ProviderInstanceId;
  readonly readStored: Effect.Effect<
    Option.Option<Redacted.Redacted<string>>,
    OpenAiCredentialStoreError
  >;
  readonly resolveOption: Effect.Effect<
    Option.Option<OpenAiResolvedCredential>,
    OpenAiCredentialStoreError
  >;
  readonly resolve: Effect.Effect<OpenAiResolvedCredential, OpenAiCredentialStoreError>;
  readonly setStored: (apiKey: string) => Effect.Effect<void, OpenAiCredentialStoreError>;
  readonly removeStored: Effect.Effect<void, OpenAiCredentialStoreError>;
}

export function openAiApiKeySecretName(instanceId: ProviderInstanceId | string): string {
  const encodedInstanceId = Buffer.from(instanceId, "utf8").toString("base64url");
  return `provider-openai-api-key-${encodedInstanceId}`;
}

function explicitEnvironmentApiKey(
  environment: ProviderInstanceEnvironment,
): Option.Option<Redacted.Redacted<string>> {
  const value = environment
    .find((variable) => variable.name === OPENAI_API_KEY && variable.sensitive)
    ?.value.trim();
  return value ? Option.some(Redacted.make(value)) : Option.none();
}

const storeError = (
  operation: OpenAiCredentialStoreError["operation"],
  message: string,
): OpenAiCredentialStoreError => new OpenAiCredentialStoreError({ operation, message });

export const makeOpenAiCredentialStore = Effect.fn("makeOpenAiCredentialStore")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly environment: ProviderInstanceEnvironment;
}): Effect.fn.Return<OpenAiCredentialStore, never, ServerSecretStore.ServerSecretStore> {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const secretName = openAiApiKeySecretName(input.instanceId);
  const environmentApiKey = explicitEnvironmentApiKey(input.environment);

  const readStored = Effect.suspend(() => secrets.get(secretName)).pipe(
    Effect.map(Option.map((bytes) => Redacted.make(textDecoder.decode(bytes).trim()))),
    Effect.map(Option.filter((value) => Redacted.value(value).length > 0)),
    Effect.mapError(() => storeError("read", "Could not read the stored OpenAI API key.")),
  );

  const resolveOption = readStored.pipe(
    Effect.map(
      Option.match({
        onSome: (apiKey): Option.Option<OpenAiResolvedCredential> =>
          Option.some({ apiKey, source: "stored" }),
        onNone: (): Option.Option<OpenAiResolvedCredential> =>
          Option.map(environmentApiKey, (apiKey) => ({ apiKey, source: "environment" })),
      }),
    ),
  );

  const resolve = resolveOption.pipe(
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(
            storeError(
              "resolve",
              "Set an OpenAI API key or configure OPENAI_API_KEY in this provider instance's environment.",
            ),
          ),
      }),
    ),
  );

  const setStored: OpenAiCredentialStore["setStored"] = Effect.fn(
    "OpenAiCredentialStore.setStored",
  )(function* (apiKey) {
    const normalized = apiKey.trim();
    if (!normalized) {
      return yield* storeError("write", "OpenAI API key must not be empty.");
    }
    yield* secrets
      .set(secretName, textEncoder.encode(normalized))
      .pipe(
        Effect.mapError(() =>
          storeError("write", "Could not persist the OpenAI API key securely."),
        ),
      );
  });

  const removeStored = secrets
    .remove(secretName)
    .pipe(
      Effect.mapError(() => storeError("remove", "Could not remove the stored OpenAI API key.")),
    );

  return {
    instanceId: input.instanceId,
    readStored,
    resolveOption,
    resolve,
    setStored,
    removeStored,
  } satisfies OpenAiCredentialStore;
});
