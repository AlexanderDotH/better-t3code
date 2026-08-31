import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import {
  buildOpenRouterChatCompletionRequest,
  decodeOpenRouterChatCompletionSse,
} from "./OpenRouterChatCompletions.ts";
import {
  decodeOpenRouterModelCatalog,
  mergeOpenRouterCustomModels,
  OpenRouterModelCatalogError,
  type OpenRouterCatalogModel,
} from "./OpenRouterModelCatalog.ts";
import {
  type OpenRouterRoundEvent,
  type OpenRouterRoundRequest,
  type OpenRouterTextCompletion,
} from "./OpenRouterProtocol.ts";
import {
  buildOpenRouterResponsesRequest,
  decodeOpenRouterResponsesSse,
} from "./OpenRouterResponses.ts";
import { OpenRouterProtocolError } from "./OpenRouterSse.ts";

export const OPENROUTER_API_ORIGIN = "https://openrouter.ai/api/v1";
const OPENROUTER_ORIGIN = new URL(OPENROUTER_API_ORIGIN).origin;
const OPENROUTER_API_PATH = new URL(OPENROUTER_API_ORIGIN).pathname;
const MAX_SAME_ORIGIN_REDIRECTS = 2;
const decodeUnknownJson = HttpClientResponse.schemaBodyJson(Schema.Unknown);
const isProtocolError = Schema.is(OpenRouterProtocolError);

export class OpenRouterTransportSecurityError extends Schema.TaggedErrorClass<OpenRouterTransportSecurityError>()(
  "OpenRouterTransportSecurityError",
  { message: Schema.String },
) {}

