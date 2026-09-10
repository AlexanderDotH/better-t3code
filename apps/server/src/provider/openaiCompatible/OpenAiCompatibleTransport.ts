import { normalizeAiEndpointBaseUrl } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
  decodeLmStudioModelCatalog,
  decodeOpenAiCompatibleModelCatalog,
  OpenAiCompatibleModelCatalogError,
  type OpenAiCompatibleCatalogModel,
} from "./OpenAiCompatibleModelCatalog.ts";
import {
  buildOpenAiCompatibleChatCompletionRequest,
  decodeOpenAiCompatibleChatCompletionSse,
  OpenAiCompatibleProtocolError,
  type OpenAiCompatibleRoundEvent,
  type OpenAiCompatibleRoundRequest,
} from "./OpenAiCompatibleProtocol.ts";

const REQUEST_TIMEOUT = "30 seconds";
const STREAM_IDLE_TIMEOUT = "5 minutes";
const PROBE_TIMEOUT = "2 seconds";
const NATIVE_PROBE_TIMEOUT = "750 millis";
const decodeJson = HttpClientResponse.schemaBodyJson(Schema.Unknown);
const decodeErrorBody = HttpClientResponse.schemaBodyJson(
  Schema.Struct({
    error: Schema.Union([
      Schema.String,
      Schema.Struct({
        code: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
        param: Schema.optionalKey(Schema.NullOr(Schema.String)),
        message: Schema.optionalKey(Schema.String),
      }),
    ]),
  }),
);

export class OpenAiCompatibleTransportSecurityError extends Schema.TaggedError<OpenAiCompatibleTransportSecurityError>()(
  "OpenAiCompatibleTransportSecurityError",
  { message: Schema.String },
) {}

export class OpenAiCompatibleAuthenticationError extends Schema.TaggedError<OpenAiCompatibleAuthenticationError>()(
  "OpenAiCompatibleAuthenticationError",
  { status: Schema.optionalKey(Schema.Number), message: Schema.String },
) {}

