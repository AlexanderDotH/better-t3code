import * as Generated from "@effect/ai-openrouter/Generated";
import {
  type CanonicalRequestType,
  type McpServerDefinition,
  type OpenRouterSettings,
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  type ProviderSession,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import {
  makeNativeProviderAdapter,
  type NativeProviderHistoryStrategy,
  type NativeProviderPersistedHistory,
  type NativeProviderRoundEvent,
  type NativeProviderToolCall,
  type NativeProviderToolResult,
  type NativeProviderTurnAdmission,
} from "../nativeHarness/NativeProviderAdapter.ts";
import { nativeHarnessWorkspaceInstructions } from "../nativeHarness/NativeHarnessPrompt.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_HARNESS_MAX_TOOL_ROUNDS,
} from "../nativeHarness/NativeHarnessTools.ts";
import type { OpenRouterCatalogModel } from "./OpenRouterModelCatalog.ts";
import {
  type OpenRouterHistoryItem,
  type OpenRouterReasoningEffort,
  type OpenRouterRoundEvent,
  type OpenRouterToolDefinition,
} from "./OpenRouterProtocol.ts";
import type { OpenRouterTransport } from "./OpenRouterTransport.ts";

const PROVIDER = ProviderDriverKind.make("openrouter");
const OPENROUTER_RESUME_VERSION = 1 as const;
const OPENROUTER_MAX_SESSIONS = 40;
const OPENROUTER_MAX_IDLE_WORKING_SETS = 8;
const OPENROUTER_MAX_PARALLEL_TOOL_CALLS = 8;

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const HistoryToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
});
const HistoryOpaque = Schema.Union([
  Schema.Struct({
    protocol: Schema.Literal("chat-completions"),
    reasoningDetails: Schema.Array(Generated.ReasoningDetailUnion),
  }),
  Schema.Struct({
    protocol: Schema.Literal("responses"),
    outputItems: Schema.Array(JsonObject),
  }),
]);
const HistoryItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user"), content: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("assistant"),
    content: Schema.String,
    reasoning: Schema.optionalKey(Schema.String),
    toolCalls: Schema.optionalKey(Schema.Array(HistoryToolCall)),
    opaque: Schema.optionalKey(HistoryOpaque),
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    callId: Schema.String,
    content: Schema.String,
    name: Schema.optionalKey(Schema.String),
  }),
]);
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PersistedTurn = Schema.Struct({
  id: Schema.String,
  historyStart: NonNegativeInteger,
  historyEnd: NonNegativeInteger,
  items: Schema.Array(Schema.Unknown),
});
const PersistedHistory = Schema.Struct({
  schemaVersion: Schema.Literal(OPENROUTER_RESUME_VERSION),
  sessionId: Schema.String,
  history: Schema.Array(HistoryItem),
  turns: Schema.Array(PersistedTurn),
  totalProcessedTokens: NonNegativeInteger,
});
const decodePersistedHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedHistory));
const decodeToolArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface OpenRouterAdapterDependencyError {
  readonly detail?: string;
  readonly message?: string;
}

export interface OpenRouterHarnessToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}

export interface OpenRouterHarness {
  readonly declarations: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<
    ReadonlyArray<OpenRouterHarnessToolDeclaration>,
    OpenRouterAdapterDependencyError
  >;
  readonly isAvailable: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly toolName: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<boolean, OpenRouterAdapterDependencyError>;
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
  }) => Effect.Effect<NativeProviderToolResult, OpenRouterAdapterDependencyError>;
  readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
}

export interface OpenRouterAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly transport: OpenRouterTransport;
  readonly harness: OpenRouterHarness;
  readonly admission?: NativeProviderTurnAdmission;
  readonly onWorkingSetEvicted?: (threadId: ThreadId) => void;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, OpenRouterAdapterDependencyError>;
}

interface OpenRouterSessionState {
  readonly initialCatalog: ReadonlyArray<OpenRouterCatalogModel>;
}

interface OpenRouterProtocolState {
  readonly instructions: string;
  readonly toolParameters: {
    readonly toolChoice: boolean;
    readonly parallelToolCalls: boolean;
  };
  readonly reasoningEffort?: OpenRouterReasoningEffort;
}

export type OpenRouterAdapterToolCall = NativeProviderToolCall<{
  readonly callId: string;
}>;

export type OpenRouterModelResolution =
  | {
      readonly ok: true;
      readonly model: string;
      readonly catalogModel: OpenRouterCatalogModel;
    }
  | { readonly ok: false; readonly issue: string };

