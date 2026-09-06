import {
  type CanonicalRequestType,
  type McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSession,
  type ServerProviderRateLimit,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import {
  makeNativeProviderAdapter,
  type NativeProviderHistoryStrategy,
  type NativeProviderRoundEvent,
  type NativeProviderToolCall,
  type NativeProviderToolResult,
  type NativeProviderTurnAdmission,
} from "../nativeHarness/NativeProviderAdapter.ts";
import { nativeHarnessWorkspaceInstructions } from "../nativeHarness/NativeHarnessPrompt.ts";

const PROVIDER = ProviderDriverKind.make("chatgpt");
const CHATGPT_RESUME_VERSION = 1 as const;
const CHATGPT_MAX_SESSIONS = 40;
export const CHATGPT_MAX_IDLE_WORKING_SETS = 8;
const CHATGPT_COMPACTION_THRESHOLD_RATIO = 0.8;
export const CHATGPT_MAX_TOOL_DEFINITIONS = 90;
export const CHATGPT_MAX_TOOL_OUTPUT_BYTES = 1_048_576;
const CHATGPT_MAX_PARALLEL_TOOL_CALLS = 8;
const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJsonUnknownSync = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class ChatGptAdapterBoundaryError extends Schema.TaggedErrorClass<ChatGptAdapterBoundaryError>()(
  "ChatGptAdapterBoundaryError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `ChatGPT adapter boundary failed during ${this.operation}: ${this.detail}`;
  }
}

export interface ChatGptAdapterModel {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly default?: boolean;
  readonly reasoningEfforts: ReadonlyArray<string>;
}

export type ChatGptAdapterResponseItem = Readonly<Record<string, unknown>> & {
  readonly type: string;
  readonly id?: string;
};

export interface ChatGptAdapterUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens: number;
}

export type ChatGptAdapterStreamEvent =
  | { readonly type: "outputTextDelta"; readonly itemId: string; readonly delta: string }
  | {
      readonly type: "reasoningDelta";
      readonly itemId: string;
      readonly delta: string;
      readonly encryptedContent?: string;
    }
  | { readonly type: "outputItemDone"; readonly item: ChatGptAdapterResponseItem }
  | {
      readonly type: "responseCompleted";
      readonly responseId: string;
      readonly status: "completed" | "incomplete";
      readonly outputItems: ReadonlyArray<ChatGptAdapterResponseItem>;
      readonly usage?: ChatGptAdapterUsage;
    }
  | { readonly type: "responseFailed"; readonly message: string };

export interface ChatGptAdapterToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ChatGptAdapterResponseRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: ReadonlyArray<ChatGptAdapterResponseItem>;
  readonly tools: ReadonlyArray<ChatGptAdapterToolDefinition>;
  readonly reasoningEffort?: string;
  readonly signal: AbortSignal;
}

export interface ChatGptAdapterCompactRequest {
  readonly model: string;
  readonly input: ReadonlyArray<ChatGptAdapterResponseItem>;
}

export interface ChatGptAdapterCompactResult {
  readonly input: ReadonlyArray<ChatGptAdapterResponseItem>;
}

export interface ChatGptAdapterTransport {
  readonly rateLimit?: Effect.Effect<ServerProviderRateLimit> | undefined;
  readonly listModels: Effect.Effect<
    ReadonlyArray<ChatGptAdapterModel>,
    ChatGptAdapterBoundaryError
  >;
  readonly streamResponse: (
    request: ChatGptAdapterResponseRequest,
  ) => Stream.Stream<ChatGptAdapterStreamEvent, ChatGptAdapterBoundaryError>;
  readonly compact: (
    request: ChatGptAdapterCompactRequest,
  ) => Effect.Effect<ChatGptAdapterCompactResult, ChatGptAdapterBoundaryError>;
}

export interface ChatGptHarnessResult extends NativeProviderToolResult {}

