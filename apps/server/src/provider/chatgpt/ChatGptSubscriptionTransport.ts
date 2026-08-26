import type { ServerProviderRateLimit } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import type { ChatGptAuthBroker } from "./ChatGptAuthBroker.ts";
import type { ChatGptCredential, ChatGptCredentialStore } from "./ChatGptCredentialStore.ts";
import { decodeChatGptModelCatalog, type ChatGptSubscriptionModel } from "./ChatGptModelCatalog.ts";
import { decodeChatGptResponseSse, type ChatGptResponseEvent } from "./ChatGptResponseSse.ts";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const CHATGPT_API_PREFIX = `${CHATGPT_ORIGIN}/backend-api`;
const MAX_SAME_ORIGIN_REDIRECTS = 2;
const CompactionResponse = Schema.Struct({ output: Schema.Array(Schema.Unknown) });
const decodeCompactionResponse = HttpClientResponse.schemaBodyJson(CompactionResponse);
const decodeUnknownJson = HttpClientResponse.schemaBodyJson(Schema.Unknown);

export class ChatGptTransportSecurityError extends Schema.TaggedErrorClass<ChatGptTransportSecurityError>()(
  "ChatGptTransportSecurityError",
  { message: Schema.String },
) {}

export class ChatGptAuthenticationError extends Schema.TaggedErrorClass<ChatGptAuthenticationError>()(
  "ChatGptAuthenticationError",
  { message: Schema.String },
) {}