export function resolveOpenRouterModel(
  settings: OpenRouterSettings,
  catalog: ReadonlyArray<OpenRouterCatalogModel>,
  requestedModel?: string,
): OpenRouterModelResolution {
  if (!settings.enabled) {
    return { ok: false, issue: "OpenRouter is disabled in this provider instance." };
  }
  const defaultModel = settings.defaultModel.trim();
  if (!defaultModel) {
    return {
      ok: false,
      issue: "Select an explicit OpenRouter default model before starting a turn.",
    };
  }
  if (!catalog.some((candidate) => candidate.id === defaultModel)) {
    return {
      ok: false,
      issue: `Default model '${defaultModel}' is not in the authenticated OpenRouter catalog.`,
    };
  }
  const defaultCatalogModel = catalog.find((candidate) => candidate.id === defaultModel);
  if (defaultCatalogModel?.incompatibilityReason) {
    return {
      ok: false,
      issue: `Default model '${defaultModel}' is not compatible with T3 Code: ${defaultCatalogModel.incompatibilityReason}`,
    };
  }
  const model = requestedModel?.trim() || defaultModel;
  const catalogModel = catalog.find((candidate) => candidate.id === model);
  if (catalogModel === undefined) {
    return {
      ok: false,
      issue: `Model '${model}' is not in the authenticated OpenRouter catalog.`,
    };
  }
  if (catalogModel.incompatibilityReason) {
    return {
      ok: false,
      issue: `Model '${model}' is not compatible with T3 Code: ${catalogModel.incompatibilityReason}`,
    };
  }
  return { ok: true, model, catalogModel };
}

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
  if (Predicate.isObject(cause) && Predicate.isString(cause.detail) && cause.detail.trim()) {
    return cause.detail.trim();
  }
  if (Predicate.isObject(cause) && Predicate.isString(cause.message) && cause.message.trim()) {
    return cause.message.trim();
  }
  return "OpenRouter adapter dependency failed.";
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

export function normalizeOpenRouterAdapterRoundEvent(
  event: OpenRouterRoundEvent,
): NativeProviderRoundEvent<OpenRouterHistoryItem, OpenRouterAdapterToolCall> {
  if (event.type !== "completed") return event;
  const toolCalls: Array<OpenRouterAdapterToolCall> = [];
  for (const toolCall of event.toolCalls) {
    let args: Readonly<Record<string, unknown>>;
    try {
      args = decodeToolArguments(toolCall.arguments);
    } catch {
      return {
        type: "failed",
        message: `OpenRouter returned malformed arguments for tool '${toolCall.name}'.`,
      };
    }
    toolCalls.push({
      sourceId: toolCall.sourceId,
      name: toolCall.name,
      args,
      metadata: { callId: toolCall.sourceId },
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
            ...(event.totalCostUsd === undefined ? {} : { totalCostUsd: event.totalCostUsd }),
          },
        }),
  };
}

export function encodeOpenRouterPersistedHistory(
  input: NativeProviderPersistedHistory<OpenRouterHistoryItem> & { readonly sessionId: string },
): string {
  return encodeJsonUnknown({ schemaVersion: OPENROUTER_RESUME_VERSION, ...input });
}

export const decodeOpenRouterPersistedHistory = Effect.fn("decodeOpenRouterPersistedHistory")(
  function* (encoded: string, sessionId: string) {
    const persisted = yield* decodePersistedHistory(encoded, {
      onExcessProperty: "error",
    }).pipe(
      Effect.mapError((cause) =>
        providerRequestError(
          "session/resume",
          `OpenRouter session '${sessionId}' contains invalid persisted history.`,
          cause,
        ),
      ),
    );
    if (persisted.sessionId !== sessionId) {
      return yield* providerRequestError(
        "session/resume",
        `OpenRouter session '${sessionId}' does not match its persisted history identifier.`,
      );
    }
    if (
      persisted.turns.some(
        (turn) => turn.historyEnd < turn.historyStart || turn.historyEnd > persisted.history.length,
      )
    ) {
      return yield* providerRequestError(
        "session/resume",
        `OpenRouter session '${sessionId}' contains invalid persisted turn boundaries.`,
      );
    }
    return {
      history: [...persisted.history] as Array<OpenRouterHistoryItem>,
      turns: persisted.turns.map((turn) => ({
        ...turn,
        id: TurnId.make(turn.id),
        items: [...turn.items],
      })),
      totalProcessedTokens: persisted.totalProcessedTokens,
    } satisfies NativeProviderPersistedHistory<OpenRouterHistoryItem>;
  },
);

export function buildOpenRouterSystemInstructions(input: {
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly fetchWorker: boolean;
}): string {
  const access =
    input.interactionMode === "plan" || input.sandboxMode === "read-only" || input.fetchWorker
      ? "Read-only: inspect the workspace but do not modify files or run commands."
      : input.sandboxMode === "workspace-write"
        ? "Workspace-write: inspect and edit workspace files through T3 tools."
        : "Use only tools exposed by T3 and respect every approval boundary.";
  return [
    "You are an OpenRouter model running inside T3 Code. T3 Code owns the session, transcript, tool loop, approvals, and filesystem boundary.",
    `The trusted workspace root is ${input.cwd}.`,
    access,
    nativeHarnessWorkspaceInstructions(input),
    input.interactionMode === "plan"
      ? "Plan mode is active: return a decision-complete plan and make no changes."
      : "Carry the request through focused verification and preserve unrelated work.",
  ].join("\n");
}

