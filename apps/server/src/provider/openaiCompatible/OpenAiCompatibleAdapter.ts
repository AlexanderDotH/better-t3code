import {
  type LmStudioSettings,
  type McpServerDefinition,
  type OpenAiCompatibleSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import { nativeHarnessWorkspaceInstructions } from "../nativeHarness/NativeHarnessPrompt.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
} from "../nativeHarness/NativeHarnessTools.ts";
import {
  makeNativeProviderAdapter,
  type NativeProviderHistoryStrategy,
  type NativeProviderRoundEvent,
  type NativeProviderToolCall,
  type NativeProviderTurnAdmission,
} from "../nativeHarness/NativeProviderAdapter.ts";
import { nativeProviderErrorDetail } from "../nativeHarness/NativeProviderError.ts";
import type { NativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import type {
  OpenAiCompatibleHistoryItem,
  OpenAiCompatibleRoundEvent,
  OpenAiCompatibleToolDefinition,
} from "./OpenAiCompatibleProtocol.ts";
import type { OpenAiCompatibleTransport } from "./OpenAiCompatibleTransport.ts";

const RESUME_VERSION = 1;
const MAX_SESSIONS = 40;
const MAX_IDLE_WORKING_SETS = 8;
const MAX_PARALLEL_TOOL_CALLS = 8;

const HistoryItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user"), content: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("assistant"),
    content: Schema.String,
    reasoning: Schema.optionalKey(Schema.String),
    toolCalls: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({ id: Schema.String, name: Schema.String, arguments: Schema.String }),
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    callId: Schema.String,
    content: Schema.String,
    name: Schema.optionalKey(Schema.String),
  }),
]);
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PersistedHistory = Schema.Struct({
  schemaVersion: Schema.Literal(RESUME_VERSION),
  driverKind: Schema.Literals(["openaiCompatible", "lmstudio"]),
  instanceId: Schema.String,
  baseUrl: Schema.String,
  sessionId: Schema.String,
  history: Schema.Array(HistoryItem),
  turns: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      historyStart: NonNegativeInteger,
      historyEnd: NonNegativeInteger,
      items: Schema.Array(Schema.Unknown),
    }),
  ),
  totalProcessedTokens: NonNegativeInteger,
});
const decodePersistedHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedHistory));
const decodeToolArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface OpenAiCompatibleAdapterOptions {
  readonly driverKind: "openaiCompatible" | "lmstudio";
  readonly instanceId: ProviderInstanceId;
  readonly transport: OpenAiCompatibleTransport;
  readonly harness: NativeProviderHarness;
  readonly environment?: NodeJS.ProcessEnv;
  readonly admission?: NativeProviderTurnAdmission;
  readonly onWorkingSetEvicted?: (threadId: ThreadId) => void;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, { readonly detail: string }>;
}

export function resolveOpenAiCompatibleModel(
  settings: OpenAiCompatibleSettings | LmStudioSettings,
  requestedModel?: string,
) {
  if (!settings.enabled) {
    return { ok: false, issue: "This provider instance is disabled." } as const;
  }
  const model = requestedModel?.trim() || settings.defaultModel.trim();
  return model
    ? ({ ok: true, model } as const)
    : ({
        ok: false,
        issue: "Select a model or configure a default model before continuing.",
      } as const);
}

