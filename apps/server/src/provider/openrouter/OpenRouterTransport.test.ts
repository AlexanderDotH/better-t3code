import { describe, expect, it } from "@effect/vitest";
import type { OpenRouterSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  completeOpenRouterText,
  OPENROUTER_API_ORIGIN,
  OpenRouterAuthenticationError,
  type OpenRouterTransport,
  makeOpenRouterTransport,
} from "./OpenRouterTransport.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "openai/gpt-5.5",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

type Request = Parameters<Parameters<typeof HttpClient.make>[0]>[0];

const response = (request: Request, value: Response) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, value));

const modelCatalogResponse = {
  data: [
    {
      architecture: {
        input_modalities: ["text"],
        modality: null,
        output_modalities: ["text"],
      },
      canonical_slug: "openai/gpt-5.5",
      context_length: 32_000,
      created: 1,
      default_parameters: null,
      id: "openai/gpt-5.5",
      links: { details: "https://openrouter.ai/openai/gpt-5.5" },
      name: "GPT 5.5",
      per_request_limits: null,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools"],
      supported_voices: null,
      top_provider: { is_moderated: false },
    },
  ],
  links: { next: null },
  total_count: 1,
};

describe("OpenRouter transport", () => {
  it.effect("uses the fixed origin and resolves the current API key for every request", () =>
    Effect.gen(function* () {
      const requests: Array<Request> = [];
      const key = yield* Ref.make(Redacted.make("first-key"));
      const client = HttpClient.make((request) => {
        requests.push(request);
        return response(request, Response.json(modelCatalogResponse));
      });
      const transport = yield* makeOpenRouterTransport({ resolveApiKey: Ref.get(key) }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      );

      yield* transport.listModels([]);
      yield* Ref.set(key, Redacted.make("second-key"));
      yield* transport.listModels([]);

      expect(requests.map((request) => request.url)).toEqual([
        `${OPENROUTER_API_ORIGIN}/models?output_modalities=all`,
        `${OPENROUTER_API_ORIGIN}/models?output_modalities=all`,
      ]);
      expect(requests.map((request) => request.headers.authorization)).toEqual([
        "Bearer first-key",
        "Bearer second-key",
      ]);
    }),
  );

  it.effect("rejects a cross-origin redirect before credentials can be forwarded", () =>
    Effect.gen(function* () {
      let requests = 0;
      const client = HttpClient.make((request) => {
        requests++;
        return response(
          request,
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/steal" },
          }),
        );
      });
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const error = yield* Effect.flip(transport.listModels([]));
      expect(error._tag).toBe("OpenRouterTransportSecurityError");
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
                status: 302,
                headers: {
                  location: `${OPENROUTER_API_ORIGIN}/models?output_modalities=all&offset=0`,
                },
              })
            : Response.json(modelCatalogResponse),
        );
      });
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("same-origin-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      yield* transport.listModels([]);

      expect(requests.map((request) => request.url)).toEqual([
        `${OPENROUTER_API_ORIGIN}/models?output_modalities=all`,
        `${OPENROUTER_API_ORIGIN}/models?output_modalities=all&offset=0`,
      ]);
      expect(requests.map((request) => request.headers.authorization)).toEqual([
        "Bearer same-origin-key",
        "Bearer same-origin-key",
      ]);
    }),
  );

  it.effect("maps documented HTTP statuses without including response bodies or credentials", () =>
    Effect.gen(function* () {
      const statuses = [401, 402, 403, 404, 408, 413, 422, 429, 500, 503];
      for (const status of statuses) {
        const client = HttpClient.make((request) =>
          response(
            request,
            new Response("secret response body", {
              status,
              headers: status === 429 ? { "retry-after": "17" } : undefined,
            }),
          ),
        );
        const transport = yield* makeOpenRouterTransport({
          resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
        }).pipe(Effect.provideService(HttpClient.HttpClient, client));
        const error = yield* Effect.flip(transport.listModels([]));

        expect(error).toMatchObject({ status });
        if (status === 401) expect(error._tag).toBe("OpenRouterAuthenticationError");
        if (status === 429) expect(error).toMatchObject({ retryAfterSeconds: 17 });
        expect(JSON.stringify(error)).not.toContain("secret response body");
        expect(JSON.stringify(error)).not.toContain("secret-key");
      }
    }),
  );

  it.effect("describes inference 404s as routing failures without exposing response bodies", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        response(
          request,
          Response.json(
            { error: { message: "No endpoints found for moonshotai/kimi-k3 and secret route" } },
            { status: 404 },
          ),
        ),
      );
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const error = yield* Effect.flip(
        transport
          .streamRound({
            model: "moonshotai/kimi-k3",
            instructions: "Answer.",
            history: [{ type: "user", content: "Hello" }],
            tools: [],
            settings: SETTINGS,
          })
          .pipe(Stream.runCollect),
      );

      expect(error).toMatchObject({
        category: "not-found",
        status: 404,
        message:
          "OpenRouter could not route the selected model with the required request capabilities",
      });
      expect(JSON.stringify(error)).not.toContain("secret route");
      expect(JSON.stringify(error)).not.toContain("secret-key");
    }),
  );

  it.effect("does not mislabel an inference-only 401 as a rejected configured key", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        response(
          request,
          Response.json({ error: { code: 401, message: "User not found." } }, { status: 401 }),
        ),
      );
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("management-secret")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const error = yield* Effect.flip(
        transport
          .streamRound({
            model: SETTINGS.defaultModel,
            instructions: "Answer.",
            history: [{ type: "user", content: "Hello" }],
            tools: [],
            settings: SETTINGS,
          })
          .pipe(Stream.runCollect),
      );

      expect(error).toMatchObject({
        _tag: "OpenRouterAuthenticationError",
        status: 401,
      });
      expect(error.message).toContain("inference request");
      expect(error.message).toContain("Management API key");
      expect(JSON.stringify(error)).not.toContain("management-secret");
      expect(JSON.stringify(error)).not.toContain("User not found");
    }),
  );

  it.effect("does not issue a request when the caller is already cancelled", () =>
    Effect.gen(function* () {
      let requests = 0;
      const client = HttpClient.make((request) => {
        requests++;
        return response(request, new Response(null, { status: 500 }));
      });
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
      const controller = new AbortController();
      controller.abort();

      const events = yield* transport
        .streamRound({
          model: SETTINGS.defaultModel,
          instructions: "Answer.",
          history: [{ type: "user", content: "Hello" }],
          tools: [],
          settings: SETTINGS,
          signal: controller.signal,
        })
        .pipe(Stream.runCollect);

      expect(Array.from(events)).toEqual([]);
      expect(requests).toBe(0);
    }),
  );

  it.effect("stops an active response stream before a post-cancel terminal event", () =>
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
                      id: "generation-1",
                      model: "openai/gpt-5.5",
                      object: "chat.completion.chunk",
                      created: 1,
                      choices: [
                        {
                          index: 0,
                          finish_reason: null,
                          delta: { role: "assistant", content: "first" },
                        },
                      ],
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
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.succeed(Redacted.make("secret-key")),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
      const controller = new AbortController();

      const events = yield* transport
        .streamRound({
          model: SETTINGS.defaultModel,
          instructions: "Answer.",
          history: [{ type: "user", content: "Hello" }],
          tools: [],
          settings: SETTINGS,
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
        { type: "contentDelta", kind: "assistant", delta: "first" },
      ]);
      expect(responseBodyCancelled).toBe(true);
    }),
  );

  it.effect("surfaces missing credentials with the exported authentication error", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        response(request, Response.json(modelCatalogResponse)),
      );
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: Effect.fail(
          new OpenRouterAuthenticationError({ message: "OpenRouter API key is not configured" }),
        ),
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const error = yield* Effect.flip(transport.listModels([]));
      expect(error).toEqual(
        new OpenRouterAuthenticationError({ message: "OpenRouter API key is not configured" }),
      );
    }),
  );

  it.effect("runs structured text generation without exposing tool declarations", () =>
    Effect.gen(function* () {
      let receivedTools: ReadonlyArray<unknown> | undefined;
      const transport: OpenRouterTransport = {
        listModels: () => Effect.succeed([]),
        streamRound: (request) => {
          receivedTools = request.tools;
          return Stream.succeed({
            type: "completed" as const,
            assistantText: '{"ok":true}',
            model: request.model,
            historyItems: [{ type: "assistant" as const, content: '{"ok":true}' }],
            toolCalls: [],
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            totalCostUsd: 0.0001,
          });
        },
      };

      const completed = yield* completeOpenRouterText(transport, {
        model: SETTINGS.defaultModel,
        instructions: "Return JSON.",
        history: [{ type: "user", content: "Status" }],
        tools: [{ name: "status", parameters: { type: "object", properties: {} } }],
        settings: SETTINGS,
        responseFormat: {
          type: "json-schema",
          name: "status",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      });

      expect(receivedTools).toEqual([]);
      expect(completed).toEqual({
        text: '{"ok":true}',
        model: SETTINGS.defaultModel,
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        totalCostUsd: 0.0001,
      });
    }),
  );
});
