import * as Generated from "@effect/ai-openrouter/Generated";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { OPENROUTER_API_ORIGIN } from "../OpenRouterTransport.ts";

const OPENROUTER_ORIGIN = new URL(OPENROUTER_API_ORIGIN).origin;
const OPENROUTER_CURRENT_KEY_URL = `${OPENROUTER_API_ORIGIN}/key`;
const MAX_SAME_ORIGIN_REDIRECTS = 2;

const decodeCurrentKeyResponse = HttpClientResponse.schemaBodyJson(Generated.GetCurrentKey200);

export class OpenRouterKeyValidationError extends Schema.TaggedErrorClass<OpenRouterKeyValidationError>()(
  "OpenRouterKeyValidationError",
  {
    code: Schema.Literals([
      "credential-invalid",
      "credential-not-inference",
      "security",
      "transport",
      "response-invalid",
      "request-failed",
    ]),
    status: Schema.optionalKey(Schema.Number),
    retryable: Schema.Boolean,
    message: Schema.String,
  },
) {}

export interface OpenRouterKeyProfile {
  readonly label: string;
  readonly isFreeTier: boolean;
  readonly expiresAt?: string;
}

export interface OpenRouterKeyValidator {
  readonly validate: (
    apiKey: Redacted.Redacted<string>,
  ) => Effect.Effect<OpenRouterKeyProfile, OpenRouterKeyValidationError>;
}

export function maskOpenRouterKeyLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length < 9) return "••••";
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

const validationError = (input: {
  readonly code: OpenRouterKeyValidationError["code"];
  readonly message: string;
  readonly retryable: boolean;
  readonly status?: number;
}) => new OpenRouterKeyValidationError(input);

export const makeOpenRouterKeyValidator = Effect.fn("makeOpenRouterKeyValidator")(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const execute = Effect.fn("OpenRouterKeyValidator.execute")(function* (
    apiKey: Redacted.Redacted<string>,
    url: string,
    redirects = 0,
  ): Effect.fn.Return<HttpClientResponse.HttpClientResponse, OpenRouterKeyValidationError> {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: () =>
        validationError({
          code: "security",
          message: "OpenRouter key validation URL is invalid.",
          retryable: false,
        }),
    });
    if (parsedUrl.origin !== OPENROUTER_ORIGIN) {
      return yield* validationError({
        code: "security",
        message: "OpenRouter key validation rejected a non-allowlisted origin.",
        retryable: false,
      });
    }

    const request = HttpClientRequest.get(parsedUrl.toString()).pipe(
      HttpClientRequest.bearerToken(Redacted.value(apiKey)),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.setHeader("user-agent", "t3code_openrouter"),
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(() =>
        validationError({
          code: "transport",
          message: "OpenRouter key validation request failed.",
          retryable: true,
        }),
      ),
    );
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.location;
    if (!location || redirects >= MAX_SAME_ORIGIN_REDIRECTS) {
      return yield* validationError({
        code: "security",
        message: "OpenRouter key validation returned an unsafe redirect.",
        retryable: false,
      });
    }
    const redirectUrl = yield* Effect.try({
      try: () => new URL(location, parsedUrl),
      catch: () =>
        validationError({
          code: "security",
          message: "OpenRouter key validation redirect is invalid.",
          retryable: false,
        }),
    });
    if (redirectUrl.origin !== OPENROUTER_ORIGIN) {
      return yield* validationError({
        code: "security",
        message: "OpenRouter key validation rejected a cross-origin redirect.",
        retryable: false,
      });
    }
    return yield* execute(apiKey, redirectUrl.toString(), redirects + 1);
  });

  const validate: OpenRouterKeyValidator["validate"] = Effect.fn("OpenRouterKeyValidator.validate")(
    function* (apiKey) {
      const response = yield* execute(apiKey, OPENROUTER_CURRENT_KEY_URL);
      if (response.status === 401 || response.status === 403) {
        return yield* validationError({
          code: "credential-invalid",
          status: response.status,
          message: "OpenRouter rejected this API key.",
          retryable: false,
        });
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* validationError({
          code: "request-failed",
          status: response.status,
          message: `OpenRouter key validation failed with HTTP ${response.status}.`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        });
      }

      const decoded = yield* decodeCurrentKeyResponse(response).pipe(
        Effect.mapError(() =>
          validationError({
            code: "response-invalid",
            message: "OpenRouter returned an invalid current-key response.",
            retryable: false,
          }),
        ),
      );
      if (decoded.data.is_management_key || decoded.data.is_provisioning_key) {
        return yield* validationError({
          code: "credential-not-inference",
          message:
            "OpenRouter Management API keys cannot be used with model completion endpoints. Create a standard inference API key on OpenRouter's Keys page.",
          retryable: false,
        });
      }
      return {
        label: maskOpenRouterKeyLabel(decoded.data.label),
        isFreeTier: decoded.data.is_free_tier,
        ...(decoded.data.expires_at ? { expiresAt: decoded.data.expires_at } : {}),
      } satisfies OpenRouterKeyProfile;
    },
  );

  return { validate } satisfies OpenRouterKeyValidator;
});