export function makeOpenAiCompatibleHistoryStrategy(identity: {
  readonly driverKind: OpenAiCompatibleAdapterOptions["driverKind"];
  readonly instanceId: ProviderInstanceId;
  readonly baseUrl: string;
}): NativeProviderHistoryStrategy<OpenAiCompatibleHistoryItem> {
  return {
    directoryName: identity.driverKind,
    resumeVersion: RESUME_VERSION,
    encode: (input) => encodeJson({ schemaVersion: RESUME_VERSION, ...identity, ...input }),
    decode: Effect.fn("OpenAiCompatibleAdapter.decodeHistory")(function* (encoded, sessionId) {
      const invalidHistory = (detail: string) =>
        new ProviderAdapterRequestError({
          provider: identity.driverKind,
          method: "session/resume",
          detail,
        });
      const persisted = yield* decodePersistedHistory(encoded, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => invalidHistory("The session contains invalid persisted history.")),
      );
      if (
        persisted.sessionId !== sessionId ||
        persisted.driverKind !== identity.driverKind ||
        persisted.instanceId !== identity.instanceId
      ) {
        return yield* invalidHistory("The saved session belongs to a different provider instance.");
      }
      if (persisted.baseUrl !== identity.baseUrl) {
        return yield* invalidHistory(
          "This session was created for a different endpoint. Restore its endpoint URL or start a new session.",
        );
      }
      if (
        persisted.turns.some(
          (turn) =>
            turn.historyEnd < turn.historyStart || turn.historyEnd > persisted.history.length,
        )
      ) {
        return yield* invalidHistory("The session contains invalid persisted turn boundaries.");
      }
      return {
        history: [...persisted.history],
        turns: persisted.turns.map((turn) => ({
          ...turn,
          id: TurnId.make(turn.id),
          items: [...turn.items],
        })),
        totalProcessedTokens: persisted.totalProcessedTokens,
      };
    }),
  };
}

type AdapterToolCall = NativeProviderToolCall<{ readonly callId: string }>;

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function normalizeRoundEvent(
  event: OpenAiCompatibleRoundEvent,
): NativeProviderRoundEvent<OpenAiCompatibleHistoryItem, AdapterToolCall> {
  if (event.type !== "completed") return event;
  const toolCalls: Array<AdapterToolCall> = [];
  for (const call of event.toolCalls) {
    let args: Readonly<Record<string, unknown>>;
    try {
      args = decodeToolArguments(call.arguments);
    } catch {
      return {
        type: "failed",
        message: `The endpoint returned malformed arguments for tool '${call.name}'.`,
      };
    }
    toolCalls.push({
      sourceId: call.sourceId,
      name: call.name,
      args,
      metadata: { callId: call.sourceId },
    });
  }
  return {
    type: "completed",
    historyItems: event.historyItems,
    toolCalls,
    ...(event.assistantText === undefined ? {} : { assistantText: event.assistantText }),
    ...(event.reasoningText === undefined ? {} : { reasoningText: event.reasoningText }),
    ...(event.stopReason === undefined ? {} : { stopReason: event.stopReason }),
    ...(event.usage === undefined
      ? {}
      : {
          usage: {
            usedTokens: nonNegativeInteger(event.usage.totalTokens),
            inputTokens: nonNegativeInteger(event.usage.inputTokens),
            cachedInputTokens: nonNegativeInteger(event.usage.cachedInputTokens),
            outputTokens: nonNegativeInteger(event.usage.outputTokens),
            reasoningOutputTokens: nonNegativeInteger(event.usage.reasoningTokens),
            raw: event.usage,
          },
        }),
  };
}

function systemInstructions(input: {
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly fetchWorker: boolean;
}) {
  const readOnly =
    input.interactionMode === "plan" || input.sandboxMode === "read-only" || input.fetchWorker;
  return [
    "You are a coding agent running inside T3 Code. T3 Code owns the session, transcript, tool loop, approvals, and filesystem boundary.",
    `The trusted workspace root is ${input.cwd}.`,
    readOnly
      ? "Read-only: inspect the workspace but do not modify files or run commands."
      : "Use only tools exposed by T3 and respect every approval boundary.",
    nativeHarnessWorkspaceInstructions(input),
    input.interactionMode === "plan"
      ? "Plan mode is active: return a decision-complete plan and make no changes."
      : "Carry the request through focused verification and preserve unrelated work.",
  ].join("\n");
}