export class OpenRouterAuthenticationError extends Schema.TaggedErrorClass<OpenRouterAuthenticationError>()(
  "OpenRouterAuthenticationError",
  {
    status: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export class OpenRouterHttpError extends Schema.TaggedErrorClass<OpenRouterHttpError>()(
  "OpenRouterHttpError",
  {
    operation: Schema.Literals(["models", "chat-completions", "responses"]),
    category: Schema.Literals([
      "credits",
      "forbidden",
      "not-found",
      "timeout",
      "payload-too-large",
      "invalid-request",
      "rate-limit",
      "service-unavailable",
      "http",
      "transport",
    ]),
    status: Schema.optionalKey(Schema.Number),
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export type OpenRouterTransportError =
  | OpenRouterTransportSecurityError
  | OpenRouterAuthenticationError
  | OpenRouterHttpError
  | OpenRouterModelCatalogError
  | OpenRouterProtocolError;

const isTransportSecurityError = Schema.is(OpenRouterTransportSecurityError);
const isAuthenticationError = Schema.is(OpenRouterAuthenticationError);
const isHttpError = Schema.is(OpenRouterHttpError);

export interface OpenRouterTransport {
  readonly listModels: (
    customModels: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<OpenRouterCatalogModel>, OpenRouterTransportError>;
  readonly streamRound: (
    request: OpenRouterRoundRequest,
  ) => Stream.Stream<OpenRouterRoundEvent, OpenRouterTransportError>;
}

interface AuthorizedRequest {
  readonly operation: OpenRouterHttpError["operation"];
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: unknown;
}

const parseRetryAfterSeconds = (header: string | undefined): number | undefined => {
  if (header === undefined) return undefined;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
};

const requestUrl = Effect.fn("OpenRouterTransport.requestUrl")(function* (raw: string) {
  const url = yield* Effect.try({
    try: () => new URL(raw),
    catch: () =>
      new OpenRouterTransportSecurityError({ message: "OpenRouter endpoint URL is invalid" }),
  });
  if (
    url.origin !== OPENROUTER_ORIGIN ||
    (url.pathname !== OPENROUTER_API_PATH && !url.pathname.startsWith(`${OPENROUTER_API_PATH}/`))
  ) {
    return yield* new OpenRouterTransportSecurityError({
      message: "OpenRouter request endpoint is outside the fixed API origin",
    });
  }
  return url;
});

const makeRequest = Effect.fn("OpenRouterTransport.makeRequest")(function* (
  input: AuthorizedRequest,
  apiKey: Redacted.Redacted<string>,
) {
  const base =
    input.method === "GET" ? HttpClientRequest.get(input.url) : HttpClientRequest.post(input.url);
  const withHeaders = base.pipe(
    HttpClientRequest.bearerToken(Redacted.value(apiKey)),
    HttpClientRequest.setHeader("user-agent", "t3code-openrouter"),
    HttpClientRequest.setHeader(
      "accept",
      input.method === "GET" ? "application/json" : "text/event-stream",
    ),
  );
  if (input.body === undefined) return withHeaders;
  return yield* HttpClientRequest.bodyJson(withHeaders, input.body).pipe(
    Effect.mapError(
      () =>
        new OpenRouterHttpError({
          operation: input.operation,
          category: "invalid-request",
          message: "OpenRouter request body is not valid JSON",
        }),
    ),
  );
});

const statusError = (
  operation: OpenRouterHttpError["operation"],
  response: HttpClientResponse.HttpClientResponse,
): OpenRouterAuthenticationError | OpenRouterHttpError => {
  const status = response.status;
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers["retry-after"]);
  if (status === 401) {
    return new OpenRouterAuthenticationError({
      status,
      message:
        operation === "models"
          ? "OpenRouter rejected the configured API key"
          : "OpenRouter rejected authentication for this inference request. Use a standard inference API key, not a Management API key",
    });
  }
  const details =
    status === 402
      ? (["credits", "OpenRouter credits are exhausted"] as const)
      : status === 403
        ? (["forbidden", "OpenRouter denied this request"] as const)
        : status === 404
          ? ([
              "not-found",
              operation === "models"
                ? "OpenRouter model catalog endpoint was not found"
                : "OpenRouter could not route the selected model with the required request capabilities",
            ] as const)
          : status === 408
            ? (["timeout", "OpenRouter request timed out"] as const)
            : status === 413
              ? (["payload-too-large", "OpenRouter request exceeded the payload limit"] as const)
              : status === 422
                ? (["invalid-request", "OpenRouter rejected the request parameters"] as const)
                : status === 429
                  ? (["rate-limit", "OpenRouter rate limit was reached"] as const)
                  : status >= 500
                    ? (["service-unavailable", "OpenRouter service is unavailable"] as const)
                    : (["http", `OpenRouter returned HTTP ${status}`] as const);
  return new OpenRouterHttpError({
    operation,
    category: details[0],
    status,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    message: details[1],
  });
};

const requireSuccess = Effect.fn("OpenRouterTransport.requireSuccess")(function* (
  operation: OpenRouterHttpError["operation"],
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return response;
  return yield* statusError(operation, response);
});

const abortSignalEffect = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = () => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

export const makeOpenRouterTransport = Effect.fn("makeOpenRouterTransport")(function* (input: {
  readonly resolveApiKey: Effect.Effect<Redacted.Redacted<string>, OpenRouterAuthenticationError>;
}): Effect.fn.Return<OpenRouterTransport, never, HttpClient.HttpClient> {
  const httpClient = yield* HttpClient.HttpClient;

  const executeOnce = Effect.fn("OpenRouterTransport.executeOnce")(function* (
    request: AuthorizedRequest,
    apiKey: Redacted.Redacted<string>,
    redirects = 0,
  ): Effect.fn.Return<
    HttpClientResponse.HttpClientResponse,
    OpenRouterTransportSecurityError | OpenRouterHttpError
  > {
    const url = yield* requestUrl(request.url);
    const httpRequest = yield* makeRequest(request, apiKey);
    const response = yield* httpClient.execute(httpRequest).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(
        () =>
          new OpenRouterHttpError({
            operation: request.operation,
            category: "transport",
            message: "OpenRouter request transport failed",
          }),
      ),
    );
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.location;
    if (location === undefined) {
      return yield* new OpenRouterHttpError({
        operation: request.operation,
        category: "http",
        status: response.status,
        message: "OpenRouter redirect omitted its destination",
      });
    }
    const redirectUrl = yield* Effect.try({
      try: () => new URL(location, url),
      catch: () =>
        new OpenRouterTransportSecurityError({
          message: "OpenRouter redirect URL is invalid",
        }),
    });
    if (
      redirectUrl.origin !== OPENROUTER_ORIGIN ||
      (redirectUrl.pathname !== OPENROUTER_API_PATH &&
        !redirectUrl.pathname.startsWith(`${OPENROUTER_API_PATH}/`))
    ) {
      return yield* new OpenRouterTransportSecurityError({
        message: "OpenRouter cross-origin redirect was rejected",
      });
    }
    if (redirects >= MAX_SAME_ORIGIN_REDIRECTS) {
      return yield* new OpenRouterHttpError({
        operation: request.operation,
        category: "http",
        status: response.status,
        message: "OpenRouter returned too many redirects",
      });
    }
    return yield* executeOnce({ ...request, url: redirectUrl.toString() }, apiKey, redirects + 1);
  });

  const execute = Effect.fn("OpenRouterTransport.execute")(function* (
    request: AuthorizedRequest,
  ): Effect.fn.Return<HttpClientResponse.HttpClientResponse, OpenRouterTransportError> {
    const apiKey = yield* input.resolveApiKey;
    return yield* executeOnce(request, apiKey);
  });

  const listModels: OpenRouterTransport["listModels"] = (customModels) =>
    execute({
      operation: "models",
      method: "GET",
      url: `${OPENROUTER_API_ORIGIN}/models?output_modalities=all`,
    }).pipe(
      Effect.flatMap((response) => requireSuccess("models", response)),
      Effect.flatMap(decodeUnknownJson),
      Effect.mapError(
        (error): OpenRouterTransportError =>
          isTransportSecurityError(error) || isAuthenticationError(error) || isHttpError(error)
            ? error
            : new OpenRouterHttpError({
                operation: "models",
                category: "transport",
                message: "OpenRouter model catalog response is not valid JSON",
              }),
      ),
      Effect.flatMap(decodeOpenRouterModelCatalog),
      Effect.map((models) => mergeOpenRouterCustomModels(models, customModels)),
    );

  const streamRound: OpenRouterTransport["streamRound"] = (round) => {
    if (round.signal?.aborted) return Stream.empty;
    const operation = round.settings.protocol;
    const stream = Stream.unwrap(
      Effect.gen(function* () {
        const body =
          operation === "chat-completions"
            ? yield* buildOpenRouterChatCompletionRequest(round)
            : yield* buildOpenRouterResponsesRequest(round);
        const response = yield* execute({
          operation,
          method: "POST",
          url: `${OPENROUTER_API_ORIGIN}/${
            operation === "chat-completions" ? "chat/completions" : "responses"
          }`,
          body,
        });
        const success = yield* requireSuccess(operation, response);
        const decoded =
          operation === "chat-completions"
            ? decodeOpenRouterChatCompletionSse(success.stream)
            : decodeOpenRouterResponsesSse(success.stream);
        return decoded.pipe(
          Stream.mapError(
            (error): OpenRouterTransportError =>
              isProtocolError(error)
                ? error
                : new OpenRouterHttpError({
                    operation,
                    category: "transport",
                    message: "OpenRouter response stream failed",
                  }),
          ),
        );
      }),
    );
    return round.signal === undefined
      ? stream
      : stream.pipe(Stream.interruptWhen(abortSignalEffect(round.signal)));
  };

  return { listModels, streamRound };
});

export const completeOpenRouterText = Effect.fn("completeOpenRouterText")(function* (
  transport: OpenRouterTransport,
  request: OpenRouterRoundRequest,
): Effect.fn.Return<OpenRouterTextCompletion, OpenRouterTransportError> {
  const events = yield* transport.streamRound({ ...request, tools: [] }).pipe(Stream.runCollect);
  const completed = events.find((event) => event.type === "completed");
  if (completed === undefined || completed.type !== "completed") {
    return yield* new OpenRouterProtocolError({
      protocol: request.settings.protocol,
      message: "OpenRouter text generation ended without a completed response",
    });
  }
  if (completed.toolCalls.length > 0) {
    return yield* new OpenRouterProtocolError({
      protocol: request.settings.protocol,
      message: "OpenRouter text generation unexpectedly returned tool calls",
    });
  }
  const text = completed.assistantText?.trim() ?? "";
  if (!text) {
    return yield* new OpenRouterProtocolError({
      protocol: request.settings.protocol,
      message: "OpenRouter text generation returned no text",
    });
  }
  return {
    text,
    model: completed.model,
    ...(completed.usage === undefined ? {} : { usage: completed.usage }),
    ...(completed.totalCostUsd === undefined ? {} : { totalCostUsd: completed.totalCostUsd }),
  };
});
