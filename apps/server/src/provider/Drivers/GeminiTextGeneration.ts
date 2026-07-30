// @effect-diagnostics globalFetch:off
import {
  DEFAULT_MODEL_BY_PROVIDER,
  TextGenerationError,
  type ChatAttachment,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../../textGeneration/TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "../../textGeneration/TextGenerationUtils.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import {
  buildGeminiGenerationConfig,
  bytesToGeminiInlineDataPart,
  geminiResponseToText,
  makeGeminiGenerateContentUrl,
  parseGeminiJsonText,
  type GeminiRequestPart,
} from "../llm/GeminiApi.ts";
import type { GeminiSettings } from "./GeminiConfig.ts";
import { GEMINI_DRIVER_KIND, resolveGeminiApiKey } from "./GeminiConfig.ts";

type GeminiTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

function compactError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error).trim() || "Unknown error";
}

function resolveTextGenerationModel(model: string | undefined): string {
  return model?.trim() || DEFAULT_MODEL_BY_PROVIDER[GEMINI_DRIVER_KIND] || "gemini-2.5-flash";
}

function textGenerationError(
  operation: GeminiTextGenerationOperation,
  detail: string,
  cause?: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function attachmentToGeminiPart(input: {
  readonly operation: GeminiTextGenerationOperation;
  readonly attachment: ChatAttachment;
  readonly attachmentsDir: string;
  readonly fileSystem: FileSystem.FileSystem;
}): Effect.Effect<GeminiRequestPart, TextGenerationError> {
  const filePath = resolveAttachmentPath({
    attachmentsDir: input.attachmentsDir,
    attachment: input.attachment,
  });
  if (!filePath) {
    return Effect.fail(
      textGenerationError(input.operation, `Invalid attachment id '${input.attachment.id}'.`),
    );
  }

  return input.fileSystem.readFile(filePath).pipe(
    Effect.map((bytes) =>
      bytesToGeminiInlineDataPart({
        mimeType: input.attachment.mimeType,
        bytes,
      }),
    ),
    Effect.mapError((cause) =>
      textGenerationError(
        input.operation,
        `Failed to read attachment file: ${cause.message}.`,
        cause,
      ),
    ),
  );
}

export function makeGeminiTextGeneration(
  geminiSettings: GeminiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<
  TextGeneration.TextGeneration["Service"],
  never,
  FileSystem.FileSystem | ServerConfig
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;

    const runGeminiJson = Effect.fn("GeminiTextGeneration.runGeminiJson")(function* <
      S extends Schema.Top,
    >(input: {
      readonly operation: GeminiTextGenerationOperation;
      readonly cwd: string;
      readonly prompt: string;
      readonly outputSchema: S;
      readonly model: string | undefined;
      readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
    }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
      const apiKey = resolveGeminiApiKey(geminiSettings, environment);
      if (!apiKey) {
        return yield* textGenerationError(
          input.operation,
          "Gemini API key is missing; configure the provider API key or set GEMINI_API_KEY / GOOGLE_API_KEY.",
        );
      }

      const imageParts = yield* Effect.forEach(
        input.attachments ?? [],
        (attachment) =>
          attachmentToGeminiPart({
            operation: input.operation,
            attachment,
            attachmentsDir: serverConfig.attachmentsDir,
            fileSystem,
          }),
        { concurrency: 1 },
      );
      const body = {
        contents: [
          {
            role: "user" as const,
            parts: [{ text: input.prompt }, ...imageParts],
          },
        ],
        systemInstruction: { parts: [{ text: `Workspace: ${input.cwd}` }] },
        generationConfig: buildGeminiGenerationConfig({
          responseSchema: toJsonSchemaObject(input.outputSchema),
        }),
      };
      const model = resolveTextGenerationModel(input.model);

      const json = yield* Effect.tryPromise({
        try: async () => {
          // @effect-diagnostics-next-line globalFetchInEffect:off - Provider adapters run at the Node HTTP boundary.
          const response = await globalThis.fetch(
            makeGeminiGenerateContentUrl({ model, stream: false }),
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              // @effect-diagnostics-next-line preferSchemaOverJson:off - Gemini request bodies include provider-open schema objects.
              body: JSON.stringify(body),
            },
          );
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(
              `Gemini generateContent failed (${response.status}): ${detail.slice(0, 400)}`,
            );
          }

          const result = geminiResponseToText((await response.json()) as unknown);
          if (!result.text.trim()) {
            throw new Error("Gemini returned an empty JSON response.");
          }
          return parseGeminiJsonText(result.text);
        },
        catch: (cause) => textGenerationError(input.operation, compactError(cause), cause),
      });

      // oxlint-disable-next-line t3code/no-inline-schema-compile -- The structured output schema is selected per text-generation operation.
      return yield* Schema.decodeUnknownEffect(input.outputSchema)(json).pipe(
        Effect.mapError((cause) =>
          textGenerationError(input.operation, "Gemini returned invalid structured output.", cause),
        ),
      );
    });

    const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
      Effect.fn("GeminiTextGeneration.generateCommitMessage")(function* (input) {
        const { prompt, outputSchema } = buildCommitMessagePrompt({
          branch: input.branch,
          stagedSummary: input.stagedSummary,
          stagedPatch: input.stagedPatch,
          includeBranch: input.includeBranch === true,
        });
        const generated = yield* runGeminiJson({
          operation: "generateCommitMessage",
          cwd: input.cwd,
          prompt,
          outputSchema,
          model: input.modelSelection.model,
        });

        return {
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        };
      });

    const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
      Effect.fn("GeminiTextGeneration.generatePrContent")(function* (input) {
        const { prompt, outputSchema } = buildPrContentPrompt({
          baseBranch: input.baseBranch,
          headBranch: input.headBranch,
          commitSummary: input.commitSummary,
          diffSummary: input.diffSummary,
          diffPatch: input.diffPatch,
        });
        const generated = yield* runGeminiJson({
          operation: "generatePrContent",
          cwd: input.cwd,
          prompt,
          outputSchema,
          model: input.modelSelection.model,
        });

        return {
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        };
      });

    const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
      Effect.fn("GeminiTextGeneration.generateBranchName")(function* (input) {
        const { prompt, outputSchema } = buildBranchNamePrompt({
          message: input.message,
          attachments: input.attachments,
        });
        const generated = yield* runGeminiJson({
          operation: "generateBranchName",
          cwd: input.cwd,
          prompt,
          outputSchema,
          model: input.modelSelection.model,
          attachments: input.attachments,
        });

        return {
          branch: sanitizeBranchFragment(generated.branch),
        };
      });

    const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
      Effect.fn("GeminiTextGeneration.generateThreadTitle")(function* (input) {
        const { prompt, outputSchema } = buildThreadTitlePrompt({
          message: input.message,
          attachments: input.attachments,
        });
        const generated = yield* runGeminiJson({
          operation: "generateThreadTitle",
          cwd: input.cwd,
          prompt,
          outputSchema,
          model: input.modelSelection.model,
          attachments: input.attachments,
        });

        return {
          title: sanitizeThreadTitle(generated.title),
        };
      });

    return TextGeneration.TextGeneration.of({
      generateCommitMessage,
      generatePrContent,
      generateBranchName,
      generateThreadTitle,
    });
  });
}
