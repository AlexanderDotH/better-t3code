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
  decodeOpenAiModelCatalog,
  OpenAiModelCatalogError,
  type OpenAiCatalogModel,
} from "./OpenAiModelCatalog.ts";
import type {
  OpenAiRoundEvent,
  OpenAiRoundRequest,
  OpenAiTextCompletion,
} from "./OpenAiProtocol.ts";
import {
  buildOpenAiResponsesRequest,
  decodeOpenAiResponsesSse,
  OpenAiProtocolError,
} from "./OpenAiResponses.ts";

export const OPENAI_API_ORIGIN = "https://api.openai.com/v1";
const OPENAI_ORIGIN = new URL(OPENAI_API_ORIGIN).origin;
const OPENAI_API_PATH = new URL(OPENAI_API_ORIGIN).pathname;
const MAX_SAME_ORIGIN_REDIRECTS = 2;
const decodeUnknownJson = HttpClientResponse.schemaBodyJson(Schema.Unknown);
const isProtocolError = Schema.is(OpenAiProtocolError);

export class OpenAiTransportSecurityError extends Schema.TaggedErrorClass<OpenAiTransportSecurityError>()(
  "OpenAiTransportSecurityError",
  { message: Schema.String },
) {}

export class OpenAiAuthenticationError extends Schema.TaggedErrorClass<OpenAiAuthenticationError>()(
  "OpenAiAuthenticationError",
  { status: Schema.optionalKey(Schema.Number), message: Schema.String },
) {}

