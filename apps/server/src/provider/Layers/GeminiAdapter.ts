import type {
  Content,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
} from "@google/genai";
import {
  GEMINI_DEFAULT_MODEL,
  type GeminiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import {
  makeGeminiClient,
  resolveGeminiApiKey,
  type GeminiClient,
  type GeminiClientFactory,
} from "../GeminiClient.ts";
import {
  makeNativeProviderAdapter,
  type NativeProviderHistoryStrategy,
  type NativeProviderRoundEvent,
  type NativeProviderToolCall,
} from "../nativeHarness/NativeProviderAdapter.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_HARNESS_MAX_TOOL_ROUNDS,
} from "../nativeHarness/NativeHarnessTools.ts";
import {
  geminiToolApprovalDetail,
  geminiToolDeclarations,
  geminiToolIsAvailable,
  geminiToolRequestType,
  geminiToolRequiresApproval,
  type GeminiHarnessToolExecutor,
} from "./GeminiHarness.ts";

const PROVIDER = ProviderDriverKind.make("gemini");
const GEMINI_RESUME_VERSION = 1 as const;
const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export interface GeminiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  readonly clientFactory?: GeminiClientFactory;
  readonly toolExecutor: GeminiHarnessToolExecutor;
}

interface GeminiTurnRecord {
  readonly id: TurnId;
  readonly historyStart: number;
  readonly historyEnd: number;
  readonly items: Array<unknown>;
}

interface PersistedGeminiSession {
  readonly schemaVersion: typeof GEMINI_RESUME_VERSION;
  readonly sessionId: string;
  readonly contents: Array<Content>;
  readonly turns: Array<GeminiTurnRecord>;
}

interface GeminiProtocolState {
  readonly client: GeminiClient;
  readonly instructions: string;
}

type GeminiToolCall = NativeProviderToolCall<{ readonly id: string | undefined }>;

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (Predicate.isObject(cause) && Predicate.isString(cause.message) && cause.message.trim()) {
    return cause.message.trim();
  }
  return String(cause).trim() || "Unknown Gemini API failure.";
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function parsePersistedContent(raw: unknown): Array<Content> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const contents: Array<Content> = [];
  for (const value of raw) {
    if (!Predicate.isObject(value) || !Array.isArray(value.parts)) return undefined;
    if (value.role !== undefined && value.role !== "user" && value.role !== "model") {
      return undefined;
    }
    if (!value.parts.every(Predicate.isObject)) return undefined;
    contents.push({
      ...(Predicate.isString(value.role) ? { role: value.role } : {}),
      parts: value.parts as Array<Part>,
    });
  }
  return contents;
}

function parsePersistedTurns(raw: unknown): Array<GeminiTurnRecord> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const turns: Array<GeminiTurnRecord> = [];
  for (const value of raw) {
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
    turns.push({
      id: TurnId.make(value.id),
      historyStart,
      historyEnd,
      items: [...value.items],
    });
  }
  return turns;
}

function parsePersistedSession(
  raw: unknown,
  sessionId: string,
): PersistedGeminiSession | undefined {
  if (
    !Predicate.isObject(raw) ||
    raw.schemaVersion !== GEMINI_RESUME_VERSION ||
    raw.sessionId !== sessionId
  ) {
    return undefined;
  }
  const contents = parsePersistedContent(raw.contents);
  const turns = parsePersistedTurns(raw.turns);
  return contents && turns
    ? { schemaVersion: GEMINI_RESUME_VERSION, sessionId, contents, turns }
    : undefined;
}

function systemInstruction(input: {
  readonly cwd: string;
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  readonly interactionMode: "default" | "plan" | undefined;
  readonly fetchWorker: boolean;
}): string {
  const access =
    input.interactionMode === "plan" || input.sandboxMode === "read-only" || input.fetchWorker
      ? "Read-only: inspect the workspace but do not modify files or run commands."
      : input.sandboxMode === "workspace-write"
        ? "Workspace-write: you may inspect and edit workspace files through T3 tools; shell execution is unavailable."
        : "T3 may offer workspace edits and bounded command execution, subject to its approval policy.";
  const role = input.fetchWorker
    ? "Complete the requested read-only exploration concisely."
    : "Act as a coding agent and carry the user's request through verification.";
  return [
    "You are Gemini running inside T3 Code. T3 Code is the harness and owns the session, conversation history, tool loop, permissions, and filesystem boundary.",
    `The trusted workspace root is ${input.cwd}.`,
    role,
    access,
    "Use workspace_context to inspect the repository before making assumptions. Batch independent searches and reads.",
    "Only call tools that T3 explicitly provides. Never invent tool results or claim a change or test succeeded without evidence.",
    input.interactionMode === "plan"
      ? "Plan mode is active: return a decision-complete plan and make no changes."
      : "Keep changes focused, preserve unrelated work, and report the verification performed.",
  ].join("\n");
}

