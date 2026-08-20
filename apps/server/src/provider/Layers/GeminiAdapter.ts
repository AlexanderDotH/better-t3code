import type {
  Content,
  FunctionCall,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
} from "@google/genai";
import {
  ApprovalRequestId,
  EventId,
  GEMINI_DEFAULT_MODEL,
  type GeminiSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeSessionId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "../../atomicWrite.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import {
  makeGeminiClient,
  resolveGeminiApiKey,
  type GeminiClient,
  type GeminiClientFactory,
} from "../GeminiClient.ts";
import { bindProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  makeBoundedProviderEventBroadcast,
  providerEventEncodedBytes,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
} from "../boundedEventQueue.ts";
import {
  geminiToolApprovalDetail,
  geminiToolDeclarations,
  geminiToolIsAvailable,
  geminiToolRequestType,
  geminiToolRequiresApproval,
  type GeminiHarnessToolExecutor,
  type GeminiHarnessToolResult,
} from "./GeminiHarness.ts";

const PROVIDER = ProviderDriverKind.make("gemini");
const GEMINI_RESUME_VERSION = 1 as const;
const GEMINI_MAX_TOOL_ROUNDS = 64;
const GEMINI_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export interface GeminiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  readonly clientFactory?: GeminiClientFactory;
  readonly toolExecutor: GeminiHarnessToolExecutor;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly toolName: string;
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

interface GeminiSessionContext {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  readonly fetchWorker: boolean;
  readonly emitRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly approvedForSession: Set<string>;
  readonly turnSemaphore: Semaphore.Semaphore;
  readonly contents: Array<Content>;
  readonly turns: Array<GeminiTurnRecord>;
  session: ProviderSession;
  activeAbortController: AbortController | undefined;
  activeInterrupt: Deferred.Deferred<void> | undefined;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
  totalProcessedTokens: number;
}

interface ModelRoundResult {
  readonly content: Content;
  readonly functionCalls: ReadonlyArray<FunctionCall>;
  readonly assistantText: string;
  readonly reasoningText: string;
  readonly finishReason: string | null;
  readonly usage: GenerateContentResponseUsageMetadata | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (isRecord(cause) && typeof cause.message === "string" && cause.message.trim()) {
    return cause.message.trim();
  }
  return String(cause).trim() || "Unknown Gemini API failure.";
}

function parseResumeCursor(raw: unknown): { readonly sessionId: string } | undefined {
  if (!isRecord(raw) || raw.schemaVersion !== GEMINI_RESUME_VERSION) return undefined;
  if (typeof raw.sessionId !== "string" || !GEMINI_SESSION_ID_PATTERN.test(raw.sessionId)) {
    return undefined;
  }
  return { sessionId: raw.sessionId };
}

