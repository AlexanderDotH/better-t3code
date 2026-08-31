import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  completeOpenAiText,
  makeOpenAiTransport,
  OPENAI_API_ORIGIN,
  OpenAiAuthenticationError,
  type OpenAiTransport,
} from "./OpenAiTransport.ts";

type Request = Parameters<Parameters<typeof HttpClient.make>[0]>[0];

const response = (request: Request, value: Response) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, value));

const liveModels = {
  object: "list",
  data: [
    {
      id: "gpt-5.6-sol",
      object: "model",
      created: 1,
      owned_by: "openai",
      shutdown_date: null,
    },
  ],
};

describe("OpenAI transport", () => {
  it.effect("uses the fixed origin and resolves the current API key per request", () =>
    Effect.gen(function* () {
      const requests: Array<Request> = [];
      const key = yield* Ref.make(Redacted.make("first-key"));
      const client = HttpClient.make((request) => {
        requests.push(request);
        return response(request, Response.json(liveModels));
      });
      const transport = yield* makeOpenAiTransport({ resolveApiKey: Ref.get(key) }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      );

      yield* transport.listModels;
      yield* Ref.set(key, Redacted.make("second-key"));
      yield* transport.listModels;

      expect(requests.map(({ url }) => url)).toEqual([
        `${OPENAI_API_ORIGIN}/models`,
        `${OPENAI_API_ORIGIN}/models`,
      ]);
      expect(requests.map(({ headers }) => headers.authorization)).toEqual([
        "Bearer first-key",
        "Bearer second-key",
      ]);
    }),
  );

  it.effect("rejects cross-origin redirects before forwarding credentials", () =>
    Effect.gen(function* () {
      let requests = 0;
      const client = HttpClient.make((request) => {
        requests += 1;
        return response(
          request,
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/steal" },
          }),
        );
      });
      const transport = yield* makeOpenAiTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const error = yield* Effect.flip(transport.listModels);
      expect(error._tag).toBe("OpenAiTransportSecurityError");
      expect(requests).toBe(1);
      expect(JSON.stringify(error)).not.toContain("secret-key");
    }),
  );

  it.effect("follows bounded same-origin redirects with the same resolved credential", () =>
    Effect.gen(function* () {
      const requests: Array<Request> = [];
      const client = HttpClient.make((request) => {
        requests.push(request);
        return response(
          request,
          requests.length === 1
            ? new Response(null, {
                status: 307,
                headers: { location: `${OPENAI_API_ORIGIN}/models?after=model-0` },
              })
            : Response.json(liveModels),
        );
      });
      const transport = yield* makeOpenAiTransport({
        resolveApiKey: Effect.succeed(Redacted.make("same-origin-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      yield* transport.listModels;

      expect(requests.map(({ url }) => url)).toEqual([
        `${OPENAI_API_ORIGIN}/models`,
        `${OPENAI_API_ORIGIN}/models?after=model-0`,
      ]);
      expect(requests.map(({ headers }) => headers.authorization)).toEqual([
        "Bearer same-origin-key",
        "Bearer same-origin-key",
      ]);
    }),
  );

  it.effect("maps authentication and rate limits without retaining bodies or credentials", () =>
    Effect.gen(function* () {
      for (const status of [401, 403, 408, 413, 422, 429, 500]) {
        const client = HttpClient.make((request) =>
          response(
            request,
            new Response("secret upstream body", {
              status,
              headers: status === 429 ? { "retry-after": "17" } : undefined,
            }),
          ),
        );
        const transport = yield* makeOpenAiTransport({
          resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
        }).pipe(Effect.provideService(HttpClient.HttpClient, client));

        const error = yield* Effect.flip(transport.listModels);
        expect(error).toMatchObject({ status });
        if (status === 401) expect(error).toBeInstanceOf(OpenAiAuthenticationError);
        if (status === 429) {
          expect(error).toMatchObject({ category: "rate-limit", retryAfterSeconds: 17 });
        }
        expect(JSON.stringify(error)).not.toContain("secret upstream body");
        expect(JSON.stringify(error)).not.toContain("secret-key");
      }
    }),
  );

  it.effect("does not issue a response request after cancellation", () =>
    Effect.gen(function* () {
      let requests = 0;
      const client = HttpClient.make((request) => {
        requests += 1;
        return response(request, new Response(null, { status: 500 }));
      });
      const transport = yield* makeOpenAiTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
      const controller = new AbortController();
      controller.abort();

      const events = yield* transport
        .streamRound({
          model: "gpt-5.6-sol",
          instructions: "Answer.",
          history: [{ type: "message", role: "user", content: "Hello" }],
          tools: [],
          signal: controller.signal,
        })
        .pipe(Stream.runCollect);

      expect(Array.from(events)).toEqual([]);
      expect(requests).toBe(0);
    }),
  );

  it.effect("cancels an active response body before a post-interrupt terminal event", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();
      let responseBodyCancelled = false;
      const client = HttpClient.make((request) =>
        response(
          request,
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "response.output_text.delta",
                      item_id: "message-1",
                      output_index: 0,
                      content_index: 0,
                      delta: "first",
                      sequence_number: 1,
                    })}\n\n`,
                  ),
                );
              },
              pull() {
                return new Promise<void>(() => {});
              },
              cancel() {
                responseBodyCancelled = true;
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
      );
      const transport = yield* makeOpenAiTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
      const controller = new AbortController();

      const events = yield* transport
        .streamRound({
          model: "gpt-5.6-sol",
          instructions: "Answer.",
          history: [{ type: "message", role: "user", content: "Hello" }],
          tools: [],
          signal: controller.signal,
        })
        .pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              if (event.type === "contentDelta") controller.abort();
            }),
          ),
          Stream.runCollect,
        );

      expect(Array.from(events)).toEqual([
        {
          type: "contentDelta",
          kind: "assistant",
          sourceId: "message-1",
          delta: "first",
        },
      ]);
      expect(responseBodyCancelled).toBe(true);
    }),
  );

  it.effect("runs structured text generation without exposing coding tools", () =>
    Effect.gen(function* () {
      let receivedTools: ReadonlyArray<unknown> | undefined;
      const transport: OpenAiTransport = {
        listModels: Effect.succeed([]),
        streamRound: (request) => {
          receivedTools = request.tools;
          return Stream.succeed({
            type: "completed" as const,
            assistantText: '{"ok":true}',
            model: request.model,
            stopReason: "completed",
            historyItems: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: '{"ok":true}' }],
              },
            ],
            toolCalls: [],
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          });
        },
      };

      const completed = yield* completeOpenAiText(transport, {
        model: "gpt-5.6-sol",
        instructions: "Return JSON.",
        history: [{ type: "message", role: "user", content: "Status" }],
        tools: [{ name: "status", parameters: { type: "object", properties: {} } }],
        responseFormat: {
          name: "status",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      });

      expect(receivedTools).toEqual([]);
      expect(completed).toEqual({
        text: '{"ok":true}',
        model: "gpt-5.6-sol",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      });
    }),
  );
});