export class OpenAiCompatibleHttpError extends Schema.TaggedError<OpenAiCompatibleHttpError>()(
  "OpenAiCompatibleHttpError",
  {
    operation: Schema.Literals(["models", "chat-completions"]),
    category: Schema.Literals([
      "catalog-not-found",
      "model-not-found",
      "tools-not-supported",
      "timeout",
      "rate-limit",
      "network",
      "invalid-request",
      "service-unavailable",
      "http",
    ]),
    status: Schema.optionalKey(Schema.Number),
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export type OpenAiCompatibleTransportError =
  | OpenAiCompatibleTransportSecurityError
  | OpenAiCompatibleAuthenticationError
  | OpenAiCompatibleHttpError
  | OpenAiCompatibleModelCatalogError
  | OpenAiCompatibleProtocolError;

export interface OpenAiCompatibleTransport {
  readonly baseUrl: string;
  readonly listModels: Effect.Effect<
    ReadonlyArray<OpenAiCompatibleCatalogModel>,
    OpenAiCompatibleTransportError
  >;
  readonly streamRound: (
    request: OpenAiCompatibleRoundRequest,
  ) => Stream.Stream<OpenAiCompatibleRoundEvent, OpenAiCompatibleTransportError>;
}

const timeoutError = (operation: OpenAiCompatibleHttpError["operation"]) =>
  new OpenAiCompatibleHttpError({
    operation,
    category: "timeout",
    message: "The endpoint request timed out.",
  });

const requireSuccess = Effect.fn("OpenAiCompatibleTransport.requireSuccess")(function* (
  operation: OpenAiCompatibleHttpError["operation"],
  response: HttpClientResponse.HttpClientResponse,
): Effect.fn.Return<
  HttpClientResponse.HttpClientResponse,
  | OpenAiCompatibleAuthenticationError
  | OpenAiCompatibleHttpError
  | OpenAiCompatibleTransportSecurityError
> {
  const status = response.status;
  if (status >= 200 && status < 300) return response;
  if (status >= 300 && status < 400) {
    return yield* new OpenAiCompatibleTransportSecurityError({
      message: "The endpoint redirected the request. Configure its final API base URL instead.",
    });
  }
  if (status === 401 || status === 403) {
    return yield* new OpenAiCompatibleAuthenticationError({
      status,
      message: "The endpoint requires an API key or rejected the configured key.",
    });
  }
  const details =
    operation === "chat-completions" && [400, 404, 422].includes(status)
      ? yield* decodeErrorBody(response).pipe(
          Effect.map(({ error }) =>
            typeof error === "string" ? error : [error.code, error.param, error.message].join(" "),
          ),
          Effect.orElseSucceed(() => ""),
        )
      : "";
  const category =
    operation === "models" && (status === 404 || status === 405)
      ? "catalog-not-found"
      : /(?:model[_ -]not[_ -]found|unknown[_ -]model|model.*(?:not found|does not exist|not loaded))/i.test(
            details,
          )
        ? "model-not-found"
        : /(?:tools?|function[_ -]?call)/i.test(details) &&
            /(?:unsupported|not support|not available|not allowed|disabled|not enabled|not configured|requires.*(?:enable.*tool|tool.*parser)|(?:unknown|unrecognized).*parameter)/i.test(
              details,
            )
          ? "tools-not-supported"
          : status === 404 && operation === "chat-completions"
            ? "model-not-found"
            : status === 408 || status === 504
              ? "timeout"
              : status === 429
                ? "rate-limit"
                : status === 400 || status === 413 || status === 422
                  ? "invalid-request"
                  : status >= 500
                    ? "service-unavailable"
                    : "http";
  const messages: Record<OpenAiCompatibleHttpError["category"], string> = {
    "catalog-not-found": "The endpoint does not expose a model catalog. Enter a model ID manually.",
    "model-not-found": "The endpoint could not find or load the selected model.",
    "tools-not-supported":
      "The endpoint or selected model does not support function tools required by T3 Code.",
    timeout: "The endpoint request timed out.",
    "rate-limit": "The endpoint rate limit was reached.",
    network: "The endpoint could not be reached.",
    "invalid-request": "The endpoint rejected the request parameters.",
    "service-unavailable": "The endpoint service is unavailable.",
    http: `The endpoint returned HTTP ${status}.`,
  };
  const retryAfter = response.headers["retry-after"];
  const retryAfterSeconds = retryAfter === undefined ? undefined : Number(retryAfter);
  return yield* new OpenAiCompatibleHttpError({
    operation,
    category,
    status,
    ...(retryAfterSeconds !== undefined &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 0
      ? { retryAfterSeconds }
      : {}),
    message: messages[category],
  });
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

export const makeOpenAiCompatibleTransport = Effect.fn("makeOpenAiCompatibleTransport")(
  function* (input: {
    readonly baseUrl: string;
    readonly resolveApiKey: Effect.Effect<
      Option.Option<Redacted.Redacted<string>>,
      OpenAiCompatibleAuthenticationError
    >;
  }): Effect.fn.Return<
    OpenAiCompatibleTransport,
    OpenAiCompatibleTransportSecurityError,
    HttpClient.HttpClient
  > {
    const baseUrl = yield* Effect.try({
      try: () => normalizeAiEndpointBaseUrl(input.baseUrl),
      catch: () =>
        new OpenAiCompatibleTransportSecurityError({
          message: "The endpoint API base URL is invalid.",
        }),
    });
    const httpClient = yield* HttpClient.HttpClient;
    const execute = Effect.fn("OpenAiCompatibleTransport.execute")(
      function* (
        operation: OpenAiCompatibleHttpError["operation"],
        body?: unknown,
      ): Effect.fn.Return<HttpClientResponse.HttpClientResponse, OpenAiCompatibleTransportError> {
        if (!baseUrl) {
          return yield* new OpenAiCompatibleTransportSecurityError({
            message: "Configure the endpoint API base URL before using this provider.",
          });
        }
        const key = yield* input.resolveApiKey;
        let request =
          operation === "models"
            ? HttpClientRequest.get(`${baseUrl}/models`)
            : HttpClientRequest.post(`${baseUrl}/chat/completions`);
        request = request.pipe(
          HttpClientRequest.setHeader(
            "accept",
            operation === "models" ? "application/json" : "text/event-stream",
          ),
        );
        if (Option.isSome(key))
          request = request.pipe(HttpClientRequest.bearerToken(Redacted.value(key.value)));
        if (body !== undefined) {
          request = yield* HttpClientRequest.bodyJson(request, body).pipe(
            Effect.mapError(
              () =>
                new OpenAiCompatibleHttpError({
                  operation,
                  category: "invalid-request",
                  message: "The endpoint request is not valid JSON.",
                }),
            ),
          );
        }
        const response = yield* httpClient.execute(request).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
            credentials: "omit",
          }),
          Effect.mapError(
            () =>
              new OpenAiCompatibleHttpError({
                operation,
                category: "network",
                message: "The endpoint could not be reached.",
              }),
          ),
        );
        return yield* requireSuccess(operation, response);
      },
      (effect, operation, _body?: unknown) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: REQUEST_TIMEOUT,
            orElse: () => Effect.fail(timeoutError(operation)),
          }),
        ),
    );

    const listModels: OpenAiCompatibleTransport["listModels"] = execute("models").pipe(
      Effect.flatMap((response) =>
        decodeJson(response).pipe(
          Effect.mapError(
            () =>
              new OpenAiCompatibleModelCatalogError({
                message: "The endpoint model catalog is not valid JSON.",
              }),
          ),
        ),
      ),
      Effect.flatMap(decodeOpenAiCompatibleModelCatalog),
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT,
        orElse: () => Effect.fail(timeoutError("models")),
      }),
    );

    const streamRound: OpenAiCompatibleTransport["streamRound"] = (round) =>
      Stream.suspend(() => {
        if (round.signal?.aborted) return Stream.empty;
        const stream = Stream.unwrap(
          execute("chat-completions", buildOpenAiCompatibleChatCompletionRequest(round)).pipe(
            Effect.map((response) =>
              decodeOpenAiCompatibleChatCompletionSse(
                response.stream.pipe(
                  Stream.mapError(
                    () =>
                      new OpenAiCompatibleHttpError({
                        operation: "chat-completions",
                        category: "network",
                        message: "The endpoint response stream failed.",
                      }),
                  ),
                  Stream.timeoutOrElse({
                    duration: STREAM_IDLE_TIMEOUT,
                    orElse: () => Stream.fail(timeoutError("chat-completions")),
                  }),
                ),
                round.model,
              ),
            ),
          ),
        );
        return round.signal === undefined
          ? stream
          : stream.pipe(Stream.interruptWhen(abortSignalEffect(round.signal)));
      });
    return { baseUrl, listModels, streamRound };
  },
);