export class OpenAiHttpError extends Schema.TaggedErrorClass<OpenAiHttpError>()("OpenAiHttpError", {
  operation: Schema.Literals(["models", "responses"]),
  category: Schema.Literals([
    "forbidden",
    "not-found",
    "timeout",
    "conflict",
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
}) {}

export type OpenAiTransportError =
  | OpenAiTransportSecurityError
  | OpenAiAuthenticationError
  | OpenAiHttpError
  | OpenAiModelCatalogError
  | OpenAiProtocolError;

const isSecurityError = Schema.is(OpenAiTransportSecurityError);
const isAuthenticationError = Schema.is(OpenAiAuthenticationError);
const isHttpError = Schema.is(OpenAiHttpError);

export interface OpenAiTransport {
  readonly listModels: Effect.Effect<ReadonlyArray<OpenAiCatalogModel>, OpenAiTransportError>;
  readonly streamRound: (
    request: OpenAiRoundRequest,
  ) => Stream.Stream<OpenAiRoundEvent, OpenAiTransportError>;
}

interface AuthorizedRequest {
  readonly operation: OpenAiHttpError["operation"];
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: unknown;
}

const parseRetryAfterSeconds = (header: string | undefined): number | undefined => {
  if (header === undefined) return undefined;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
};

const requestUrl = Effect.fn("OpenAiTransport.requestUrl")(function* (raw: string) {
  const url = yield* Effect.try({
    try: () => new URL(raw),
    catch: () => new OpenAiTransportSecurityError({ message: "OpenAI endpoint URL is invalid" }),
  });
  if (
    url.origin !== OPENAI_ORIGIN ||
    (url.pathname !== OPENAI_API_PATH && !url.pathname.startsWith(`${OPENAI_API_PATH}/`))
  ) {
    return yield* new OpenAiTransportSecurityError({
      message: "OpenAI request endpoint is outside the fixed API origin",
    });
  }
  return url;
});

const makeRequest = Effect.fn("OpenAiTransport.makeRequest")(function* (
  input: AuthorizedRequest,
  apiKey: Redacted.Redacted<string>,
) {
  const base =
    input.method === "GET" ? HttpClientRequest.get(input.url) : HttpClientRequest.post(input.url);
  const withHeaders = base.pipe(
    HttpClientRequest.bearerToken(Redacted.value(apiKey)),
    HttpClientRequest.setHeader("user-agent", "t3code-openai-responses"),
    HttpClientRequest.setHeader(
      "accept",
      input.method === "GET" ? "application/json" : "text/event-stream",
    ),
  );
  if (input.body === undefined) return withHeaders;
  return yield* HttpClientRequest.bodyJson(withHeaders, input.body).pipe(
    Effect.mapError(
      () =>
        new OpenAiHttpError({
          operation: input.operation,
          category: "invalid-request",
          message: "OpenAI request body is not valid JSON",
        }),
    ),
  );
});

const statusError = (
  operation: OpenAiHttpError["operation"],
  response: HttpClientResponse.HttpClientResponse,
): OpenAiAuthenticationError | OpenAiHttpError => {
  const status = response.status;
  if (status === 401) {
    return new OpenAiAuthenticationError({
      status,
      message: "OpenAI rejected the configured API key",
    });
  }
  const detail =
    status === 403
      ? (["forbidden", "OpenAI denied this request"] as const)
      : status === 404
        ? (["not-found", "OpenAI endpoint or selected model was not found"] as const)
        : status === 408
          ? (["timeout", "OpenAI request timed out"] as const)
          : status === 409
            ? (["conflict", "OpenAI could not complete this request yet"] as const)
            : status === 413
              ? (["payload-too-large", "OpenAI request exceeded the payload limit"] as const)
              : status === 400 || status === 422
                ? (["invalid-request", "OpenAI rejected the request parameters"] as const)
                : status === 429
                  ? (["rate-limit", "OpenAI rate limit was reached"] as const)
                  : status >= 500
                    ? (["service-unavailable", "OpenAI service is unavailable"] as const)
                    : (["http", `OpenAI returned HTTP ${status}`] as const);
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers["retry-after"]);
  return new OpenAiHttpError({
    operation,
    category: detail[0],
    status,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    message: detail[1],
  });
};

const requireSuccess = Effect.fn("OpenAiTransport.requireSuccess")(function* (
  operation: OpenAiHttpError["operation"],
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

export const makeOpenAiTransport = Effect.fn("makeOpenAiTransport")(function* (input: {
  readonly resolveApiKey: Effect.Effect<Redacted.Redacted<string>, OpenAiAuthenticationError>;
}): Effect.fn.Return<OpenAiTransport, never, HttpClient.HttpClient> {
  const httpClient = yield* HttpClient.HttpClient;

  const executeOnce = Effect.fn("OpenAiTransport.executeOnce")(function* (
    request: AuthorizedRequest,
    apiKey: Redacted.Redacted<string>,
    redirects = 0,
  ): Effect.fn.Return<
    HttpClientResponse.HttpClientResponse,
    OpenAiTransportSecurityError | OpenAiHttpError
  > {
    const url = yield* requestUrl(request.url);
    const httpRequest = yield* makeRequest(request, apiKey);
    const response = yield* httpClient.execute(httpRequest).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(
        () =>
          new OpenAiHttpError({
            operation: request.operation,
            category: "transport",
            message: "OpenAI request transport failed",
          }),
      ),
    );
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.location;
    if (location === undefined) {
      return yield* new OpenAiHttpError({
        operation: request.operation,
        category: "http",
        status: response.status,
        message: "OpenAI redirect omitted its destination",
      });
    }
    const redirectUrl = yield* Effect.try({
      try: () => new URL(location, url),
      catch: () => new OpenAiTransportSecurityError({ message: "OpenAI redirect URL is invalid" }),
    });
    if (
      redirectUrl.origin !== OPENAI_ORIGIN ||
      (redirectUrl.pathname !== OPENAI_API_PATH &&
        !redirectUrl.pathname.startsWith(`${OPENAI_API_PATH}/`))
    ) {
      return yield* new OpenAiTransportSecurityError({
        message: "OpenAI cross-origin redirect was rejected",
      });
    }
    if (redirects >= MAX_SAME_ORIGIN_REDIRECTS) {
      return yield* new OpenAiHttpError({
        operation: request.operation,
        category: "http",
        status: response.status,
        message: "OpenAI returned too many redirects",
      });
    }
    return yield* executeOnce({ ...request, url: redirectUrl.toString() }, apiKey, redirects + 1);
  });

  const execute = Effect.fn("OpenAiTransport.execute")(function* (request: AuthorizedRequest) {
    const apiKey = yield* input.resolveApiKey;
    return yield* executeOnce(request, apiKey);
  });

  const listModels = execute({
    operation: "models",
    method: "GET",
    url: `${OPENAI_API_ORIGIN}/models`,
  }).pipe(
    Effect.flatMap((response) => requireSuccess("models", response)),
    Effect.flatMap(decodeUnknownJson),
    Effect.mapError(
      (error): OpenAiTransportError =>
        isSecurityError(error) || isAuthenticationError(error) || isHttpError(error)
          ? error
          : new OpenAiHttpError({
              operation: "models",
              category: "transport",
              message: "OpenAI model catalog response is not valid JSON",
            }),
    ),
    Effect.flatMap(decodeOpenAiModelCatalog),
  );

  const streamRound: OpenAiTransport["streamRound"] = (round) => {
    if (round.signal?.aborted) return Stream.empty;
    const stream = Stream.unwrap(
      Effect.gen(function* () {
        const response = yield* execute({
          operation: "responses",
          method: "POST",
          url: `${OPENAI_API_ORIGIN}/responses`,
          body: buildOpenAiResponsesRequest(round),
        });
        const success = yield* requireSuccess("responses", response);
        return decodeOpenAiResponsesSse(success.stream).pipe(
          Stream.mapError(
            (error): OpenAiTransportError =>
              isProtocolError(error)
                ? error
                : new OpenAiHttpError({
                    operation: "responses",
                    category: "transport",
                    message: "OpenAI response stream failed",
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

export const completeOpenAiText = Effect.fn("completeOpenAiText")(function* (
  transport: OpenAiTransport,
  request: OpenAiRoundRequest,
): Effect.fn.Return<OpenAiTextCompletion, OpenAiTransportError> {
  const events = yield* transport.streamRound({ ...request, tools: [] }).pipe(Stream.runCollect);
  const completed = events.find((event) => event.type === "completed");
  if (completed === undefined || completed.type !== "completed") {
    return yield* new OpenAiProtocolError({
      message: "OpenAI text generation ended without a completed response",
    });
  }
  if (completed.toolCalls.length > 0) {
    return yield* new OpenAiProtocolError({
      message: "OpenAI text generation unexpectedly returned tool calls",
    });
  }
  const text = completed.assistantText?.trim() ?? "";
  if (!text) {
    return yield* new OpenAiProtocolError({ message: "OpenAI text generation returned no text" });
  }
  return {
    text,
    model: completed.model,
    ...(completed.usage === undefined ? {} : { usage: completed.usage }),
  };
});