function functionCallKey(call: FunctionCall): string {
  try {
    return `${call.id ?? ""}:${call.name ?? ""}:${JSON.stringify(call.args ?? {})}`;
  } catch {
    return `${call.id ?? ""}:${call.name ?? ""}`;
  }
}

function providerRequestError(method: string, detail: string, cause?: unknown) {
  return new ProviderAdapterRequestError({ provider: PROVIDER, method, detail, cause });
}

function normalizedUsage(usage: GenerateContentResponseUsageMetadata) {
  return {
    usedTokens: nonNegativeInteger(usage.totalTokenCount),
    inputTokens: nonNegativeInteger(usage.promptTokenCount),
    cachedInputTokens: nonNegativeInteger(usage.cachedContentTokenCount),
    outputTokens: nonNegativeInteger(usage.candidatesTokenCount),
    reasoningOutputTokens: nonNegativeInteger(usage.thoughtsTokenCount),
    raw: usage,
  };
}

function streamGeminiRound(input: {
  readonly client: GeminiClient;
  readonly model: string;
  readonly contents: ReadonlyArray<Content>;
  readonly declarations: ReadonlyArray<FunctionDeclaration>;
  readonly instructions: string;
  readonly signal: AbortSignal;
}): Stream.Stream<NativeProviderRoundEvent<Content, GeminiToolCall>, ProviderAdapterRequestError> {
  return Stream.unwrap(
    Effect.tryPromise({
      try: () =>
        input.client.models.generateContentStream({
          model: input.model,
          contents: [...input.contents],
          config: {
            abortSignal: input.signal,
            systemInstruction: input.instructions,
            ...(input.declarations.length > 0
              ? { tools: [{ functionDeclarations: [...input.declarations] }] }
              : {}),
          },
        }),
      catch: (cause) =>
        providerRequestError("models.generateContentStream", errorDetail(cause), cause),
    }).pipe(
      Effect.map((generator) => {
        const parts: Array<Part> = [];
        const calls: Array<GeminiToolCall> = [];
        const seenCalls = new Set<string>();
        let usage: GenerateContentResponseUsageMetadata | undefined;
        let finishReason: string | null = null;

        const chunkEvents = (
          chunk: GenerateContentResponse,
        ): ReadonlyArray<NativeProviderRoundEvent<Content, GeminiToolCall>> => {
          usage = chunk.usageMetadata ?? usage;
          const candidate = chunk.candidates?.[0];
          if (candidate?.finishReason) finishReason = String(candidate.finishReason);
          const events: Array<NativeProviderRoundEvent<Content, GeminiToolCall>> = [];
          for (const part of candidate?.content?.parts ?? []) {
            parts.push({ ...part });
            if (typeof part.text === "string" && part.text.length > 0) {
              events.push({
                type: "contentDelta",
                kind: part.thought === true ? "reasoning" : "assistant",
                delta: part.text,
              });
            }
            if (part.functionCall) {
              const key = functionCallKey(part.functionCall);
              if (!seenCalls.has(key)) {
                seenCalls.add(key);
                const name = part.functionCall.name?.trim() || "unknown_tool";
                calls.push({
                  ...(part.functionCall.id ? { sourceId: part.functionCall.id } : {}),
                  name,
                  args: part.functionCall.args ?? {},
                  metadata: { id: part.functionCall.id },
                });
              }
            }
          }
          return events;
        };

        const terminal = Effect.sync(
          (): NativeProviderRoundEvent<Content, GeminiToolCall> =>
            parts.length === 0
              ? { type: "failed", message: "Gemini returned no content." }
              : {
                  type: "completed",
                  historyItems: [{ role: "model", parts }],
                  toolCalls: calls,
                  stopReason: finishReason,
                  ...(usage ? { usage: normalizedUsage(usage) } : {}),
                },
        );
        return Stream.fromAsyncIterable(generator, (cause) =>
          providerRequestError("models.generateContentStream", errorDetail(cause), cause),
        ).pipe(
          Stream.flatMap((chunk) => Stream.fromIterable(chunkEvents(chunk))),
          Stream.concat(Stream.fromEffect(terminal)),
        );
      }),
    ),
  );
}

