import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";

import { makeOpenAiCompatibleTransport } from "./OpenAiCompatibleTransport.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const BASE_URL = "http://127.0.0.1:1234/proxy/local-api";
const round = { model: "manual/model.gguf", instructions: "", history: [], tools: [] };
const encoder = new TextEncoder();
const textFrame = 'data: {"choices":[{"index":0,"delta":{"content":"first"}}]}\n\n';
const completedFrames = `${textFrame}data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;

const makeTransport = (client: HttpClient.HttpClient) =>
  makeOpenAiCompatibleTransport({
    baseUrl: BASE_URL,
    resolveApiKey: Effect.succeed(Option.none()),
  }).pipe(Effect.provideService(HttpClient.HttpClient, client));

describe("OpenAI-compatible transport", () => {
  it.effect(
    "preserves proxy paths and applies current credentials without ambient auth or redirects",
    () =>
      Effect.gen(function* () {
        const requests: Array<{ url: string; options: RequestInit | undefined }> = [];
        const key = yield* Ref.make(Option.some(Redacted.make("first-key")));
        const transport = yield* makeOpenAiCompatibleTransport({
          baseUrl: `${BASE_URL}/`,
          resolveApiKey: Ref.get(key),
        }).pipe(Effect.provide(FetchHttpClient.layer));
        const fetch: typeof globalThis.fetch = Object.assign(
          (input: string | Request | URL, options?: RequestInit) => {
            requests.push({ url: String(input), options });
            return Promise.resolve(Response.json({ data: [{ id: "manual/model.gguf" }] }));
          },
          { preconnect: () => undefined },
        );
        yield* transport.listModels.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));
        yield* Ref.set(key, Option.some(Redacted.make("replacement-key")));
        yield* transport.listModels.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));
        yield* Ref.set(key, Option.none());
        yield* transport.listModels.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(requests.map(({ url }) => url)).toEqual(Array(3).fill(`${BASE_URL}/models`));
        expect(
          requests.map(({ options }) => new Headers(options?.headers).get("authorization")),
        ).toEqual(["Bearer first-key", "Bearer replacement-key", null]);
        for (const { options } of requests) {
          expect(options).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" });
        }
      }),
  );

  it.effect("can stream a manually selected model after a missing catalog route", () =>
    Effect.gen(function* () {
      const requests: Array<string> = [];
      const transport = yield* makeTransport(
        HttpClient.make((request) => {
          requests.push(request.url);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              request.method === "GET"
                ? new Response(null, { status: 404 })
                : new Response(completedFrames, {
                    headers: { "content-type": "text/event-stream" },
                  }),
            ),
          );
        }),
      );
      expect(yield* transport.listModels.pipe(Effect.flip)).toMatchObject({
        category: "catalog-not-found",
      });
      const events = yield* transport.streamRound(round).pipe(Stream.runCollect);
      expect(events.at(-1)).toMatchObject({
        type: "completed",
        model: round.model,
        assistantText: "first",
      });
      expect(requests).toEqual([`${BASE_URL}/models`, `${BASE_URL}/chat/completions`]);
    }),
  );

  it.effect(
    "distinguishes rejected keys, models, tools and HTTP failures without returning upstream secrets",
    () =>
      Effect.gen(function* () {
        const cases = [
          { status: 401, category: undefined },
          { status: 403, category: undefined },
          { status: 404, category: "model-not-found" },
          {
            status: 400,
            category: "model-not-found",
            body: { error: { code: "model_not_found" } },
          },
          {
            status: 400,
            category: "tools-not-supported",
            body: { error: { message: "This model does not support tools: secret-key" } },
          },
          {
            status: 400,
            category: "tools-not-supported",
            body: { error: "This model does not support tools: secret-key" },
          },
          {
            status: 400,
            category: "tools-not-supported",
            body: {
              error: {
                message:
                  "auto tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set",
              },
            },
          },
          {
            status: 400,
            category: "invalid-request",
            body: {
              error: { message: "Invalid tools[0].function.parameters: expected an object" },
            },
          },
          { status: 422, category: "invalid-request" },
          { status: 408, category: "timeout" },
          { status: 504, category: "timeout" },
          { status: 429, category: "rate-limit" },
          { status: 500, category: "service-unavailable" },
        ];
        for (const { status, category, body } of cases) {
          const transport = yield* makeTransport(
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json(body ?? { error: "secret-key" }, {
                    status,
                    headers: { "retry-after": "17" },
                  }),
                ),
              ),
            ),
          );
          const error = yield* transport.streamRound(round).pipe(Stream.runCollect, Effect.flip);
          expect(error).toMatchObject({
            status,
            ...(category === undefined
              ? { _tag: "OpenAiCompatibleAuthenticationError" }
              : { category }),
          });
          if (status === 429) expect(error).toMatchObject({ retryAfterSeconds: 17 });
          expect(encodeJson(error)).not.toContain("secret-key");
        }
      }),
  );

  it.effect(
    "rejects redirects and transport failures without exposing response bodies or request headers",
    () =>
      Effect.gen(function* () {
        for (const redirect of [true, false]) {
          let calls = 0;
          const transport = yield* makeTransport(
            HttpClient.make((request) => {
              calls++;
              return redirect
                ? Effect.succeed(
                    HttpClientResponse.fromWeb(
                      request,
                      new Response("secret-key", {
                        status: 307,
                        headers: { location: "https://other.example/steal" },
                      }),
                    ),
                  )
                : Effect.fail(
                    new HttpClientError.HttpClientError({
                      reason: new HttpClientError.TransportError({ request, cause: "secret-key" }),
                    }),
                  );
            }),
          );
          const error = yield* transport.listModels.pipe(Effect.flip);
          expect(error).toMatchObject(
            redirect
              ? { _tag: "OpenAiCompatibleTransportSecurityError" }
              : { _tag: "OpenAiCompatibleHttpError", category: "network" },
          );
          expect(encodeJson(error)).not.toContain("secret-key");
          expect(calls).toBe(1);
        }
      }),
  );

  it.effect("does not send requests canceled before or after constructing the stream", () =>
    Effect.gen(function* () {
      let calls = 0;
      const transport = yield* makeTransport(
        HttpClient.make((request) => {
          calls++;
          return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(completedFrames)));
        }),
      );
      for (const abortBeforeConstruction of [true, false]) {
        const controller = new AbortController();
        if (abortBeforeConstruction) controller.abort();
        const stream = transport.streamRound({ ...round, signal: controller.signal });
        controller.abort();
        expect(yield* stream.pipe(Stream.runCollect)).toEqual([]);
      }
      expect(calls).toBe(0);
    }),
  );

  it.effect("cancels an active response body after the last delivered delta", () =>
    Effect.gen(function* () {
      let cancelled = false;
      const transport = yield* makeTransport(
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(encoder.encode(textFrame));
                  },
                  cancel() {
                    cancelled = true;
                  },
                }),
              ),
            ),
          ),
        ),
      );
      const controller = new AbortController();
      const events = yield* transport.streamRound({ ...round, signal: controller.signal }).pipe(
        Stream.tap(() => Effect.sync(() => controller.abort())),
        Stream.runCollect,
      );
      expect(events).toEqual([{ type: "contentDelta", kind: "assistant", delta: "first" }]);
      expect(cancelled).toBe(true);
    }),
  );

  it.effect("aborts outstanding HTTP requests on cancellation and the request timeout", () =>
    Effect.gen(function* () {
      for (const timeout of [false, true]) {
        const started = yield* Deferred.make<void>();
        let requestSignal: AbortSignal | undefined;
        const transport = yield* makeTransport(
          HttpClient.make((_request, _url, signal) =>
            Effect.gen(function* () {
              requestSignal = signal;
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }),
          ),
        );
        const controller = new AbortController();
        const result = yield* transport
          .streamRound({ ...round, signal: controller.signal })
          .pipe(Stream.runCollect, Effect.result, Effect.forkChild);
        yield* Deferred.await(started);
        if (timeout) yield* TestClock.adjust("30 seconds");
        else controller.abort();
        const completion = yield* Fiber.join(result);
        expect(completion).toMatchObject(
          timeout
            ? { _tag: "Failure", failure: { category: "timeout" } }
            : { _tag: "Success", success: [] },
        );
        expect(requestSignal?.aborted).toBe(true);
      }
    }),
  );

  it.effect("times out and cancels an idle response body", () =>
    Effect.gen(function* () {
      const received = yield* Deferred.make<void>();
      let cancelled = false;
      const transport = yield* makeTransport(
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(encoder.encode(textFrame));
                  },
                  cancel() {
                    cancelled = true;
                  },
                }),
              ),
            ),
          ),
        ),
      );
      const result = yield* transport.streamRound(round).pipe(
        Stream.tap(() => Deferred.succeed(received, undefined)),
        Stream.runCollect,
        Effect.flip,
        Effect.forkChild,
      );
      yield* Deferred.await(received);
      yield* TestClock.adjust("5 minutes");
      expect(yield* Fiber.join(result)).toMatchObject({ category: "timeout" });
      expect(cancelled).toBe(true);
    }),
  );
});
