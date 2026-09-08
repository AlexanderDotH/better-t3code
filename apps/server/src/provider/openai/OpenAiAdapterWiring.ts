import { ProviderDriverKind } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import { makeNativeProviderAdapter } from "../nativeHarness/NativeProviderAdapter.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
} from "../nativeHarness/NativeHarnessTools.ts";
import { normalizeOpenAiAdapterRoundEvent } from "./OpenAiAdapterEventNormalization.ts";
import { resolveOpenAiModel } from "./OpenAiAdapterModelPolicy.ts";
import { encodeOpenAiJsonUnknown, openAiHistoryStrategy } from "./OpenAiAdapterPersistence.ts";
import { buildOpenAiSystemInstructions } from "./OpenAiAdapterSystemPrompt.ts";
import type {
  OpenAiAdapterOptions,
  OpenAiAdapterSettings,
  OpenAiProtocolState,
  OpenAiSessionState,
} from "./OpenAiAdapterTypes.ts";
import type { OpenAiAdapterToolCall } from "./OpenAiAdapterEventNormalization.ts";
import type {
  OpenAiHistoryItem,
  OpenAiReasoningEffort,
  OpenAiToolDefinition,
} from "./OpenAiProtocol.ts";

const PROVIDER = ProviderDriverKind.make("openai");
const OPENAI_MAX_SESSIONS = 40;
const OPENAI_MAX_IDLE_WORKING_SETS = 8;
const OPENAI_MAX_PARALLEL_TOOL_CALLS = 8;

function providerRequestError(method: string, detail: string, cause?: unknown) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    const detail = cause.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return "OpenAI adapter dependency failed.";
}