export class ChatGptHttpError extends Schema.TaggedErrorClass<ChatGptHttpError>()(
  "ChatGptHttpError",
  {
    operation: Schema.Literals(["models", "response", "compaction"]),
    status: Schema.optionalKey(Schema.Number),
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export class ChatGptRateLimitError extends Schema.TaggedErrorClass<ChatGptRateLimitError>()(
  "ChatGptRateLimitError",
  {
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export class ChatGptCompactionError extends Schema.TaggedErrorClass<ChatGptCompactionError>()(
  "ChatGptCompactionError",
  { message: Schema.String },
) {}

export type ChatGptTransportOperation = ChatGptHttpError["operation"];

export interface ChatGptResponseRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: ReadonlyArray<unknown>;
  readonly tools: ReadonlyArray<unknown>;
  readonly reasoningEffort?: string;
  readonly serviceTier?: string;
  readonly promptCacheKey?: string;
  readonly previousResponseId?: string;
}

export interface ChatGptCompactionRequest {
  readonly model: string;
  readonly input: ReadonlyArray<unknown>;
  readonly instructions?: string;
  readonly serviceTier?: string;
  readonly promptCacheKey?: string;
}

export interface ChatGptCompactionResult {
  readonly input: ReadonlyArray<unknown>;
}

export type ChatGptSubscriptionTransportError =
  | ChatGptTransportSecurityError
  | ChatGptAuthenticationError
  | ChatGptHttpError
  | ChatGptRateLimitError
  | ChatGptCompactionError;

export interface ChatGptSubscriptionTransport {
  readonly rateLimit: Effect.Effect<ServerProviderRateLimit>;
  readonly listModels: Effect.Effect<
    ReadonlyArray<ChatGptSubscriptionModel>,
    ChatGptSubscriptionTransportError
  >;
  readonly streamResponse: (
    request: ChatGptResponseRequest,
  ) => Stream.Stream<ChatGptResponseEvent, ChatGptSubscriptionTransportError>;
  readonly compact: (
    request: ChatGptCompactionRequest,
  ) => Effect.Effect<ChatGptCompactionResult, ChatGptSubscriptionTransportError>;
}

interface AuthorizedRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: unknown;
}

const parseRetryAfterSeconds = (header: string | undefined): number | undefined => {
  if (header === undefined) return undefined;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
};

const makeRequest = Effect.fn("makeChatGptSubscriptionRequest")(function* (
  input: AuthorizedRequest,
  credential: ChatGptCredential,
) {
  const base =
    input.method === "GET" ? HttpClientRequest.get(input.url) : HttpClientRequest.post(input.url);
  const withHeaders = base.pipe(
    HttpClientRequest.bearerToken(Redacted.value(credential.accessToken)),
    HttpClientRequest.setHeader("chatgpt-account-id", credential.accountId),
    HttpClientRequest.setHeader("originator", "codex_cli_rs"),
    HttpClientRequest.setHeader("user-agent", "t3code_chatgpt_subscription"),
    HttpClientRequest.setHeader(
      "accept",
      input.method === "GET" ? "application/json" : "text/event-stream",
    ),
  );
  if (input.body === undefined) return withHeaders;
  return yield* HttpClientRequest.bodyJson(withHeaders, input.body).pipe(
    Effect.mapError(
      () =>
        new ChatGptHttpError({
          operation: "response",
          message: "ChatGPT request body is not valid JSON",
        }),
    ),
  );
});

const responseRequestBody = (request: ChatGptResponseRequest): unknown => ({
  model: request.model,
  instructions: request.instructions,
  input: request.input,
  tools: request.tools,
  tool_choice: "auto",
  parallel_tool_calls: true,
  store: false,
  stream: true,
  ...(request.reasoningEffort === undefined
    ? {}
    : {
        reasoning: { effort: request.reasoningEffort, summary: "auto" },
        include: ["reasoning.encrypted_content"],
      }),
  ...(request.serviceTier === undefined ? {} : { service_tier: request.serviceTier }),
  ...(request.promptCacheKey === undefined ? {} : { prompt_cache_key: request.promptCacheKey }),
  ...(request.previousResponseId === undefined
    ? {}
    : { previous_response_id: request.previousResponseId }),
});

const compactionRequestBody = (request: ChatGptCompactionRequest): unknown => ({
  model: request.model,
  input: request.input,
  ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
  ...(request.serviceTier === undefined ? {} : { service_tier: request.serviceTier }),
  ...(request.promptCacheKey === undefined ? {} : { prompt_cache_key: request.promptCacheKey }),
});

export const makeChatGptSubscriptionTransport = Effect.fn("makeChatGptSubscriptionTransport")(
  function* (input: {
    readonly credentialStore: ChatGptCredentialStore;
    readonly authBroker: ChatGptAuthBroker;
    readonly clientVersion?: string;
  }): Effect.fn.Return<ChatGptSubscriptionTransport, never, HttpClient.HttpClient> {
    const httpClient = yield* HttpClient.HttpClient;
    const refreshGeneration = yield* Ref.make(0);
    const rateLimit = yield* Ref.make<ServerProviderRateLimit>({ status: "unknown" });
    const refreshLock = yield* Semaphore.make(1);
    const clientVersion = input.clientVersion?.trim() || "0.0.1";

    const credential = input.credentialStore.read.pipe(
      Effect.mapError(
        () => new ChatGptAuthenticationError({ message: "ChatGPT credentials could not be read" }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ChatGptAuthenticationError({ message: "ChatGPT subscription is not connected" }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

    const executeOnce = Effect.fn("ChatGptSubscriptionTransport.executeOnce")(function* (
      operation: ChatGptTransportOperation,
      authorizedRequest: AuthorizedRequest,
      activeCredential: ChatGptCredential,
      redirects = 0,
    ): Effect.fn.Return<HttpClientResponse.HttpClientResponse, ChatGptSubscriptionTransportError> {
      const url = yield* Effect.try({
        try: () => new URL(authorizedRequest.url),
        catch: () =>
          new ChatGptTransportSecurityError({ message: "ChatGPT endpoint URL is invalid" }),
      });
      if (url.origin !== CHATGPT_ORIGIN) {
        return yield* new ChatGptTransportSecurityError({
          message: "ChatGPT request origin is not allowlisted",
        });
      }
      const request = yield* makeRequest(authorizedRequest, activeCredential);
      const response = yield* httpClient.execute(request).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.mapError(
          () => new ChatGptHttpError({ operation, message: "ChatGPT request transport failed" }),
        ),
      );
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.location;
      if (location === undefined) {
        return yield* new ChatGptHttpError({
          operation,
          status: response.status,
          message: "ChatGPT redirect omitted its destination",
        });
      }
      const redirectUrl = yield* Effect.try({
        try: () => new URL(location, url),
        catch: () =>
          new ChatGptTransportSecurityError({ message: "ChatGPT redirect URL is invalid" }),
      });
      if (redirectUrl.origin !== url.origin) {
        return yield* new ChatGptTransportSecurityError({
          message: "ChatGPT cross-origin redirect was rejected",
        });
      }
      if (redirects >= MAX_SAME_ORIGIN_REDIRECTS) {
        return yield* new ChatGptHttpError({
          operation,
          status: response.status,
          message: "ChatGPT returned too many redirects",
        });
      }
      return yield* executeOnce(
        operation,
        { ...authorizedRequest, url: redirectUrl.toString() },
        activeCredential,
        redirects + 1,
      );
    });

    const refreshAfterUnauthorized = (observedGeneration: number) =>
      refreshLock.withPermit(
        Ref.get(refreshGeneration).pipe(
          Effect.flatMap((currentGeneration) => {
            if (currentGeneration !== observedGeneration) return Effect.void;
            return input.authBroker.refresh.pipe(
              Effect.mapError(
                () =>
                  new ChatGptAuthenticationError({
                    message: "ChatGPT credential refresh failed",
                  }),
              ),
              Effect.andThen(Ref.update(refreshGeneration, (generation) => generation + 1)),
            );
          }),
        ),
      );

    const executeAuthorized = Effect.fn("ChatGptSubscriptionTransport.executeAuthorized")(
      function* (
        operation: ChatGptTransportOperation,
        request: AuthorizedRequest,
      ): Effect.fn.Return<
        HttpClientResponse.HttpClientResponse,
        ChatGptSubscriptionTransportError
      > {
        const observedGeneration = yield* Ref.get(refreshGeneration);
        const initialCredential = yield* credential;
        const initial = yield* executeOnce(operation, request, initialCredential);
        if (initial.status !== 401) return initial;
        yield* refreshAfterUnauthorized(observedGeneration).pipe(
          Effect.tapError(() => input.authBroker.invalidate.pipe(Effect.ignore)),
        );
        const refreshedCredential = yield* credential;
        const retried = yield* executeOnce(operation, request, refreshedCredential);
        if (retried.status !== 401) return retried;
        yield* input.authBroker.invalidate.pipe(
          Effect.mapError(
            () =>
              new ChatGptAuthenticationError({
                message: "ChatGPT credentials could not be invalidated",
              }),
          ),
        );
        return yield* new ChatGptAuthenticationError({
          message: "ChatGPT subscription authentication expired after refresh",
        });
      },
    );

    const requireSuccess = (
      operation: ChatGptTransportOperation,
      response: HttpClientResponse.HttpClientResponse,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, ChatGptSubscriptionTransportError> => {
      if (response.status >= 200 && response.status < 300) {
        return Ref.set(rateLimit, { status: "available" }).pipe(Effect.as(response));
      }
      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfterSeconds(response.headers["retry-after"]);
        const message = "ChatGPT subscription rate limit reached";
        return Ref.set(rateLimit, {
          status: "exhausted",
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          message,
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new ChatGptRateLimitError({
                ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
                message,
              }),
            ),
          ),
        );
      }
      return Effect.fail(
        new ChatGptHttpError({
          operation,
          status: response.status,
          message: `ChatGPT ${operation} request failed with HTTP ${response.status}`,
        }),
      );
    };

    const listModels = executeAuthorized("models", {
      method: "GET",
      url: `${CHATGPT_API_PREFIX}/codex/models?client_version=${encodeURIComponent(clientVersion)}`,
    }).pipe(
      Effect.flatMap((response) => requireSuccess("models", response)),
      Effect.flatMap(decodeUnknownJson),
      Effect.mapError((error) =>
        error._tag === "ChatGptTransportSecurityError" ||
        error._tag === "ChatGptAuthenticationError" ||
        error._tag === "ChatGptHttpError" ||
        error._tag === "ChatGptRateLimitError"
          ? error
          : new ChatGptHttpError({
              operation: "models",
              message: "ChatGPT model catalog JSON is invalid",
            }),
      ),
      Effect.flatMap(decodeChatGptModelCatalog),
      Effect.mapError(
        (error): ChatGptSubscriptionTransportError =>
          error._tag === "ChatGptModelCatalogError"
            ? new ChatGptHttpError({ operation: "models", message: error.message })
            : error,
      ),
    );

    const compact: ChatGptSubscriptionTransport["compact"] = (request) =>
      executeAuthorized("compaction", {
        method: "POST",
        url: `${CHATGPT_API_PREFIX}/codex/responses/compact`,
        body: compactionRequestBody(request),
      }).pipe(
        Effect.flatMap((response) => requireSuccess("compaction", response)),
        Effect.flatMap(decodeCompactionResponse),
        Effect.mapError(
          (error): ChatGptSubscriptionTransportError =>
            error._tag === "ChatGptTransportSecurityError" ||
            error._tag === "ChatGptAuthenticationError" ||
            error._tag === "ChatGptHttpError" ||
            error._tag === "ChatGptRateLimitError"
              ? error
              : new ChatGptCompactionError({
                  message: "ChatGPT compaction response schema is invalid",
                }),
        ),
        Effect.flatMap((response) =>
          response.output.length === 0
            ? Effect.fail(
                new ChatGptCompactionError({
                  message: "ChatGPT compaction returned no replacement history",
                }),
              )
            : Effect.succeed({ input: response.output }),
        ),
      );

    const streamResponse: ChatGptSubscriptionTransport["streamResponse"] = (request) =>
      Stream.unwrap(
        executeAuthorized("response", {
          method: "POST",
          url: `${CHATGPT_API_PREFIX}/codex/responses`,
          body: responseRequestBody(request),
        }).pipe(
          Effect.flatMap((response) => requireSuccess("response", response)),
          Effect.map((response) =>
            decodeChatGptResponseSse(response.stream).pipe(
              Stream.mapError(
                (error): ChatGptSubscriptionTransportError =>
                  error._tag === "ChatGptProtocolDriftError"
                    ? new ChatGptHttpError({ operation: "response", message: error.message })
                    : new ChatGptHttpError({
                        operation: "response",
                        message: "ChatGPT response stream failed",
                      }),
              ),
            ),
          ),
        ),
      );

    return { rateLimit: Ref.get(rateLimit), listModels, streamResponse, compact };
  },
);
