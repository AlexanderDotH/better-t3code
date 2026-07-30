// @effect-diagnostics globalFetch:off
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ChatAttachment,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Scope from "effect/Scope";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import type { GeminiSettings } from "../Drivers/GeminiConfig.ts";
import { GEMINI_DRIVER_KIND, resolveGeminiApiKey } from "../Drivers/GeminiConfig.ts";
import {
  buildGeminiThinkingConfig,
  normalizeGeminiReasoningEffort,
} from "../Drivers/GeminiThinkingConfig.ts";
import {
  buildGeminiGenerationConfig,
  bytesToGeminiInlineDataPart,
  makeGeminiGenerateContentUrl,
  readGeminiGenerateContentResponse,
  type GeminiContent,
  type GeminiRequestPart,
} from "../llm/GeminiApi.ts";
import { makeHttpChatAdapter, type HttpChatTranscriptMessage } from "./HttpChatAdapter.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

export interface GeminiAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
}

interface GeminiAdapterDependencies {
  readonly fileSystem: FileSystem.FileSystem;
  readonly attachmentsDir: string;
}

function compactError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error).trim() || "Unknown error";
}

function resolveGeminiRuntimeModel(input: {
  readonly selectedModel?: string | undefined;
  readonly sessionModel?: string | undefined;
}): string {
  return (
    input.selectedModel?.trim() ||
    input.sessionModel?.trim() ||
    DEFAULT_MODEL_BY_PROVIDER[GEMINI_DRIVER_KIND] ||
    "gemini-2.5-flash"
  );
}

function buildWorkspaceInstruction(cwd: string | undefined): string | undefined {
  const trimmed = cwd?.trim();
  return trimmed ? `Workspace: ${trimmed}` : undefined;
}

function attachmentToGeminiPart(
  attachment: ChatAttachment,
  dependencies: GeminiAdapterDependencies,
): Effect.Effect<GeminiRequestPart, ProviderAdapterError> {
  const filePath = resolveAttachmentPath({
    attachmentsDir: dependencies.attachmentsDir,
    attachment,
  });
  if (!filePath) {
    return Effect.fail(
      new ProviderAdapterRequestError({
        provider: GEMINI_DRIVER_KIND,
        method: "turn/start",
        detail: `Invalid attachment id '${attachment.id}'.`,
      }),
    );
  }

  return dependencies.fileSystem.readFile(filePath).pipe(
    Effect.map((bytes) => bytesToGeminiInlineDataPart({ mimeType: attachment.mimeType, bytes })),
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: GEMINI_DRIVER_KIND,
          method: "turn/start",
          detail: `Failed to read attachment file: ${cause.message}.`,
          cause,
        }),
    ),
  );
}

const transcriptMessageToGeminiContent = Effect.fn("transcriptMessageToGeminiContent")(function* (
  message: HttpChatTranscriptMessage,
  dependencies: GeminiAdapterDependencies,
): Effect.fn.Return<GeminiContent | undefined, ProviderAdapterError> {
  const parts: GeminiRequestPart[] = [];
  const text = message.content.trim();
  if (text) {
    parts.push({ text });
  }

  if (message.role === "user") {
    const attachmentParts = yield* Effect.forEach(
      message.attachments ?? [],
      (attachment) => attachmentToGeminiPart(attachment, dependencies),
      { concurrency: 1 },
    );
    parts.push(...attachmentParts);
  }

  if (parts.length === 0) return undefined;
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts,
  };
});

const buildGeminiContents = Effect.fn("buildGeminiContents")(function* (
  messages: ReadonlyArray<HttpChatTranscriptMessage>,
  dependencies: GeminiAdapterDependencies,
): Effect.fn.Return<ReadonlyArray<GeminiContent>, ProviderAdapterError> {
  const contents = yield* Effect.forEach(
    messages,
    (message) => transcriptMessageToGeminiContent(message, dependencies),
    { concurrency: 1 },
  );
  return contents.filter((content): content is GeminiContent => content !== undefined);
});

export function makeGeminiAdapter(
  geminiSettings: GeminiSettings,
  environment: NodeJS.ProcessEnv = process.env,
  options?: GeminiAdapterLiveOptions,
): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  Crypto.Crypto | FileSystem.FileSystem | Scope.Scope | ServerConfig
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("gemini");

    return yield* makeHttpChatAdapter({
      provider: GEMINI_DRIVER_KIND,
      providerInstanceId: instanceId,
      executeTurn: (input) =>
        Effect.gen(function* () {
          const apiKey = resolveGeminiApiKey(geminiSettings, environment);
          if (!apiKey) {
            return yield* new ProviderAdapterRequestError({
              provider: GEMINI_DRIVER_KIND,
              method: "streamGenerateContent",
              detail:
                "Gemini API key is missing; configure the provider API key or set GEMINI_API_KEY / GOOGLE_API_KEY.",
            });
          }

          const model = resolveGeminiRuntimeModel({
            selectedModel: input.input.modelSelection?.model,
            sessionModel: input.session.model,
          });
          const reasoningEffort =
            normalizeGeminiReasoningEffort(
              getModelSelectionStringOptionValue(input.input.modelSelection, "reasoningEffort"),
            ) ?? "medium";
          const contents = yield* buildGeminiContents(input.messages, {
            fileSystem,
            attachmentsDir: serverConfig.attachmentsDir,
          });
          const systemInstruction = buildWorkspaceInstruction(input.session.cwd);
          const generationConfig = buildGeminiGenerationConfig({
            thinkingConfig: buildGeminiThinkingConfig(model, reasoningEffort),
          });
          const body = {
            contents,
            ...(systemInstruction
              ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
              : {}),
            ...(generationConfig ? { generationConfig } : {}),
          };

          return yield* Effect.tryPromise({
            try: async () => {
              // @effect-diagnostics-next-line globalFetchInEffect:off - Provider adapters run at the Node HTTP boundary.
              const response = await globalThis.fetch(
                makeGeminiGenerateContentUrl({ model, stream: true }),
                {
                  method: "POST",
                  headers: {
                    Accept: "application/json, text/event-stream",
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                  },
                  // @effect-diagnostics-next-line preferSchemaOverJson:off - Gemini request bodies include provider-open extension objects.
                  body: JSON.stringify(body),
                  signal: input.signal,
                },
              );
              if (!response.ok) {
                const detail = await response.text().catch(() => "");
                throw new Error(
                  `Gemini streamGenerateContent failed (${response.status}): ${detail.slice(0, 400)}`,
                );
              }

              const result = await readGeminiGenerateContentResponse(
                response,
                (delta) => Effect.runPromise(input.emitAssistantDelta(delta)),
                (delta) => Effect.runPromise(input.emitReasoningDelta(delta)),
              );
              return {
                assistantText: result.text,
                ...(result.reasoning ? { reasoningText: result.reasoning } : {}),
                ...(result.finishReason ? { stopReason: result.finishReason } : {}),
                ...(result.usage !== undefined ? { usage: result.usage } : {}),
              };
            },
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: GEMINI_DRIVER_KIND,
                method: "streamGenerateContent",
                detail: compactError(cause),
                cause,
              }),
          });
        }),
    });
  });
}