export const completeOpenAiCompatibleText = Effect.fn("completeOpenAiCompatibleText")(function* (
  transport: OpenAiCompatibleTransport,
  request: OpenAiCompatibleRoundRequest,
) {
  const events = yield* transport.streamRound({ ...request, tools: [] }).pipe(Stream.runCollect);
  const completed = events.find((event) => event.type === "completed");
  if (
    completed === undefined ||
    completed.toolCalls.length > 0 ||
    !completed.assistantText?.trim()
  ) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint text generation did not return a completed text response.",
    });
  }
  return {
    text: completed.assistantText.trim(),
    model: completed.model,
    ...(completed.usage === undefined ? {} : { usage: completed.usage }),
  };
});

export interface AiEndpointProbe {
  readonly kind: "openaiCompatible" | "lmstudio";
  readonly baseUrl: string;
  readonly verified: boolean;
  readonly requiresApiKey: boolean;
  readonly models: ReadonlyArray<OpenAiCompatibleCatalogModel>;
}

export const probeAiEndpoint = Effect.fn("probeAiEndpoint")(
  function* (
    rawBaseUrl: string,
  ): Effect.fn.Return<
    AiEndpointProbe | undefined,
    OpenAiCompatibleTransportSecurityError,
    HttpClient.HttpClient
  > {
    const transport = yield* makeOpenAiCompatibleTransport({
      baseUrl: rawBaseUrl,
      resolveApiKey: Effect.succeed(Option.none()),
    });
    if (!transport.baseUrl) return undefined;
    const httpClient = yield* HttpClient.HttpClient;
    let nativeRequiresApiKey = false;
    const native = yield* httpClient
      .get(`${transport.baseUrl.replace(/\/v1$/, "")}/api/v1/models`)
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "manual",
          credentials: "omit",
        }),
        Effect.flatMap((response) => {
          nativeRequiresApiKey = response.status === 401 || response.status === 403;
          return response.status >= 200 && response.status < 300
            ? decodeJson(response).pipe(Effect.flatMap(decodeLmStudioModelCatalog))
            : Effect.succeed(undefined);
        }),
        Effect.orElseSucceed(() => undefined),
        Effect.timeoutOrElse({
          duration: NATIVE_PROBE_TIMEOUT,
          orElse: () => Effect.succeed(undefined),
        }),
      );
    if (native !== undefined)
      return {
        kind: "lmstudio",
        baseUrl: transport.baseUrl,
        verified: true,
        requiresApiKey: false,
        models: native,
      };
    const requiresAuthentication: AiEndpointProbe = {
      kind: "openaiCompatible",
      baseUrl: transport.baseUrl,
      verified: false,
      requiresApiKey: true,
      models: [],
    };
    return yield* transport.listModels.pipe(
      Effect.map((models): AiEndpointProbe => ({
        kind: "openaiCompatible",
        baseUrl: transport.baseUrl,
        verified: true,
        requiresApiKey: false,
        models,
      })),
      Effect.catchTag("OpenAiCompatibleAuthenticationError", () =>
        Effect.succeed(requiresAuthentication),
      ),
      Effect.orElseSucceed(() => (nativeRequiresApiKey ? requiresAuthentication : undefined)),
    );
  },
  Effect.orElseSucceed(() => undefined),
  Effect.timeoutOrElse({ duration: PROBE_TIMEOUT, orElse: () => Effect.succeed(undefined) }),
);
