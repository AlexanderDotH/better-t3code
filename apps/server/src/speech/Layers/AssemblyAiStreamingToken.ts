import {
  type AssemblyAiSpeechContext,
  AssemblyAiStreamingTokenError,
  type AssemblyAiStreamingTokenResult,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerSettingsService } from "../../serverSettings.ts";

const TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token";
const WEBSOCKET_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";
const TOKEN_EXPIRES_SECONDS = 60;
const MAX_SESSION_SECONDS = 600;
const SAMPLE_RATE = 16_000;
const ENCODING = "pcm_s16le";
const SPEECH_MODEL = "universal-3-5-pro";

const TokenResponse = Schema.Struct({ token: Schema.String });
const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse);

export interface AssemblyAiStreamingTokenShape {
  readonly create: (
    context: AssemblyAiSpeechContext,
  ) => Effect.Effect<AssemblyAiStreamingTokenResult, AssemblyAiStreamingTokenError>;
}

export class AssemblyAiStreamingToken extends Context.Service<
  AssemblyAiStreamingToken,
  AssemblyAiStreamingTokenShape
>()("t3/speech/Layers/AssemblyAiStreamingToken") {}

function httpStatusReason(status: number): string {
  if (status === 401 || status === 403) {
    return "AssemblyAI rejected the configured API key.";
  }
  if (status === 429) {
    return "AssemblyAI streaming token requests are temporarily rate limited.";
  }
  return `AssemblyAI token request failed with HTTP ${status}.`;
}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;

  const create = Effect.fn("AssemblyAiStreamingToken.create")(function* (
    context: AssemblyAiSpeechContext,
  ) {
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError(
        () =>
          new AssemblyAiStreamingTokenError({
            reason: "Failed to read AssemblyAI settings.",
          }),
      ),
    );
    if (!resolveBetterT3FeatureFlag(currentSettings.betterT3Environment, "voice.assemblyAi")) {
      return yield* new AssemblyAiStreamingTokenError({
        reason: "AssemblyAI dictation is disabled in Better T3 settings.",
      });
    }
    const apiKey = currentSettings.speechTranscription.assemblyAi.apiKey.value.trim();
    if (apiKey.length === 0) {
      return yield* new AssemblyAiStreamingTokenError({
        reason: "AssemblyAI API key is not configured.",
      });
    }

    const tokenUrl = new URL(TOKEN_ENDPOINT);
    tokenUrl.searchParams.set("expires_in_seconds", String(TOKEN_EXPIRES_SECONDS));
    tokenUrl.searchParams.set("max_session_duration_seconds", String(MAX_SESSION_SECONDS));

    const response = yield* HttpClientRequest.get(tokenUrl.toString()).pipe(
      HttpClientRequest.setHeaders({
        Authorization: apiKey,
        Accept: "application/json",
      }),
      httpClient.execute,
      Effect.mapError(
        () =>
          new AssemblyAiStreamingTokenError({
            reason: "Could not reach AssemblyAI to create a streaming token.",
          }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* new AssemblyAiStreamingTokenError({
        reason: httpStatusReason(response.status),
      });
    }

    const decoded = yield* response.json.pipe(
      Effect.flatMap(decodeTokenResponse),
      Effect.mapError(
        () =>
          new AssemblyAiStreamingTokenError({
            reason: "AssemblyAI returned an invalid streaming token response.",
          }),
      ),
    );
    const token = decoded.token.trim();
    if (token.length === 0) {
      return yield* new AssemblyAiStreamingTokenError({
        reason: "AssemblyAI returned an invalid streaming token response.",
      });
    }

    return {
      token,
      websocketUrl: WEBSOCKET_ENDPOINT,
      expiresInSeconds: TOKEN_EXPIRES_SECONDS,
      sampleRate: SAMPLE_RATE,
      encoding: ENCODING,
      speechModel: SPEECH_MODEL,
      context,
    } satisfies AssemblyAiStreamingTokenResult;
  });

  return AssemblyAiStreamingToken.of({ create });
});

export const AssemblyAiStreamingTokenLive = Layer.effect(AssemblyAiStreamingToken, make);
