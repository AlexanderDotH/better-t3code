import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import {
  makeOpenAiTransport,
  OpenAiAuthenticationError,
  OpenAiHttpError,
  OpenAiTransportSecurityError,
} from "../OpenAiTransport.ts";
import { OpenAiModelCatalogError } from "../OpenAiModelCatalog.ts";

export class OpenAiKeyValidationError extends Schema.TaggedErrorClass<OpenAiKeyValidationError>()(
  "OpenAiKeyValidationError",
  {
    code: Schema.Literals([
      "credential-invalid",
      "rate-limited",
      "security",
      "transport",
      "response-invalid",
      "request-failed",
    ]),
    status: Schema.optionalKey(Schema.Number),
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
    retryable: Schema.Boolean,
    message: Schema.String,
  },
) {}

export interface OpenAiKeyProfile {
  readonly label: string;
  readonly supportedModelCount: number;
}

export interface OpenAiKeyValidator {
  readonly validate: (
    apiKey: Redacted.Redacted<string>,
  ) => Effect.Effect<OpenAiKeyProfile, OpenAiKeyValidationError>;
}

export function maskOpenAiKeyLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length < 9) return "••••";
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

const isAuthenticationError = Schema.is(OpenAiAuthenticationError);
const isHttpError = Schema.is(OpenAiHttpError);
const isSecurityError = Schema.is(OpenAiTransportSecurityError);
const isCatalogError = Schema.is(OpenAiModelCatalogError);

function validationError(cause: unknown): OpenAiKeyValidationError {
  if (isAuthenticationError(cause)) {
    return new OpenAiKeyValidationError({
      code: "credential-invalid",
      ...(cause.status === undefined ? {} : { status: cause.status }),
      retryable: false,
      message: "OpenAI rejected this API key.",
    });
  }
  if (isSecurityError(cause)) {
    return new OpenAiKeyValidationError({
      code: "security",
      retryable: false,
      message: "OpenAI key validation rejected an unsafe endpoint.",
    });
  }
  if (isCatalogError(cause)) {
    return new OpenAiKeyValidationError({
      code: "response-invalid",
      retryable: false,
      message: "OpenAI returned an invalid model catalog.",
    });
  }
  if (isHttpError(cause)) {
    if (cause.category === "rate-limit") {
      return new OpenAiKeyValidationError({
        code: "rate-limited",
        ...(cause.status === undefined ? {} : { status: cause.status }),
        ...(cause.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: cause.retryAfterSeconds }),
        retryable: true,
        message: "OpenAI rate limited key validation.",
      });
    }
    const retryable =
      cause.category === "timeout" ||
      cause.category === "conflict" ||
      cause.category === "service-unavailable" ||
      cause.category === "transport";
    return new OpenAiKeyValidationError({
      code: retryable ? "transport" : "request-failed",
      ...(cause.status === undefined ? {} : { status: cause.status }),
      retryable,
      message: "OpenAI could not validate this API key.",
    });
  }
  return new OpenAiKeyValidationError({
    code: "transport",
    retryable: true,
    message: "OpenAI key validation failed.",
  });
}

export const makeOpenAiKeyValidator = Effect.fn("makeOpenAiKeyValidator")(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const validate: OpenAiKeyValidator["validate"] = Effect.fn("OpenAiKeyValidator.validate")(
    function* (apiKey) {
      const transport = yield* makeOpenAiTransport({ resolveApiKey: Effect.succeed(apiKey) }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      const models = yield* transport.listModels.pipe(Effect.mapError(validationError));
      return {
        label: maskOpenAiKeyLabel(Redacted.value(apiKey)),
        supportedModelCount: models.length,
      };
    },
  );
  return { validate } satisfies OpenAiKeyValidator;
});