function parsePersistedContent(raw: unknown): Array<Content> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const contents: Array<Content> = [];
  for (const value of raw) {
    if (!isRecord(value) || !Array.isArray(value.parts)) return undefined;
    if (value.role !== undefined && value.role !== "user" && value.role !== "model") {
      return undefined;
    }
    if (!value.parts.every(isRecord)) return undefined;
    contents.push({
      ...(typeof value.role === "string" ? { role: value.role } : {}),
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
      !isRecord(value) ||
      typeof value.id !== "string" ||
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
    !isRecord(raw) ||
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

function safeInstancePathSegment(instanceId: ProviderInstanceId): string {
  return instanceId.replace(/[^a-z0-9._-]+/giu, "_");
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function systemInstruction(input: {
  readonly cwd: string;
  readonly sandboxMode: GeminiSessionContext["sandboxMode"];
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

function toolEventData(name: string, args: Readonly<Record<string, unknown>>) {
  if (name === "write_file") {
    return {
      path: args.path,
      contentsBytes:
        typeof args.contents === "string" ? Buffer.byteLength(args.contents) : undefined,
      expectedRevision: args.expected_revision,
    };
  }
  if (name === "replace_text") {
    return {
      path: args.path,
      oldTextBytes:
        typeof args.old_text === "string" ? Buffer.byteLength(args.old_text) : undefined,
      newTextBytes:
        typeof args.new_text === "string" ? Buffer.byteLength(args.new_text) : undefined,
      replaceAll: args.replace_all,
    };
  }
  return args;
}

export function makeGeminiAdapter(settings: GeminiSettings, options: GeminiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options.instanceId ?? ProviderInstanceId.make("gemini");
    const environment = options.environment ?? process.env;
    const clientFactory = options.clientFactory ?? makeGeminiClient;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const serverConfig = yield* ServerConfig;
    const sessions = new Map<ThreadId, GeminiSessionContext>();
    const runtimeEventBroadcast = yield* makeBoundedProviderEventBroadcast<ProviderRuntimeEvent>({
      capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
      byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
      sizeOf: providerEventEncodedBytes,
    });

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUuid = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate a Gemini runtime identifier.",
            cause,
          }),
      ),
    );
    const makeEventStamp = () =>
      Effect.all({ eventId: Effect.map(randomUuid, EventId.make), createdAt: nowIso });
    const publishRuntimeEvent = (event: ProviderRuntimeEvent) =>
      runtimeEventBroadcast.publish(event).pipe(Effect.asVoid);
    const historyDirectory = path.join(
      serverConfig.stateDir,
      "provider-sessions",
      "gemini",
      safeInstancePathSegment(boundInstanceId),
    );
    const historyPath = (sessionId: string) => path.join(historyDirectory, `${sessionId}.json`);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<GeminiSessionContext, ProviderAdapterSessionNotFoundError> => {
      const context = sessions.get(threadId);
      return context && !context.stopped
        ? Effect.succeed(context)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };

    const persistSession = (context: GeminiSessionContext) =>
      writeFileStringAtomically({
        filePath: historyPath(context.sessionId),
        contents: JSON.stringify({
          schemaVersion: GEMINI_RESUME_VERSION,
          sessionId: context.sessionId,
          contents: context.contents,
          turns: context.turns,
        } satisfies PersistedGeminiSession),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/persist",
              detail: `Failed to persist Gemini session '${context.sessionId}'.`,
              cause,
            }),
        ),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

    const loadPersistedSession = (sessionId: string) =>
      Effect.gen(function* () {
        const filePath = historyPath(sessionId);
        const exists = yield* fileSystem.exists(filePath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/resume",
                detail: `Failed to inspect Gemini session '${sessionId}'.`,
                cause,
              }),
          ),
        );
        if (!exists) return undefined;
        const encoded = yield* fileSystem.readFileString(filePath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/resume",
                detail: `Failed to read Gemini session '${sessionId}'.`,
                cause,
              }),
          ),
        );
        const decoded = yield* decodeJsonUnknown(encoded).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/resume",
                detail: `Gemini session '${sessionId}' contains invalid JSON.`,
                cause,
              }),
          ),
        );
        const persisted = parsePersistedSession(decoded, sessionId);
        if (!persisted) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/resume",
            detail: `Gemini session '${sessionId}' has an unsupported or invalid format.`,
          });
        }
        return persisted;
      });

    const settleApprovalsAsCancelled = (context: GeminiSessionContext) =>
      Effect.forEach(
        context.pendingApprovals.values(),
        (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
        { discard: true },
      );

    const stopSessionInternal = (context: GeminiSessionContext) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        context.activeAbortController?.abort();
        if (context.activeInterrupt) {
          yield* Deferred.succeed(context.activeInterrupt, undefined).pipe(Effect.ignore);
        }
        yield* settleApprovalsAsCancelled(context);
        sessions.delete(context.threadId);
        const updatedAt = yield* nowIso;
        context.session = { ...context.session, status: "closed", updatedAt };
        yield* context.emitRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: context.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }
        if (
          input.providerInstanceId !== undefined &&
          input.providerInstanceId !== boundInstanceId
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider instance '${boundInstanceId}' but received '${input.providerInstanceId}'.`,
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "cwd is required and must be non-empty.",
          });
        }
        if (!settings.enabled) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/start",
            detail: "Gemini is disabled in this provider instance.",
          });
        }
        if (!resolveGeminiApiKey(environment)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/start",
            detail: "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) yield* stopSessionInternal(existing);

        const fetchWorker = input.purpose === "fetch-worker";
        const resume =
          !fetchWorker && !input.freshSession ? parseResumeCursor(input.resumeCursor) : undefined;
        const sessionId = resume?.sessionId ?? (yield* randomUuid);
        const persisted = resume ? yield* loadPersistedSession(sessionId) : undefined;
        if (resume && !persisted) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/resume",
            detail: `Gemini session '${sessionId}' is no longer available in T3-owned history.`,
          });
        }
        const runtimeSessionId = input.runtimeSessionId ?? RuntimeSessionId.make(yield* randomUuid);
        const createdAt = yield* nowIso;
        const modelSelection =
          input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
        const model = modelSelection?.model ?? GEMINI_DEFAULT_MODEL;
        const runtimeMode = fetchWorker ? "approval-required" : input.runtimeMode;
        const resumeCursor = { schemaVersion: GEMINI_RESUME_VERSION, sessionId } as const;
        const cwd = path.resolve(input.cwd.trim());
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode,
          cwd,
          model,
          threadId: input.threadId,
          runtimeSessionId,
          resumeCursor,
          createdAt,
          updatedAt: createdAt,
        };
        const context: GeminiSessionContext = {
          threadId: input.threadId,
          sessionId,
          cwd,
          sandboxMode: fetchWorker ? "read-only" : input.sandboxMode,
          fetchWorker,
          emitRuntimeEvent: bindProviderRuntimeEventOrigin(runtimeSessionId, publishRuntimeEvent),
          pendingApprovals: new Map(),
          approvedForSession: new Set(),
          turnSemaphore: yield* Semaphore.make(1),
          contents: persisted ? [...persisted.contents] : [],
          turns: persisted ? [...persisted.turns] : [],
          session,
          activeAbortController: undefined,
          activeInterrupt: undefined,
          activeTurnId: undefined,
          stopped: false,
          totalProcessedTokens: 0,
        };
        sessions.set(input.threadId, context);
        if (!persisted) yield* persistSession(context);

        yield* context.emitRuntimeEvent({
          type: "session.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { resume: resumeCursor, message: "Gemini SDK session owned by T3 Code" },
        });
        yield* context.emitRuntimeEvent({
          type: "session.configured",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: {
            config: {
              harness: "t3-code",
              sdk: "@google/genai",
              model,
              mcp: "unsupported",
              resumed: persisted !== undefined,
            },
          },
        });
        yield* context.emitRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { state: "ready", reason: "Gemini SDK session ready" },
        });
        yield* context.emitRuntimeEvent({
          type: "thread.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { providerThreadId: sessionId },
        });
        return session;
      });

    const executeTool = (
      context: GeminiSessionContext,
      turnId: TurnId,
      call: FunctionCall,
      interrupt: Deferred.Deferred<void>,
      interactionMode: "default" | "plan" | undefined,
    ): Effect.Effect<GeminiHarnessToolResult, never> =>
      Effect.gen(function* () {
        const name = call.name?.trim() || "unknown_tool";
        const args = call.args ?? {};
        const itemId = RuntimeItemId.make(call.id?.trim() || (yield* randomUuid));
        yield* context.emitRuntimeEvent({
          type: "item.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: context.threadId,
          turnId,
          itemId,
          payload: {
            itemType:
              name === "exec_command"
                ? "command_execution"
                : name === "write_file" || name === "replace_text"
                  ? "file_change"
                  : "mcp_tool_call",
            status: "inProgress",
            title: name,
            detail: geminiToolApprovalDetail(name, args),
            data: toolEventData(name, args),
          },
        });

        const available = geminiToolIsAvailable({
          toolName: name,
          interactionMode,
          sandboxMode: context.fetchWorker ? "read-only" : context.sandboxMode,
        });
        let decision: ProviderApprovalDecision = "accept";
        const requiresApproval =
          available &&
          !context.approvedForSession.has(name) &&
          geminiToolRequiresApproval(name, context.session.runtimeMode);
        if (requiresApproval) {
          const rawRequestId = yield* randomUuid;
          const requestId = ApprovalRequestId.make(rawRequestId);
          const runtimeRequestId = RuntimeRequestId.make(rawRequestId);
          const pending = {
            decision: yield* Deferred.make<ProviderApprovalDecision>(),
            toolName: name,
          };
          context.pendingApprovals.set(requestId, pending);
          const requestType = geminiToolRequestType(name);
          yield* context.emitRuntimeEvent({
            type: "request.opened",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: context.threadId,
            turnId,
            itemId,
            requestId: runtimeRequestId,
            payload: {
              requestType,
              detail: geminiToolApprovalDetail(name, args),
              args,
            },
          });
          decision = yield* Effect.raceFirst(
            Deferred.await(pending.decision),
            Deferred.await(interrupt).pipe(Effect.andThen(Effect.interrupt)),
          ).pipe(Effect.ensuring(Effect.sync(() => context.pendingApprovals.delete(requestId))));
          yield* context.emitRuntimeEvent({
            type: "request.resolved",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: context.threadId,
            turnId,
            itemId,
            requestId: runtimeRequestId,
            payload: { requestType, decision },
          });
          if (decision === "acceptForSession") context.approvedForSession.add(name);
        }

        const declined = decision === "decline" || decision === "cancel";
        const result: GeminiHarnessToolResult = !available
          ? {
              ok: false,
              itemType:
                name === "exec_command"
                  ? "command_execution"
                  : name === "write_file" || name === "replace_text"
                    ? "file_change"
                    : "dynamic_tool_call",
              title: name,
              detail: `T3 did not expose '${name}' for this session mode.`,
              output: { error: `Tool '${name}' is not available in this session mode.` },
            }
          : declined
            ? {
                ok: false,
                itemType: "dynamic_tool_call",
                title: name,
                detail: decision === "cancel" ? "Tool call cancelled." : "Tool call declined.",
                output: { error: `Tool call ${decision}.` },
              }
            : yield* Effect.raceFirst(
                options.toolExecutor.execute({ name, args, cwd: context.cwd, environment }),
                Deferred.await(interrupt).pipe(Effect.andThen(Effect.interrupt)),
              );
        yield* context.emitRuntimeEvent({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: context.threadId,
          turnId,
          itemId,
          payload: {
            itemType: result.itemType,
            status: declined ? "declined" : result.ok ? "completed" : "failed",
            title: result.title,
            detail: result.detail,
            data: result.output,
          },
        });
        if (result.itemType === "command_execution") {
          const output =
            typeof result.output.output === "string"
              ? result.output.output
              : typeof result.output.stdout === "string"
                ? result.output.stdout
                : "";
          if (output) {
            yield* context.emitRuntimeEvent({
              type: "content.delta",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: context.threadId,
              turnId,
              itemId,
              payload: { streamKind: "command_output", delta: output },
            });
          }
        }
        return result;
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.succeed({
                ok: false,
                itemType: "dynamic_tool_call",
                title: call.name?.trim() || "unknown_tool",
                detail: errorDetail(Cause.squash(cause)),
                output: { error: errorDetail(Cause.squash(cause)) },
              } satisfies GeminiHarnessToolResult),
        ),
      );

    const runModelRound = (
      context: GeminiSessionContext,
      client: GeminiClient,
      turnId: TurnId,
      model: string,
      interactionMode: "default" | "plan" | undefined,
    ): Effect.Effect<ModelRoundResult, ProviderAdapterRequestError> =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const controller = new AbortController();
          context.activeAbortController = controller;
          return controller;
        }),
        (controller) =>
          Effect.gen(function* () {
            const declarations = geminiToolDeclarations({
              interactionMode,
              sandboxMode: context.fetchWorker ? "read-only" : context.sandboxMode,
            });
            const generator = yield* Effect.tryPromise({
              try: () =>
                client.models.generateContentStream({
                  model,
                  contents: context.contents,
                  config: {
                    abortSignal: controller.signal,
                    systemInstruction: systemInstruction({
                      cwd: context.cwd,
                      sandboxMode: context.sandboxMode,
                      interactionMode,
                      fetchWorker: context.fetchWorker,
                    }),
                    ...(declarations.length > 0
                      ? { tools: [{ functionDeclarations: [...declarations] }] }
                      : {}),
                  },
                }),
              catch: (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "models.generateContentStream",
                  detail: errorDetail(cause),
                  cause,
                }),
            });

            const parts: Array<Part> = [];
            const calls: Array<FunctionCall> = [];
            const seenCalls = new Set<string>();
            let assistantText = "";
            let reasoningText = "";
            let assistantItemId: RuntimeItemId | undefined;
            let reasoningItemId: RuntimeItemId | undefined;
            let usage: GenerateContentResponseUsageMetadata | undefined;
            let finishReason: string | null = null;

            const ensureItem = (kind: "assistant" | "reasoning") =>
              Effect.gen(function* () {
                const current = kind === "assistant" ? assistantItemId : reasoningItemId;
                if (current) return current;
                const itemId = RuntimeItemId.make(yield* randomUuid);
                if (kind === "assistant") assistantItemId = itemId;
                else reasoningItemId = itemId;
                yield* context.emitRuntimeEvent({
                  type: "item.started",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: context.threadId,
                  turnId,
                  itemId,
                  payload: {
                    itemType: kind === "assistant" ? "assistant_message" : "reasoning",
                    status: "inProgress",
                  },
                });
                return itemId;
              });

            const handleChunk = (chunk: GenerateContentResponse) =>
              Effect.gen(function* () {
                usage = chunk.usageMetadata ?? usage;
                const candidate = chunk.candidates?.[0];
                if (candidate?.finishReason) finishReason = String(candidate.finishReason);
                for (const part of candidate?.content?.parts ?? []) {
                  parts.push({ ...part });
                  if (typeof part.text === "string" && part.text.length > 0) {
                    const kind = part.thought === true ? "reasoning" : "assistant";
                    const itemId = yield* ensureItem(kind);
                    if (kind === "reasoning") reasoningText += part.text;
                    else assistantText += part.text;
                    yield* context.emitRuntimeEvent({
                      type: "content.delta",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId,
                      itemId,
                      payload: {
                        streamKind: kind === "reasoning" ? "reasoning_text" : "assistant_text",
                        delta: part.text,
                      },
                    });
                  }
                  if (part.functionCall) {
                    const key = functionCallKey(part.functionCall);
                    if (!seenCalls.has(key)) {
                      seenCalls.add(key);
                      calls.push(part.functionCall);
                    }
                  }
                }
              });

            yield* Stream.fromAsyncIterable(
              generator,
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "models.generateContentStream",
                  detail: errorDetail(cause),
                  cause,
                }),
            ).pipe(Stream.runForEach(handleChunk));

            if (assistantItemId) {
              yield* context.emitRuntimeEvent({
                type: "item.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: context.threadId,
                turnId,
                itemId: assistantItemId,
                payload: {
                  itemType: "assistant_message",
                  status: "completed",
                  data: { text: assistantText },
                },
              });
            }
            if (reasoningItemId) {
              yield* context.emitRuntimeEvent({
                type: "item.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: context.threadId,
                turnId,
                itemId: reasoningItemId,
                payload: {
                  itemType: "reasoning",
                  status: "completed",
                  data: { text: reasoningText },
                },
              });
            }
            if (parts.length === 0) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "models.generateContentStream",
                detail: "Gemini returned no content.",
              });
            }
            return {
              content: { role: "model", parts },
              functionCalls: calls,
              assistantText,
              reasoningText,
              finishReason,
              usage,
            } satisfies ModelRoundResult;
          }),
        (controller) =>
          Effect.sync(() => {
            controller.abort();
            if (context.activeAbortController === controller) {
              context.activeAbortController = undefined;
            }
          }),
      );

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        return yield* context.turnSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const credential = resolveGeminiApiKey(environment);
            if (!credential) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail:
                  "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
              });
            }
            const userParts: Array<Part> = [];
            if (input.input?.trim()) userParts.push({ text: input.input.trim() });
            for (const attachment of input.attachments ?? []) {
              const attachmentPath = resolveAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: `Failed to read attachment '${attachment.name}'.`,
                      cause,
                    }),
                ),
              );
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

            const turnId = TurnId.make(yield* randomUuid);
            const historyStart = context.contents.length;
            const turnItems: Array<unknown> = [];
            const interrupt = yield* Deferred.make<void>();
            const selectedModel =
              input.modelSelection?.instanceId === boundInstanceId
                ? input.modelSelection.model
                : context.session.model;
            const model = selectedModel ?? GEMINI_DEFAULT_MODEL;
            const client = clientFactory(credential.apiKey);
            context.activeTurnId = turnId;
            context.activeInterrupt = interrupt;
            context.contents.push({ role: "user", parts: userParts });
            context.session = {
              ...context.session,
              status: "running",
              model,
              activeTurnId: turnId,
              updatedAt: yield* nowIso,
            };
            yield* context.emitRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: { model },
            });
            yield* context.emitRuntimeEvent({
              type: "session.state.changed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: { state: "running", reason: "Gemini turn running" },
            });

            let lastUsage: GenerateContentResponseUsageMetadata | undefined;
            let stopReason: string | null = null;
            let terminalEmitted = false;
            const emitTerminal = (
              state: "completed" | "failed" | "interrupted",
              message?: string,
            ) =>
              Effect.gen(function* () {
                if (terminalEmitted) return;
                terminalEmitted = true;
                yield* context.emitRuntimeEvent({
                  type: "turn.completed",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: {
                    state,
                    stopReason,
                    ...(lastUsage ? { usage: lastUsage } : {}),
                    ...(message ? { errorMessage: message } : {}),
                  },
                });
              });

            const run = Effect.gen(function* () {
              for (let round = 0; round < GEMINI_MAX_TOOL_ROUNDS; round += 1) {
                const response = yield* runModelRound(
                  context,
                  client,
                  turnId,
                  model,
                  input.interactionMode,
                );
                context.contents.push(response.content);
                lastUsage = response.usage;
                stopReason = response.finishReason;
                if (response.assistantText) {
                  turnItems.push({ type: "assistant_message", text: response.assistantText });
                }
                if (response.reasoningText) {
                  turnItems.push({ type: "reasoning", text: response.reasoningText });
                }
                if (response.functionCalls.length === 0) return;

                const functionResponses: Array<Part> = [];
                for (const call of response.functionCalls) {
                  const result = yield* executeTool(
                    context,
                    turnId,
                    call,
                    interrupt,
                    input.interactionMode,
                  );
                  turnItems.push({
                    type: result.itemType,
                    name: call.name ?? "unknown_tool",
                    title: result.title,
                    detail: result.detail,
                    output: result.output,
                  });
                  functionResponses.push({
                    functionResponse: {
                      ...(call.id ? { id: call.id } : {}),
                      name: call.name ?? "unknown_tool",
                      response: result.output,
                    },
                  });
                }
                context.contents.push({ role: "user", parts: functionResponses });
              }
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: `Gemini exceeded T3's ${GEMINI_MAX_TOOL_ROUNDS}-round tool-call limit.`,
              });
            });

            yield* Effect.raceFirst(
              run,
              Deferred.await(interrupt).pipe(Effect.andThen(Effect.interrupt)),
            ).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  const record: GeminiTurnRecord = {
                    id: turnId,
                    historyStart,
                    historyEnd: context.contents.length,
                    items: turnItems,
                  };
                  context.turns.push(record);
                  context.totalProcessedTokens += nonNegativeInteger(lastUsage?.totalTokenCount);
                  yield* persistSession(context);
                  yield* emitTerminal("completed");
                  if (lastUsage) {
                    yield* context.emitRuntimeEvent({
                      type: "thread.token-usage.updated",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                      payload: {
                        usage: {
                          usedTokens: nonNegativeInteger(lastUsage.totalTokenCount),
                          totalProcessedTokens: context.totalProcessedTokens,
                          inputTokens: nonNegativeInteger(lastUsage.promptTokenCount),
                          cachedInputTokens: nonNegativeInteger(lastUsage.cachedContentTokenCount),
                          outputTokens: nonNegativeInteger(lastUsage.candidatesTokenCount),
                          reasoningOutputTokens: nonNegativeInteger(lastUsage.thoughtsTokenCount),
                          lastUsedTokens: nonNegativeInteger(lastUsage.totalTokenCount),
                          lastInputTokens: nonNegativeInteger(lastUsage.promptTokenCount),
                          lastCachedInputTokens: nonNegativeInteger(
                            lastUsage.cachedContentTokenCount,
                          ),
                          lastOutputTokens: nonNegativeInteger(lastUsage.candidatesTokenCount),
                          lastReasoningOutputTokens: nonNegativeInteger(
                            lastUsage.thoughtsTokenCount,
                          ),
                        },
                      },
                    });
                  }
                }),
              ),
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  context.contents.splice(historyStart);
                  const detail = errorDetail(cause);
                  yield* context.emitRuntimeEvent({
                    type: "runtime.error",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId,
                    payload: { message: detail, class: "provider_error" },
                  });
                  yield* emitTerminal("failed", detail);
                  return yield* cause;
                }),
              ),
              Effect.onInterrupt(() =>
                Effect.uninterruptible(
                  Effect.gen(function* () {
                    context.contents.splice(historyStart);
                    yield* emitTerminal("interrupted");
                  }),
                ),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  context.activeAbortController?.abort();
                  context.activeAbortController = undefined;
                  context.activeInterrupt = undefined;
                  context.activeTurnId = undefined;
                  const { activeTurnId: _activeTurnId, ...ready } = context.session;
                  context.session = {
                    ...ready,
                    status: context.stopped ? "closed" : "ready",
                    updatedAt: yield* nowIso,
                  };
                  if (!context.stopped) {
                    yield* context.emitRuntimeEvent({
                      type: "session.state.changed",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      payload: { state: "ready", reason: "Gemini turn settled" },
                    });
                  }
                }).pipe(Effect.ignore),
              ),
            );
            return {
              threadId: input.threadId,
              turnId,
              resumeCursor: context.session.resumeCursor,
            };
          }),
        );
      });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
      threadId,
      turnId,
      expectedRuntimeSessionId,
    ) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (
          expectedRuntimeSessionId !== undefined &&
          (!context || context.session.runtimeSessionId !== expectedRuntimeSessionId)
        ) {
          return;
        }
        const live = yield* requireSession(threadId);
        if (turnId !== undefined && live.activeTurnId !== turnId) return;
        live.activeAbortController?.abort();
        if (live.activeInterrupt) {
          yield* Deferred.succeed(live.activeInterrupt, undefined).pipe(Effect.ignore);
        }
        yield* settleApprovalsAsCancelled(live);
      });

    const forceStopSession: ProviderAdapterShape<ProviderAdapterError>["forceStopSession"] = (
      threadId,
      expectedRuntimeSessionId,
    ) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (
          !context ||
          context.stopped ||
          context.session.runtimeSessionId !== expectedRuntimeSessionId
        ) {
          return { outcome: "terminated", mechanism: "already-stopped" } as const;
        }
        yield* stopSessionInternal(context);
        return { outcome: "terminated", mechanism: "runtime-close" } as const;
      });

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "tool/approval",
            detail: `Unknown pending Gemini approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      threadId,
      requestId,
    ) =>
      requireSession(threadId).pipe(
        Effect.andThen(
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "user-input/respond",
              detail: `Gemini has no pending structured user-input request '${requestId}'.`,
            }),
          ),
        ),
      );

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
      Effect.map(requireSession(threadId), (context) => ({
        threadId,
        turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
      }));

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      threadId,
      numTurns,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const nextLength = Math.max(0, context.turns.length - numTurns);
        const removed = context.turns.slice(nextLength);
        const historyLength = removed[0]?.historyStart ?? context.contents.length;
        context.turns.splice(nextLength);
        context.contents.splice(historyLength);
        yield* persistSession(context);
        return {
          threadId,
          turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
        };
      });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.flatMap(requireSession(threadId), stopSessionInternal);
    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));
    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });
    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to stop Gemini SDK sessions during shutdown.", { cause }),
        ),
        Effect.andThen(runtimeEventBroadcast.shutdown),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", mcp: "unsupported" },
      startSession,
      sendTurn,
      interruptTurn,
      forceStopSession,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: runtimeEventBroadcast.stream,
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}