export function makeGeminiAdapter(settings: GeminiSettings, options: GeminiAdapterLiveOptions) {
  const instanceId = options.instanceId ?? ProviderInstanceId.make("gemini");
  const environment = options.environment ?? process.env;
  const clientFactory = options.clientFactory ?? makeGeminiClient;

  const history: NativeProviderHistoryStrategy<Content> = {
    directoryName: "gemini",
    resumeVersion: GEMINI_RESUME_VERSION,
    encode: ({ sessionId, history: contents, turns }) =>
      JSON.stringify({
        schemaVersion: GEMINI_RESUME_VERSION,
        sessionId,
        contents,
        turns,
      } satisfies PersistedGeminiSession),
    decode: (encoded, sessionId) =>
      decodeJsonUnknown(encoded).pipe(
        Effect.mapError((cause) =>
          providerRequestError(
            "session/resume",
            `Gemini session '${sessionId}' contains invalid JSON.`,
            cause,
          ),
        ),
        Effect.flatMap((decoded) => {
          const persisted = parsePersistedSession(decoded, sessionId);
          return persisted
            ? Effect.succeed({
                history: persisted.contents,
                turns: persisted.turns,
                totalProcessedTokens: 0,
              })
            : Effect.fail(
                providerRequestError(
                  "session/resume",
                  `Gemini session '${sessionId}' has an unsupported or invalid format.`,
                ),
              );
        }),
      ),
  };

  return makeNativeProviderAdapter<
    Content,
    object,
    GeminiProtocolState,
    FunctionDeclaration,
    GeminiToolCall
  >({
    provider: PROVIDER,
    instanceId,
    environment,
    capabilities: { sessionModelSwitch: "in-session", mcp: "unsupported" },
    messages: {
      sessionStarted: "Gemini SDK session owned by T3 Code",
      sessionReady: "Gemini SDK session ready",
      turnRunning: "Gemini turn running",
      turnSettled: "Gemini turn settled",
    },
    limits: {
      maxToolDefinitions: NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
      maxToolOutputBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
      maxToolRounds: NATIVE_HARNESS_MAX_TOOL_ROUNDS,
      maxParallelToolCalls: 1,
    },
    history,
    start: ({ input }) =>
      Effect.gen(function* () {
        if (!settings.enabled) {
          return yield* providerRequestError(
            "session/start",
            "Gemini is disabled in this provider instance.",
          );
        }
        if (!resolveGeminiApiKey(environment)) {
          return yield* providerRequestError(
            "session/start",
            "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
          );
        }
        const modelSelection =
          input.modelSelection?.instanceId === instanceId ? input.modelSelection : undefined;
        const model = modelSelection?.model ?? GEMINI_DEFAULT_MODEL;
        return {
          model,
          state: {},
          configured: {
            harness: "t3-code",
            sdk: "@google/genai",
            model,
            mcp: "unsupported",
          },
        };
      }),
    prepareTurn: ({ input, session, readAttachment }) =>
      Effect.gen(function* () {
        const credential = resolveGeminiApiKey(environment);
        if (!credential) {
          return yield* providerRequestError(
            "session/prompt",
            "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
          );
        }
        const userParts: Array<Part> = [];
        if (input.input?.trim()) userParts.push({ text: input.input.trim() });
        let attachmentBytes = 0;
        for (const attachment of input.attachments ?? []) {
          const bytes = yield* readAttachment(attachment);
          attachmentBytes += bytes.byteLength;
          userParts.push({
            inlineData: {
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType,
              displayName: attachment.name,
            },
          });
        }
        if (userParts.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text or attachments.",
          });
        }
        const model =
          input.modelSelection?.instanceId === instanceId
            ? input.modelSelection.model
            : (session.session.model ?? GEMINI_DEFAULT_MODEL);
        const declarations = geminiToolDeclarations({
          interactionMode: input.interactionMode,
          sandboxMode: session.sandboxMode,
        });
        return {
          model,
          userHistoryItems: [{ role: "user", parts: userParts }],
          attachmentBytes,
          toolDeclarations: declarations,
          protocol: {
            client: clientFactory(credential.apiKey),
            instructions: systemInstruction({
              cwd: session.cwd,
              sandboxMode: session.sandboxMode,
              interactionMode: input.interactionMode,
              fetchWorker: session.fetchWorker,
            }),
          },
        };
      }),
    streamRound: ({ session, plan, signal }) =>
      streamGeminiRound({
        client: plan.protocol.client,
        model: plan.model,
        contents: session.history,
        declarations: plan.toolDeclarations,
        instructions: plan.protocol.instructions,
        signal,
      }),
    toolHarness: {
      isAvailable: ({ toolName, interactionMode, sandboxMode }) =>
        Effect.succeed(geminiToolIsAvailable({ toolName, interactionMode, sandboxMode })),
      requiresApproval: geminiToolRequiresApproval,
      requestType: geminiToolRequestType,
      approvalDetail: geminiToolApprovalDetail,
      execute: ({ name, args, cwd, environment: toolEnvironment }) =>
        options.toolExecutor.execute({ name, args, cwd, environment: toolEnvironment }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed({
              ok: false,
              itemType: "dynamic_tool_call" as const,
              title: name,
              detail: errorDetail(Cause.squash(cause)),
              output: { error: errorDetail(Cause.squash(cause)) },
            }),
          ),
        ),
    },
    toolResultsToHistoryItems: ({ results }) => [
      {
        role: "user",
        parts: results.map(({ call, result }) => ({
          functionResponse: {
            ...(call.metadata.id ? { id: call.metadata.id } : {}),
            name: call.name,
            response: result.output,
          },
        })),
      },
    ],
  });
}