export const makeOpenAiCompatibleAdapter = Effect.fn("makeOpenAiCompatibleAdapter")(function* (
  settings: OpenAiCompatibleSettings | LmStudioSettings,
  options: OpenAiCompatibleAdapterOptions,
) {
  const { instanceId, driverKind } = options;
  const provider = ProviderDriverKind.make(driverKind);
  const name = driverKind === "lmstudio" ? "LM Studio" : "OpenAI Compatible";
  const requestError = (method: string, detail: string, cause?: unknown) =>
    new ProviderAdapterRequestError({
      provider,
      method,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  return yield* makeNativeProviderAdapter<
    OpenAiCompatibleHistoryItem,
    undefined,
    string,
    OpenAiCompatibleToolDefinition,
    AdapterToolCall
  >({
    provider,
    instanceId,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    messages: {
      sessionStarted: `${name} session owned by T3 Code`,
      sessionReady: `${name} session ready`,
      turnRunning: `${name} turn running`,
      turnSettled: `${name} turn settled`,
    },
    limits: {
      maxSessions: MAX_SESSIONS,
      maxIdleWorkingSets: MAX_IDLE_WORKING_SETS,
      maxToolDefinitions: NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
      maxToolOutputBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
      maxParallelToolCalls: MAX_PARALLEL_TOOL_CALLS,
    },
    history: makeOpenAiCompatibleHistoryStrategy({
      driverKind,
      instanceId,
      baseUrl: options.transport.baseUrl,
    }),
    start: Effect.fn("OpenAiCompatibleAdapter.start")(function* ({ input }) {
      const resolution = resolveOpenAiCompatibleModel(
        settings,
        input.modelSelection?.instanceId === instanceId ? input.modelSelection.model : undefined,
      );
      if (!resolution.ok) return yield* requestError("session/start", resolution.issue);
      return {
        model: resolution.model,
        state: undefined,
        configured: {
          harness: "t3-code",
          protocol: "chat-completions",
          model: resolution.model,
          stateless: true,
        },
      };
    }),
    prepareTurn: Effect.fn("OpenAiCompatibleAdapter.prepareTurn")(function* ({ input, session }) {
      const resolution = resolveOpenAiCompatibleModel(
        settings,
        input.modelSelection?.instanceId === instanceId
          ? input.modelSelection.model
          : session.session.model,
      );
      if (!resolution.ok) return yield* requestError("session/prompt", resolution.issue);
      if ((input.attachments?.length ?? 0) > 0) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "sendTurn",
          issue: `${name} sessions accept text only. Image and audio attachments are not supported.`,
        });
      }
      const content = input.input?.trim() ?? "";
      if (!content) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "sendTurn",
          issue: "Turn requires non-empty text.",
        });
      }
      const context = {
        threadId: input.threadId,
        cwd: session.cwd,
        interactionMode: input.interactionMode,
        sandboxMode: session.sandboxMode,
        fetchWorker: session.fetchWorker,
      };
      const declarations = yield* options.harness
        .declarations(context)
        .pipe(
          Effect.mapError((cause) =>
            requestError("tools/catalog", nativeProviderErrorDetail(cause), cause),
          ),
        );
      return {
        model: resolution.model,
        userHistoryItems: [{ type: "user", content }],
        attachmentBytes: 0,
        toolDeclarations: declarations.map(({ name, description, inputSchema }) => ({
          name,
          description,
          parameters: inputSchema,
        })),
        protocol: systemInstructions(context),
      };
    }),
    streamRound: ({ session, plan, signal }) =>
      options.transport
        .streamRound({
          model: plan.model,
          instructions: plan.protocol,
          history: session.history,
          tools: plan.toolDeclarations,
          signal,
        })
        .pipe(
          Stream.map(normalizeRoundEvent),
          Stream.mapError((cause) =>
            requestError("chat-completions/stream", nativeProviderErrorDetail(cause), cause),
          ),
        ),
    toolHarness: {
      isAvailable: (input) =>
        options.harness
          .isAvailable(input)
          .pipe(
            Effect.mapError((cause) =>
              requestError("tools/availability", nativeProviderErrorDetail(cause), cause),
            ),
          ),
      requiresApproval: options.harness.requiresApproval,
      requestType: options.harness.requestType,
      approvalDetail: options.harness.approvalDetail,
      execute: (input) =>
        options.harness.execute(input).pipe(
          Effect.catchCause((cause) => {
            const detail = nativeProviderErrorDetail(Cause.squash(cause));
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
        type: "tool",
        callId: call.metadata.callId,
        name: call.name,
        content: encodeJson(result.output),
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
                Effect.mapError((cause) => requestError("mcp/configuration", cause.detail, cause)),
              ),
          }),
    },
  });
});
