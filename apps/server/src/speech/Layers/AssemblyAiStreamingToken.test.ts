import { describe, expect, it, vi } from "@effect/vitest";
import { makeBetterT3SettingsV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  AssemblyAiStreamingToken,
  AssemblyAiStreamingTokenLive,
} from "./AssemblyAiStreamingToken.ts";

function makeTestLayer(input: {
  readonly apiKey?: string;
  readonly enabled?: boolean;
  readonly respond: (request: HttpClientRequest.HttpClientRequest) => Response;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.respond(request))),
  );
  const layer = AssemblyAiStreamingTokenLive.pipe(
    Layer.provide(
      ServerSettingsService.layerTest({
        betterT3Environment: makeBetterT3SettingsV1("clean-install", {
          "voice.assemblyAi": input.enabled ?? true,
        }),
        speechTranscription: {
          assemblyAi: { apiKey: { value: input.apiKey ?? "" } },
        },
      }),
    ),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, HttpClient.make(execute))),
  );
  return { execute, layer };
}

const speechContext = {
  source: "indexed" as const,
  prompt: "Software-development dictation for T3 Code.",
  keyterms: ["T3 Code", "AssemblyAI"],
};

describe("AssemblyAiStreamingToken", () => {
  it.effect("requests a short-lived global-edge token without returning the permanent key", () => {
    const { execute, layer } = makeTestLayer({
      apiKey: "permanent-secret-key",
      respond: () => Response.json({ token: "temporary-browser-token" }),
    });

    return Effect.gen(function* () {
      const service = yield* AssemblyAiStreamingToken;
      const result = yield* service.create(speechContext);

      expect(result).toEqual({
        token: "temporary-browser-token",
        websocketUrl: "wss://streaming.assemblyai.com/v3/ws",
        expiresInSeconds: 60,
        sampleRate: 16_000,
        encoding: "pcm_s16le",
        speechModel: "universal-3-5-pro",
        context: {
          source: "indexed",
          prompt: "Software-development dictation for T3 Code.",
          keyterms: ["T3 Code", "AssemblyAI"],
        },
      });

      const request = execute.mock.calls[0]?.[0];
      expect(request).toBeDefined();
      const url = new URL(request?.url ?? "https://invalid.example");
      expect(url.origin).toBe("https://streaming.assemblyai.com");
      expect(url.pathname).toBe("/v3/token");
      expect(url.searchParams.get("expires_in_seconds")).toBe("60");
      expect(url.searchParams.get("max_session_duration_seconds")).toBe("600");
      expect(request?.headers.authorization).toBe("permanent-secret-key");
      expect(Object.values(result)).not.toContain("permanent-secret-key");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails before transport when no permanent key is configured", () => {
    const { execute, layer } = makeTestLayer({
      respond: () => Response.json({ token: "unused" }),
    });

    return Effect.gen(function* () {
      const service = yield* AssemblyAiStreamingToken;
      const error = yield* Effect.flip(service.create(speechContext));

      expect(error.reason).toBe("AssemblyAI API key is not configured.");
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails before transport when AssemblyAI is disabled in Better T3 settings", () => {
    const { execute, layer } = makeTestLayer({
      apiKey: "must-never-be-used",
      enabled: false,
      respond: () => Response.json({ token: "unused" }),
    });

    return Effect.gen(function* () {
      const service = yield* AssemblyAiStreamingToken;
      const error = yield* Effect.flip(service.create(speechContext));

      expect(error.reason).toBe("AssemblyAI dictation is disabled in Better T3 settings.");
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "maps transport failures without retaining request headers or the permanent key",
    () => {
      const layer = AssemblyAiStreamingTokenLive.pipe(
        Layer.provide(
          ServerSettingsService.layerTest({
            betterT3Environment: makeBetterT3SettingsV1("clean-install", {
              "voice.assemblyAi": true,
            }),
            speechTranscription: {
              assemblyAi: { apiKey: { value: "transport-secret-key" } },
            },
          }),
        ),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.fail({ _tag: "RequestError" } as never)),
          ),
        ),
      );

      return Effect.gen(function* () {
        const service = yield* AssemblyAiStreamingToken;
        const error = yield* Effect.flip(service.create(speechContext));

        expect(error.reason).toBe("Could not reach AssemblyAI to create a streaming token.");
        expect(error.message).not.toContain("transport-secret-key");
        expect(error.cause).toBeUndefined();
      }).pipe(Effect.provide(layer));
    },
  );

  for (const [status, reason] of [
    [401, "AssemblyAI rejected the configured API key."],
    [429, "AssemblyAI streaming token requests are temporarily rate limited."],
  ] as const) {
    it.effect(`maps HTTP ${status} to a useful secret-free error`, () => {
      const { layer } = makeTestLayer({
        apiKey: "must-never-appear",
        respond: () => new Response("nope", { status }),
      });

      return Effect.gen(function* () {
        const service = yield* AssemblyAiStreamingToken;
        const error = yield* Effect.flip(service.create(speechContext));

        expect(error.reason).toBe(reason);
        expect(error.message).not.toContain("must-never-appear");
        expect(error.reason).not.toContain("must-never-appear");
        expect(error.cause).toBeUndefined();
      }).pipe(Effect.provide(layer));
    });
  }

  for (const [label, respond] of [
    ["malformed JSON", () => new Response("not-json", { status: 200 })],
    ["missing tokens", () => Response.json({ unexpected: true })],
    ["empty tokens", () => Response.json({ token: "   " })],
  ] satisfies ReadonlyArray<readonly [string, () => Response]>) {
    it.effect(`rejects ${label} through schema decoding`, () => {
      const { layer } = makeTestLayer({
        apiKey: "must-never-appear",
        respond,
      });

      return Effect.gen(function* () {
        const service = yield* AssemblyAiStreamingToken;
        const error = yield* Effect.flip(service.create(speechContext));

        expect(error.reason).toBe("AssemblyAI returned an invalid streaming token response.");
        expect(error.reason).not.toContain("must-never-appear");
        expect(error.cause).toBeUndefined();
      }).pipe(Effect.provide(layer));
    });
  }
});
