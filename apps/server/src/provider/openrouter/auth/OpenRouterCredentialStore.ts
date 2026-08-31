import { type ProviderInstanceEnvironment, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";

const OPENROUTER_API_KEY = "OPENROUTER_API_KEY";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export class OpenRouterCredentialStoreError extends Schema.TaggedErrorClass<OpenRouterCredentialStoreError>()(
  "OpenRouterCredentialStoreError",
  {
    operation: Schema.Literals(["read", "write", "remove", "resolve"]),
    message: Schema.String,
  },
) {}

export type OpenRouterCredentialSource = "stored" | "environment";

export interface OpenRouterResolvedCredential {
  readonly apiKey: Redacted.Redacted<string>;
  readonly source: OpenRouterCredentialSource;
}

export interface OpenRouterCredentialStore {
  readonly instanceId: ProviderInstanceId;
  readonly readStored: Effect.Effect<
    Option.Option<Redacted.Redacted<string>>,
    OpenRouterCredentialStoreError
  >;
  readonly resolveOption: Effect.Effect<
    Option.Option<OpenRouterResolvedCredential>,
    OpenRouterCredentialStoreError
  >;
  readonly resolve: Effect.Effect<OpenRouterResolvedCredential, OpenRouterCredentialStoreError>;
  readonly setStored: (apiKey: string) => Effect.Effect<void, OpenRouterCredentialStoreError>;
  readonly removeStored: Effect.Effect<void, OpenRouterCredentialStoreError>;
}

export function openRouterApiKeySecretName(instanceId: ProviderInstanceId | string): string {
  const encodedInstanceId = Buffer.from(instanceId, "utf8").toString("base64url");
  return `provider-openrouter-api-key-${encodedInstanceId}`;
}

function explicitEnvironmentApiKey(
  environment: ProviderInstanceEnvironment,
): Option.Option<Redacted.Redacted<string>> {
  const value = environment
    .find((variable) => variable.name === OPENROUTER_API_KEY && variable.sensitive)
    ?.value.trim();
  return value ? Option.some(Redacted.make(value)) : Option.none();
}

const storeError = (
  operation: OpenRouterCredentialStoreError["operation"],
  message: string,
): OpenRouterCredentialStoreError => new OpenRouterCredentialStoreError({ operation, message });

export const makeOpenRouterCredentialStore = Effect.fn("makeOpenRouterCredentialStore")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly environment: ProviderInstanceEnvironment;
  }): Effect.fn.Return<OpenRouterCredentialStore, never, ServerSecretStore.ServerSecretStore> {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const secretName = openRouterApiKeySecretName(input.instanceId);
    const environmentApiKey = explicitEnvironmentApiKey(input.environment);

    const readStored = Effect.suspend(() => secrets.get(secretName)).pipe(
      Effect.map(Option.map((bytes) => Redacted.make(textDecoder.decode(bytes).trim()))),
      Effect.map(Option.filter((value) => Redacted.value(value).length > 0)),
      Effect.mapError(() => storeError("read", "Could not read the stored OpenRouter API key.")),
    );

    const resolveOption = readStored.pipe(
      Effect.map(
        Option.match({
          onSome: (apiKey): Option.Option<OpenRouterResolvedCredential> =>
            Option.some({ apiKey, source: "stored" }),
          onNone: (): Option.Option<OpenRouterResolvedCredential> =>
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
                "Set an OpenRouter API key or configure OPENROUTER_API_KEY in this provider instance's environment.",
              ),
            ),
        }),
      ),
    );

    const setStored: OpenRouterCredentialStore["setStored"] = Effect.fn(
      "OpenRouterCredentialStore.setStored",
    )(function* (apiKey) {
      const normalized = apiKey.trim();
      if (!normalized) {
        return yield* storeError("write", "OpenRouter API key must not be empty.");
      }
      yield* secrets
        .set(secretName, textEncoder.encode(normalized))
        .pipe(
          Effect.mapError(() =>
            storeError("write", "Could not persist the OpenRouter API key securely."),
          ),
        );
    });

    const removeStored = secrets
      .remove(secretName)
      .pipe(
        Effect.mapError(() =>
          storeError("remove", "Could not remove the stored OpenRouter API key."),
        ),
      );

    return {
      instanceId: input.instanceId,
      readStored,
      resolveOption,
      resolve,
      setStored,
      removeStored,
    } satisfies OpenRouterCredentialStore;
  },
);