export const makeOpenAiAdapter = Effect.fn("makeOpenAiAdapter")(function* (
  settings: OpenAiAdapterSettings,
  options: OpenAiAdapterOptions,
) {
  const { instanceId } = options;
  const listModels = (method: string) =>
    options.transport.listModels.pipe(
      Effect.mapError((cause) =>
        providerRequestError(method, `OpenAI model discovery failed: ${errorDetail(cause)}`, cause),
      ),
    );

  return yield* makeNativeProviderAdapter<
    OpenAiHistoryItem,
    OpenAiSessionState,
    OpenAiProtocolState,
    OpenAiToolDefinition,
    OpenAiAdapterToolCall
  >({
    provider: PROVIDER,
    instanceId,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    messages: {
      sessionStarted: "OpenAI Responses session owned by T3 Code",
      sessionReady: "OpenAI Responses session ready",
      turnRunning: "OpenAI Responses turn running",
      turnSettled: "OpenAI Responses turn settled",
    },
    limits: {
      maxSessions: OPENAI_MAX_SESSIONS,
      maxIdleWorkingSets: OPENAI_MAX_IDLE_WORKING_SETS,
      maxToolDefinitions: NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
      maxToolOutputBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
      maxParallelToolCalls: OPENAI_MAX_PARALLEL_TOOL_CALLS,
    },
    history: openAiHistoryStrategy,
    start: ({ input }) =>
      Effect.gen(function* () {
        if (!settings.enabled) {
          return yield* providerRequestError(
            "session/start",
            "OpenAI Responses is disabled in this provider instance.",
          );
        }
        const catalog = yield* listModels("models/list");
        const requestedModel =
          input.modelSelection?.instanceId === instanceId ? input.modelSelection.model : undefined;
        const resolution = resolveOpenAiModel(settings, catalog, requestedModel);
        if (!resolution.ok) return yield* providerRequestError("session/start", resolution.issue);
        return {
          model: resolution.model,
          state: { initialCatalog: catalog },
          configured: {
            harness: "t3-code",
            api: "responses",
            model: resolution.model,
            stateless: true,
          },
        };
      }),
    prepareTurn: ({ input, session, readAttachment }) =>
      Effect.gen(function* () {
        const catalog = yield* listModels("models/list");
        const requestedModel =
          input.modelSelection?.instanceId === instanceId
            ? input.modelSelection.model
            : session.session.model;
        const resolution = resolveOpenAiModel(settings, catalog, requestedModel);
        if (!resolution.ok) return yield* providerRequestError("session/prompt", resolution.issue);
        const requestedReasoningEffort =
          input.modelSelection?.instanceId === instanceId
            ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
            : undefined;
        const reasoningEffort = resolution.catalogModel.reasoningEfforts.find(
          (candidate) => candidate === requestedReasoningEffort,
        ) as OpenAiReasoningEffort | undefined;
        if (requestedReasoningEffort !== undefined && reasoningEffort === undefined) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Reasoning effort '${requestedReasoningEffort}' is not available for model '${resolution.model}'.`,
          });
        }

        const content: Array<Record<string, Schema.Json>> = [];
        const persistedContent: Array<Record<string, Schema.Json>> = [];
        if (input.input?.trim()) {
          const text = { type: "input_text", text: input.input.trim() };
          content.push(text);
          persistedContent.push(text);
        }
        let attachmentBytes = 0;
        for (const attachment of input.attachments ?? []) {
          if (attachment.type !== "image") continue;
          const bytes = yield* readAttachment(attachment);
          attachmentBytes += bytes.byteLength;
          content.push({
            type: "input_image",
            image_url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
            detail: "auto",
          });
          persistedContent.push({
            type: "input_text",
            text: `[Attached image: ${attachment.name} (${attachment.mimeType}, ${bytes.byteLength} bytes)]`,
          });
        }
        if (content.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text or an image attachment.",
          });
        }
        const declarations = yield* options.harness
          .declarations({
            threadId: input.threadId,
            cwd: session.cwd,
            interactionMode: input.interactionMode,
            sandboxMode: session.sandboxMode,
            fetchWorker: session.fetchWorker,
          })
          .pipe(
            Effect.mapError((cause) => providerRequestError("tools/catalog", cause.detail, cause)),
          );
        return {
          model: resolution.model,
          userHistoryItems: [{ type: "message", role: "user", content }],
          persistedUserHistoryItems: [{ type: "message", role: "user", content: persistedContent }],
          attachmentBytes,
          toolDeclarations: declarations.map((declaration) => ({
            name: declaration.name,
            description: declaration.description,
            parameters: declaration.inputSchema,
          })),
          protocol: {
            instructions: buildOpenAiSystemInstructions({
              cwd: session.cwd,
              sandboxMode: session.sandboxMode,
              interactionMode: input.interactionMode,
              fetchWorker: session.fetchWorker,
            }),
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          },
        };
      }),
    streamRound: ({ session, plan, signal }) =>
      options.transport
        .streamRound({
          model: plan.model,
          instructions: plan.protocol.instructions,
          history: session.history,
          tools: plan.toolDeclarations,
          ...(plan.protocol.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: plan.protocol.reasoningEffort }),
          signal,
        })
        .pipe(
          Stream.map(normalizeOpenAiAdapterRoundEvent),
          Stream.mapError((cause) =>
            providerRequestError(
              "responses/stream",
              `OpenAI response failed: ${errorDetail(cause)}`,
              cause,
            ),
          ),
        ),
    toolHarness: {
      isAvailable: (input) =>
        options.harness
          .isAvailable(input)
          .pipe(
            Effect.mapError((cause) =>
              providerRequestError("tools/availability", cause.detail, cause),
            ),
          ),
      requiresApproval: options.harness.requiresApproval,
      requestType: options.harness.requestType,
      approvalDetail: options.harness.approvalDetail,
      execute: (input) =>
        options.harness.execute(input).pipe(
          Effect.catchCause((cause) => {
            const detail = errorDetail(Cause.squash(cause));
            return Effect.succeed({
              ok: false,
              itemType: "dynamic_tool_call" as const,
              title: input.name,
              detail,
              output: { error: detail },
            });
          }),
        ),
      ...(options.harness.releaseThread === undefined
        ? {}
        : { releaseThread: options.harness.releaseThread }),
    },
    toolResultsToHistoryItems: ({ results }) =>
      results.map(({ call, result }) => ({
        type: "function_call_output",
        call_id: call.metadata.callId,
        output: encodeOpenAiJsonUnknown(result.output),
      })),
    ...(options.admission === undefined ? {} : { admission: options.admission }),
    ...(options.onWorkingSetEvicted === undefined
      ? {}
      : { onWorkingSetEvicted: options.onWorkingSetEvicted }),
    mcp: {
      includeT3BuiltIn: true,
      ...(options.resolveMcpServers === undefined
        ? {}
        : {
            resolveServers: ({ cwd }) =>
              options.resolveMcpServers!({ cwd }).pipe(
                Effect.mapError((cause) =>
                  providerRequestError("mcp/configuration", errorDetail(cause), cause),
                ),
              ),
          }),
    },
  });
});