export interface ChatGptHarness {
  readonly declarations: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly interactionMode: "default" | "plan" | undefined;
    readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<ReadonlyArray<ChatGptAdapterToolDefinition>, ChatGptAdapterBoundaryError>;
  readonly isAvailable: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly toolName: string;
    readonly interactionMode: "default" | "plan" | undefined;
    readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<boolean, ChatGptAdapterBoundaryError>;
  readonly requiresApproval: (
    toolName: string,
    runtimeMode: ProviderSession["runtimeMode"],
  ) => boolean;
  readonly requestType: (toolName: string) => CanonicalRequestType;
  readonly approvalDetail: (toolName: string, args: Readonly<Record<string, unknown>>) => string;
  readonly execute: (input: {
    readonly threadId: ThreadId;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<ChatGptHarnessResult, ChatGptAdapterBoundaryError>;
  readonly releaseThread?: (threadId: ThreadId) => Effect.Effect<void>;
}

export type ChatGptTurnAdmission = NativeProviderTurnAdmission;

export interface ChatGptAdapterSettings {
  readonly enabled: boolean;
}

export interface ChatGptAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly transport: ChatGptAdapterTransport;
  readonly harness: ChatGptHarness;
  readonly admission?: ChatGptTurnAdmission;
  readonly onWorkingSetEvicted?: ((threadId: ThreadId) => void) | undefined;
  readonly authorize?: Effect.Effect<boolean, ChatGptAdapterBoundaryError> | undefined;
  readonly resolveMcpServers?:
    | ((input: {
        readonly cwd: string;
      }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, ChatGptAdapterBoundaryError>)
    | undefined;
}

interface ChatGptTurnRecord {
  readonly id: TurnId;
  readonly historyStart: number;
  readonly historyEnd: number;
  readonly items: Array<unknown>;
}

interface PersistedChatGptSession {
  readonly schemaVersion: typeof CHATGPT_RESUME_VERSION;
  readonly sessionId: string;
  readonly inputItems: Array<ChatGptAdapterResponseItem>;
  readonly turns: Array<ChatGptTurnRecord>;
  readonly totalProcessedTokens: number;
}

interface ChatGptSessionState {
  readonly models: ReadonlyArray<ChatGptAdapterModel>;
}

interface ChatGptProtocolState {
  readonly instructions: string;
  readonly reasoningEffort: string | undefined;
}

type ChatGptToolCall = NativeProviderToolCall<{
  readonly callId: string;
  readonly item: ChatGptAdapterResponseItem;
}>;

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (Predicate.isObject(cause) && Predicate.isString(cause.message) && cause.message.trim()) {
    return cause.message.trim();
  }
  return String(cause).trim() || "Unknown ChatGPT subscription failure.";
}

function parsePersistedSession(
  raw: unknown,
  sessionId: string,
): PersistedChatGptSession | undefined {
  if (
    !Predicate.isObject(raw) ||
    raw.schemaVersion !== CHATGPT_RESUME_VERSION ||
    raw.sessionId !== sessionId ||
    !Array.isArray(raw.inputItems) ||
    !Array.isArray(raw.turns) ||
    !Predicate.isNumber(raw.totalProcessedTokens)
  ) {
    return undefined;
  }
  if (!raw.inputItems.every((item) => Predicate.isObject(item) && Predicate.isString(item.type))) {
    return undefined;
  }
  const turns: Array<ChatGptTurnRecord> = [];
  for (const value of raw.turns) {
    if (
      !Predicate.isObject(value) ||
      !Predicate.isString(value.id) ||
      !Number.isSafeInteger(value.historyStart) ||
      !Number.isSafeInteger(value.historyEnd) ||
      !Array.isArray(value.items)
    ) {
      return undefined;
    }
    const historyStart = value.historyStart as number;
    const historyEnd = value.historyEnd as number;
    if (historyStart < 0 || historyEnd < historyStart) return undefined;
    turns.push({ id: TurnId.make(value.id), historyStart, historyEnd, items: [...value.items] });
  }
  return {
    schemaVersion: CHATGPT_RESUME_VERSION,
    sessionId,
    inputItems: raw.inputItems as Array<ChatGptAdapterResponseItem>,
    turns,
    totalProcessedTokens: Math.max(0, Math.floor(raw.totalProcessedTokens)),
  };
}

function systemInstructions(input: {
  readonly cwd: string;
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  readonly interactionMode: "default" | "plan" | undefined;
  readonly fetchWorker: boolean;
}): string {
  const access =
    input.interactionMode === "plan" || input.sandboxMode === "read-only" || input.fetchWorker
      ? "Read-only: inspect the workspace but do not modify files or run commands."
      : input.sandboxMode === "workspace-write"
        ? "Workspace-write: inspect and edit workspace files through T3 tools."
        : "Use only tools exposed by T3 and respect every approval boundary.";
  return [
    "You are ChatGPT running inside T3 Code. T3 Code is the harness and owns the session, transcript, tool loop, approvals, and filesystem boundary.",
    `The trusted workspace root is ${input.cwd}.`,
    access,
    nativeHarnessWorkspaceInstructions(input),
    input.interactionMode === "plan"
      ? "Plan mode is active: return a decision-complete plan and make no changes."
      : "Carry the request through focused verification and preserve unrelated work.",
  ].join("\n");
}

function assistantTextFromItem(item: ChatGptAdapterResponseItem): string {
  if (item.type !== "message" || !Array.isArray(item.content)) return "";
  return item.content
    .filter(Predicate.isObject)
    .flatMap((content) =>
      content.type === "output_text" && Predicate.isString(content.text) ? [content.text] : [],
    )
    .join("");
}

function functionCallFromItem(item: ChatGptAdapterResponseItem): ChatGptToolCall | undefined {
  if (item.type !== "function_call") return undefined;
  const callId = Predicate.isString(item.callId)
    ? item.callId.trim()
    : Predicate.isString(item.call_id)
      ? item.call_id.trim()
      : "";
  const name = Predicate.isString(item.name) ? item.name.trim() : "";
  if (!callId || !name) return undefined;
  const rawArguments = item.arguments;
  if (Predicate.isObject(rawArguments)) {
    return {
      ...(item.id ? { sourceId: item.id } : {}),
      name,
      args: rawArguments,
      metadata: { callId, item },
    };
  }
  if (!Predicate.isString(rawArguments)) return undefined;
  try {
    const decoded = decodeJsonUnknownSync(rawArguments);
    return Predicate.isObject(decoded)
      ? {
          ...(item.id ? { sourceId: item.id } : {}),
          name,
          args: decoded,
          metadata: { callId, item },
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeStreamEvent(
  event: ChatGptAdapterStreamEvent,
): NativeProviderRoundEvent<ChatGptAdapterResponseItem, ChatGptToolCall> | undefined {
  if (event.type === "outputItemDone") return undefined;
  if (event.type === "outputTextDelta") {
    return { type: "contentDelta", kind: "assistant", sourceId: event.itemId, delta: event.delta };
  }
  if (event.type === "reasoningDelta") {
    return { type: "contentDelta", kind: "reasoning", sourceId: event.itemId, delta: event.delta };
  }
  if (event.type === "responseFailed") return { type: "failed", message: event.message };
  if (event.status !== "completed") {
    return { type: "failed", message: `ChatGPT response ended with status '${event.status}'.` };
  }
  const toolCalls = event.outputItems.flatMap((item) => {
    if (item.type !== "function_call") return [];
    const call = functionCallFromItem(item);
    return call ? [call] : [];
  });
  if (
    event.outputItems.some(
      (item) => item.type === "function_call" && functionCallFromItem(item) === undefined,
    )
  ) {
    return { type: "failed", message: "ChatGPT returned a malformed function call." };
  }
  return {
    type: "completed",
    historyItems: event.outputItems,
    toolCalls,
    assistantText: event.outputItems.map(assistantTextFromItem).join(""),
    ...(event.usage
      ? {
          usage: {
            usedTokens: Math.max(0, Math.floor(event.usage.totalTokens)),
            inputTokens: Math.max(0, Math.floor(event.usage.inputTokens)),
            cachedInputTokens: Math.max(0, Math.floor(event.usage.cachedInputTokens ?? 0)),
            outputTokens: Math.max(0, Math.floor(event.usage.outputTokens)),
            reasoningOutputTokens: Math.max(0, Math.floor(event.usage.reasoningOutputTokens ?? 0)),
          },
        }
      : {}),
  };
}

function providerRequestError(method: string, detail: string, cause?: unknown) {
  return new ProviderAdapterRequestError({ provider: PROVIDER, method, detail, cause });
}

export function makeChatGptAdapter(
  settings: ChatGptAdapterSettings,
  options: ChatGptAdapterOptions,
) {
  const instanceId = options.instanceId ?? ProviderInstanceId.make("chatgpt");
  const authorize = options.authorize ?? Effect.succeed(true);
  const requireAuthenticated = authorize.pipe(
    Effect.mapError((cause) =>
      providerRequestError(
        "authentication/status",
        `ChatGPT credential status could not be read: ${cause.detail}`,
        cause,
      ),
    ),
    Effect.flatMap((authenticated) =>
      authenticated
        ? Effect.void
        : Effect.fail(
            providerRequestError(
              "authentication/status",
              "Connect this ChatGPT Subscription instance before starting a turn.",
            ),
          ),
    ),
  );

  const history: NativeProviderHistoryStrategy<ChatGptAdapterResponseItem> = {
    directoryName: "chatgpt",
    resumeVersion: CHATGPT_RESUME_VERSION,
    estimateBytes: (items) => Buffer.byteLength(encodeJsonUnknown(items)),
    encode: ({ sessionId, history: inputItems, turns, totalProcessedTokens }) =>
      encodeJsonUnknown({
        schemaVersion: CHATGPT_RESUME_VERSION,
        sessionId,
        inputItems,
        turns,
        totalProcessedTokens,
      } satisfies PersistedChatGptSession),
    decode: (encoded, sessionId) =>
      decodeJsonUnknown(encoded).pipe(
        Effect.mapError((cause) =>
          providerRequestError(
            "session/resume",
            `ChatGPT session '${sessionId}' contains invalid JSON.`,
            cause,
          ),
        ),
        Effect.flatMap((decoded) => {
          const persisted = parsePersistedSession(decoded, sessionId);
          return persisted
            ? Effect.succeed({
                history: persisted.inputItems,
                turns: persisted.turns,
                totalProcessedTokens: persisted.totalProcessedTokens,
              })
            : Effect.fail(
                providerRequestError(
                  "session/resume",
                  `ChatGPT session '${sessionId}' has an unsupported or invalid format.`,
                ),
              );
        }),
      ),
  };

  return makeNativeProviderAdapter<
    ChatGptAdapterResponseItem,
    ChatGptSessionState,
    ChatGptProtocolState,
    ChatGptAdapterToolDefinition,
    ChatGptToolCall
  >({
    provider: PROVIDER,
    instanceId,
    ...(options.environment ? { environment: options.environment } : {}),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    messages: {
      sessionStarted: "ChatGPT Subscription session owned by T3 Code",
      sessionReady: "ChatGPT Subscription session ready",
      turnRunning: "ChatGPT Subscription turn running",
      turnSettled: "ChatGPT Subscription turn settled",
    },
    limits: {
      maxSessions: CHATGPT_MAX_SESSIONS,
      maxIdleWorkingSets: CHATGPT_MAX_IDLE_WORKING_SETS,
      maxToolDefinitions: CHATGPT_MAX_TOOL_DEFINITIONS,
      maxToolOutputBytes: CHATGPT_MAX_TOOL_OUTPUT_BYTES,
      maxParallelToolCalls: CHATGPT_MAX_PARALLEL_TOOL_CALLS,
    },
    history,
    start: ({ input }) =>
      Effect.gen(function* () {
        if (!settings.enabled) {
          return yield* providerRequestError(
            "session/start",
            "ChatGPT Subscription is disabled in this provider instance.",
          );
        }
        yield* requireAuthenticated;
        const models = yield* options.transport.listModels.pipe(
          Effect.mapError((cause) =>
            providerRequestError(
              "models/list",
              `Live ChatGPT model discovery failed: ${errorDetail(cause)}`,
              cause,
            ),
          ),
        );
        if (models.length === 0) {
          return yield* providerRequestError(
            "models/list",
            "The connected ChatGPT account returned no usable models.",
          );
        }
        const requestedModel =
          input.modelSelection?.instanceId === instanceId ? input.modelSelection.model : undefined;
        const model =
          requestedModel ?? models.find((candidate) => candidate.default)?.id ?? models[0]!.id;
        if (!models.some((candidate) => candidate.id === model)) {
          return yield* providerRequestError(
            "session/start",
            `Model '${model}' is not in the connected ChatGPT account's live catalog.`,
          );
        }
        return { model, state: { models }, configured: { harness: "t3-code", model } };
      }),
    prepareTurn: ({ input, session, readAttachment }) =>
      Effect.gen(function* () {
        yield* requireAuthenticated;
        const model =
          input.modelSelection?.instanceId === instanceId
            ? input.modelSelection.model
            : session.session.model;
        const selectedModel = session.state.models.find((candidate) => candidate.id === model);
        if (!model || !selectedModel) {
          return yield* providerRequestError(
            "session/prompt",
            model
              ? `Model '${model}' is not in the connected ChatGPT account's live catalog.`
              : "ChatGPT session has no live-catalog model.",
          );
        }
        const reasoningEffort =
          input.modelSelection?.instanceId === instanceId
            ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
            : undefined;
        if (
          reasoningEffort !== undefined &&
          !selectedModel.reasoningEfforts.includes(reasoningEffort)
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Reasoning effort '${reasoningEffort}' is not in model '${model}'s live catalog.`,
          });
        }
        const content: Array<Record<string, unknown>> = [];
        const persistedContent: Array<Record<string, unknown>> = [];
        if (input.input?.trim()) {
          const text = { type: "input_text", text: input.input.trim() } as const;
          content.push(text);
          persistedContent.push(text);
        }
        let attachmentBytes = 0;
        for (const attachment of input.attachments ?? []) {
          if (attachment.type !== "image") {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "ChatGPT Subscription currently accepts image attachments only.",
            });
          }
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
          model,
          userHistoryItems: [
            { type: "message", role: "user", content } satisfies ChatGptAdapterResponseItem,
          ],
          persistedUserHistoryItems: [
            {
              type: "message",
              role: "user",
              content: persistedContent,
            } satisfies ChatGptAdapterResponseItem,
          ],
          attachmentBytes,
          toolDeclarations: declarations,
          protocol: {
            instructions: systemInstructions({
              cwd: session.cwd,
              sandboxMode: session.sandboxMode,
              interactionMode: input.interactionMode,
              fetchWorker: session.fetchWorker,
            }),
            reasoningEffort,
          },
        };
      }),
    beforeRound: ({ session, plan }) =>
      Effect.gen(function* () {
        const selectedModel = session.state.models.find((candidate) => candidate.id === plan.model);
        if (!selectedModel) return;
        const serializedHistoryBytes = Buffer.byteLength(encodeJsonUnknown(session.history));
        const estimatedHistoryTokens = Math.ceil(serializedHistoryBytes / 4);
        if (
          session.history.length <= 1 ||
          estimatedHistoryTokens < selectedModel.contextWindow * CHATGPT_COMPACTION_THRESHOLD_RATIO
        ) {
          return;
        }
        const compacted = yield* options.transport
          .compact({ model: plan.model, input: [...session.history] })
          .pipe(
            Effect.mapError((cause) =>
              providerRequestError(
                "responses/compact",
                `ChatGPT compaction failed: ${errorDetail(cause)}`,
                cause,
              ),
            ),
          );
        const compactedBytes = Buffer.byteLength(encodeJsonUnknown(compacted.input));
        if (compactedBytes >= serializedHistoryBytes) {
          return yield* providerRequestError(
            "responses/compact",
            "ChatGPT compaction did not reduce the serialized history.",
          );
        }
        return { replacementHistory: compacted.input, resetTurnHistoryStart: true };
      }),
    streamRound: ({ session, plan, signal }) =>
      options.transport
        .streamResponse({
          model: plan.model,
          instructions: plan.protocol.instructions,
          input: [...session.history],
          tools: plan.toolDeclarations,
          ...(plan.protocol.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: plan.protocol.reasoningEffort }),
          signal,
        })
        .pipe(
          Stream.map(normalizeStreamEvent),
          Stream.filter(Predicate.isNotUndefined),
          Stream.mapError((cause) =>
            providerRequestError("responses/stream", errorDetail(cause), cause),
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
        options.harness
          .execute(input)
          .pipe(
            Effect.mapError((cause) => providerRequestError("tools/execute", cause.detail, cause)),
          ),
      releaseThread: options.harness.releaseThread,
    },
    toolResultsToHistoryItems: ({ results }) =>
      results.map(({ call, result }) => ({
        type: "function_call_output",
        call_id: call.metadata.callId,
        callId: call.metadata.callId,
        output: encodeJsonUnknown(result.output),
      })),
    admission: options.admission,
    onWorkingSetEvicted: options.onWorkingSetEvicted,
    mcp: {
      includeT3BuiltIn: true,
      resolveServers: options.resolveMcpServers
        ? ({ cwd }) =>
            options.resolveMcpServers!({ cwd }).pipe(
              Effect.mapError((cause) => providerRequestError("mcpRuntime", cause.detail, cause)),
            )
        : undefined,
    },
  });
}