export const makeOpenRouterAdapter = Effect.fn("makeOpenRouterAdapter")(function* (
  settings: OpenRouterSettings,
  options: OpenRouterAdapterOptions,
) {
  const { instanceId } = options;
  const history: NativeProviderHistoryStrategy<OpenRouterHistoryItem> = {
    directoryName: "openrouter",
    resumeVersion: OPENROUTER_RESUME_VERSION,
    encode: encodeOpenRouterPersistedHistory,
    decode: decodeOpenRouterPersistedHistory,
  };

  const listModels = (method: string) =>
    options.transport
      .listModels(settings.customModels)
      .pipe(
        Effect.mapError((cause) =>
          providerRequestError(
            method,
            `OpenRouter model discovery failed: ${errorDetail(cause)}`,
            cause,
          ),
        ),
      );

  return yield* makeNativeProviderAdapter<
    OpenRouterHistoryItem,
    OpenRouterSessionState,
    OpenRouterProtocolState,
    OpenRouterToolDefinition,
    OpenRouterAdapterToolCall
  >({
    provider: PROVIDER,
    instanceId,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    messages: {
      sessionStarted: "OpenRouter session owned by T3 Code",
      sessionReady: "OpenRouter session ready",
      turnRunning: "OpenRouter turn running",
      turnSettled: "OpenRouter turn settled",
    },
    limits: {
      maxSessions: OPENROUTER_MAX_SESSIONS,
      maxIdleWorkingSets: OPENROUTER_MAX_IDLE_WORKING_SETS,
      maxToolDefinitions: NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
      maxToolOutputBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
      maxToolRounds: NATIVE_HARNESS_MAX_TOOL_ROUNDS,
      maxParallelToolCalls: OPENROUTER_MAX_PARALLEL_TOOL_CALLS,
    },
    history,
    start: ({ input }) =>
      Effect.gen(function* () {
        const preflight = resolveOpenRouterModel(settings, []);
        if (!preflight.ok && !settings.enabled) {
          return yield* providerRequestError("session/start", preflight.issue);
        }
        const catalog = yield* listModels("models/list");
        const requestedModel =
          input.modelSelection?.instanceId === instanceId ? input.modelSelection.model : undefined;
        const resolution = resolveOpenRouterModel(settings, catalog, requestedModel);
        if (!resolution.ok) return yield* providerRequestError("session/start", resolution.issue);
        return {
          model: resolution.model,
          state: { initialCatalog: catalog },
          configured: {
            harness: "t3-code",
            sdk: "@effect/ai-openrouter",
            protocol: settings.protocol,
            model: resolution.model,
            stateless: true,
          },
        };
      }),
    prepareTurn: ({ input, session }) =>
      Effect.gen(function* () {
        const catalog = yield* listModels("models/list");
        const requestedModel =
          input.modelSelection?.instanceId === instanceId
            ? input.modelSelection.model
            : session.session.model;
        const resolution = resolveOpenRouterModel(settings, catalog, requestedModel);
        if (!resolution.ok) return yield* providerRequestError("session/prompt", resolution.issue);
        const requestedReasoningEffort =
          input.modelSelection?.instanceId === instanceId
            ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
            : undefined;
        const reasoningEffort = resolution.catalogModel.reasoningEfforts.find(
          (candidate) => candidate === requestedReasoningEffort,
        );
        if (requestedReasoningEffort !== undefined && reasoningEffort === undefined) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Reasoning effort '${requestedReasoningEffort}' is not available for model '${resolution.model}'.`,
          });
        }
        if ((input.attachments?.length ?? 0) > 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "OpenRouter native sessions currently accept text input only.",
          });
        }
        const content = input.input?.trim() ?? "";
        if (!content) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
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
            Effect.mapError((cause) =>
              providerRequestError("tools/catalog", errorDetail(cause), cause),
            ),
          );
        return {
          model: resolution.model,
          userHistoryItems: [{ type: "user", content }],
          attachmentBytes: 0,
          toolDeclarations: declarations.map((declaration) => ({
            name: declaration.name,
            description: declaration.description,
            parameters: declaration.inputSchema,
            ...(declaration.strict === undefined ? {} : { strict: declaration.strict }),
          })),
          protocol: {
            instructions: buildOpenRouterSystemInstructions({
              cwd: session.cwd,
              sandboxMode: session.sandboxMode,
              interactionMode: input.interactionMode,
              fetchWorker: session.fetchWorker,
            }),
            toolParameters: {
              toolChoice: resolution.catalogModel.toolCapabilities.toolChoice,
              parallelToolCalls: resolution.catalogModel.toolCapabilities.parallelToolCalls,
            },
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
          toolParameters: plan.protocol.toolParameters,
          settings,
          ...(plan.protocol.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: plan.protocol.reasoningEffort }),
          signal,
        })
        .pipe(
          Stream.map(normalizeOpenRouterAdapterRoundEvent),
          Stream.mapError((cause) =>
            providerRequestError(
              `${settings.protocol}/stream`,
              `OpenRouter response failed: ${errorDetail(cause)}`,
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
              providerRequestError("tools/availability", errorDetail(cause), cause),
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
        type: "tool",
        callId: call.metadata.callId,
        name: call.name,
        content: encodeJsonUnknown(result.output),
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
