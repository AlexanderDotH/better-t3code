/**
 * CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
 *
 * Wraps the typed Codex session runtime behind the `CodexAdapter` service
 * contract and maps runtime failures into the shared `ProviderAdapterError`
 * algebra.
 *
 * @module CodexAdapterLive
 */
import {
  type CanonicalItemType,
  type CanonicalRequestType,
  type CodexSettings,
  type IsoDateTime,
  type McpRuntimeAction,
  type McpRuntimeResource,
  type McpRuntimeResourceTemplate,
  type McpRuntimeServer,
  McpRuntimeServerKey,
  type McpRuntimeTool,
  ProviderDriverKind,
  type McpServerDefinition,
  type ProviderEvent,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderRequestKind,
  type ThreadTokenUsageSnapshot,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  type RuntimeTaskUsage,
  ProviderApprovalDecision,
  RuntimeSessionId,
  ThreadId,
  ProviderSendTurnInput,
  type RuntimeSubagentState,
  SubagentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { getCodexServiceTierOptionValue } from "../../codexModelOptions.ts";
import { managedMcpProviderKey } from "../../mcp/McpConfigEngine.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { sanitizeMcpRuntimeText } from "../../mcp/McpRuntimeSanitizer.ts";

import {
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  CodexResumeCursorSchema,
  CodexSessionRuntimeThreadIdMissingError,
  makeCodexSubagentId,
  makeCodexSessionRuntime,
  type CodexSessionRuntimeError,
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeShape,
  type CodexMcpServerStatus,
} from "./CodexSessionRuntime.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";
import { stampProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";
const isCodexAppServerProcessExitedError = Schema.is(CodexErrors.CodexAppServerProcessExitedError);
const isCodexAppServerTransportError = Schema.is(CodexErrors.CodexAppServerTransportError);
const isCodexSessionRuntimeThreadIdMissingError = Schema.is(
  CodexSessionRuntimeThreadIdMissingError,
);
const isCodexResumeCursorSchema = Schema.is(CodexResumeCursorSchema);

const PROVIDER = ProviderDriverKind.make("codex");

export interface CodexAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly makeRuntime?: (
    options: CodexSessionRuntimeOptions,
  ) => Effect.Effect<
    CodexSessionRuntimeShape,
    CodexSessionRuntimeError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  >;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>>;
}

interface CodexAdapterSessionContext {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly cwd: string;
  readonly scope: Scope.Closeable;
  readonly runtime: CodexSessionRuntimeShape;
  readonly eventFiber: Fiber.Fiber<void, never>;
  managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly mcpStartupStatuses: Map<string, CodexMcpStartupObservation>;
  readonly builtInMcpExpected: boolean;
  stopped: boolean;
}

interface CodexMcpStartupObservation {
  readonly state: EffectCodexSchema.V2McpServerStatusUpdatedNotification__McpServerStartupState;
  readonly failureReason?:
    | EffectCodexSchema.V2McpServerStatusUpdatedNotification__McpServerStartupFailureReason
    | undefined;
  readonly error?: string | undefined;
  readonly observedAt: IsoDateTime;
}

function mapCodexRuntimeError(
  threadId: ThreadId,
  method: string,
  error: CodexSessionRuntimeError,
): ProviderAdapterError {
  if (isCodexAppServerProcessExitedError(error) || isCodexAppServerTransportError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  if (isCodexSessionRuntimeThreadIdMissingError(error)) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: error.message,
    cause: error,
  });
}

type CodexLifecycleItem =
  | EffectCodexSchema.V2ItemStartedNotification["item"]
  | EffectCodexSchema.V2ItemCompletedNotification["item"];

type CodexToolUserInputQuestion =
  | EffectCodexSchema.ServerRequest__ToolRequestUserInputQuestion
  | EffectCodexSchema.ToolRequestUserInputParams__ToolRequestUserInputQuestion;

const ApprovalDecisionPayload = Schema.Struct({
  decision: ProviderApprovalDecision,
});

function readPayload<A>(
  schema: Schema.Schema<A>,
  payload: ProviderEvent["payload"],
): A | undefined {
  const isPayload = Schema.is(schema);
  return isPayload(payload) ? payload : undefined;
}

function trimText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function boundedText(value: string | undefined | null, maximumLength: number): string | undefined {
  return trimText(value)?.slice(0, maximumLength);
}

function codexMcpProviderKey(value: string): McpRuntimeServerKey {
  return McpRuntimeServerKey.make(boundedText(value, 512) ?? "unknown");
}

function codexManagedMcpServers(
  servers: ReadonlyArray<McpServerDefinition>,
): ReadonlyMap<string, McpServerDefinition> {
  return new Map(servers.map((server) => [managedMcpProviderKey(server.id), server]));
}

function readCodexToolAnnotation(annotations: unknown, key: string): boolean | undefined {
  if (annotations === null || typeof annotations !== "object" || !Object.hasOwn(annotations, key)) {
    return undefined;
  }
  const value = (annotations as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function normalizeCodexMcpTool(
  tool: CodexMcpServerStatus["tools"][string],
): McpRuntimeTool | undefined {
  const name = boundedText(tool.name, 512);
  if (!name) {
    return undefined;
  }
  const title = boundedText(tool.title, 512);
  const description = boundedText(tool.description, 65_536);
  const readOnly = readCodexToolAnnotation(tool.annotations, "readOnlyHint");
  const destructive = readCodexToolAnnotation(tool.annotations, "destructiveHint");
  const openWorld = readCodexToolAnnotation(tool.annotations, "openWorldHint");
  return {
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(destructive !== undefined ? { destructive } : {}),
    ...(openWorld !== undefined ? { openWorld } : {}),
  };
}

function normalizeCodexMcpResource(
  resource: CodexMcpServerStatus["resources"][number],
): McpRuntimeResource | undefined {
  const uri = boundedText(resource.uri, 8_192);
  const name = boundedText(resource.name, 512);
  if (!uri || !name) return undefined;
  const title = boundedText(resource.title, 512);
  const description = boundedText(resource.description, 65_536);
  const mimeType = boundedText(resource.mimeType, 512);
  const size =
    resource.size === null || resource.size === undefined
      ? undefined
      : Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(resource.size)));
  return {
    uri,
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(size === undefined ? {} : { size }),
  };
}

function normalizeCodexMcpResourceTemplate(
  template: CodexMcpServerStatus["resourceTemplates"][number],
): McpRuntimeResourceTemplate | undefined {
  const uriTemplate = boundedText(template.uriTemplate, 8_192);
  const name = boundedText(template.name, 512);
  if (!uriTemplate || !name) return undefined;
  const title = boundedText(template.title, 512);
  const description = boundedText(template.description, 65_536);
  const mimeType = boundedText(template.mimeType, 512);
  return {
    uriTemplate,
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

function codexMcpAvailableActions(
  status: CodexMcpServerStatus,
  source: McpRuntimeServer["source"],
): ReadonlyArray<McpRuntimeAction> {
  const actions: Array<McpRuntimeAction> = ["refresh", "reconnect"];
  if (status.authStatus === "notLoggedIn" && source !== "t3-built-in") {
    actions.push("authorize");
  }
  return actions;
}

function normalizeCodexMcpServer(input: {
  readonly status: CodexMcpServerStatus;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly builtInMcpExpected: boolean;
}): McpRuntimeServer {
  const managedServer = input.managedMcpServers.get(input.status.name);
  const source =
    input.status.name === "t3-code" && input.builtInMcpExpected
      ? ("t3-built-in" as const)
      : managedServer
        ? ("t3-managed" as const)
        : ("provider-native" as const);
  const authRequired = input.status.authStatus === "notLoggedIn";
  const advertisedName = boundedText(input.status.serverInfo?.name, 512);
  const advertisedVersion = boundedText(input.status.serverInfo?.version, 512);
  const providerKey = codexMcpProviderKey(input.status.name);
  return {
    ...(managedServer ? { serverId: managedServer.id } : {}),
    providerKey,
    source,
    providerInstanceId: input.providerInstanceId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    name:
      managedServer?.name ??
      boundedText(input.status.serverInfo?.title, 128) ??
      boundedText(input.status.name, 128) ??
      "Unknown MCP server",
    ...(managedServer ? { transport: managedServer.transport } : {}),
    state: authRequired ? "auth-required" : "connected",
    statusSource: "provider-query",
    observedAt: input.observedAt,
    authState: authRequired
      ? "required"
      : input.status.authStatus === "unsupported"
        ? "unsupported"
        : "authenticated",
    availableActions: codexMcpAvailableActions(input.status, source),
    reportsTools: true,
    ...(advertisedName
      ? {
          serverInfo: {
            name: advertisedName,
            ...(advertisedVersion ? { version: advertisedVersion } : {}),
          },
        }
      : {}),
    toolCount: Object.keys(input.status.tools).length,
    resourceCount: input.status.resources.length,
    templateCount: input.status.resourceTemplates.length,
    configDrift: "none",
  };
}

function findCodexMcpStatus(
  statuses: ReadonlyArray<CodexMcpServerStatus>,
  providerKey: McpRuntimeServerKey,
): CodexMcpServerStatus | undefined {
  return statuses.find((status) => codexMcpProviderKey(status.name) === providerKey);
}

function applyCodexMcpStartupObservation(
  server: McpRuntimeServer,
  observation: CodexMcpStartupObservation | undefined,
): McpRuntimeServer {
  if (!observation) {
    return server;
  }
  if (observation.state === "ready") {
    return {
      ...server,
      state: "connected",
      statusSource: "provider-event",
      observedAt: observation.observedAt,
    };
  }
  if (observation.state === "starting") {
    return {
      ...server,
      state: "starting",
      statusSource: "provider-event",
      observedAt: observation.observedAt,
    };
  }

  const authorizationRequired = observation.failureReason === "reauthenticationRequired";
  const issueMessage =
    observation.error ??
    (authorizationRequired
      ? "Codex requires this MCP server to be authorized again."
      : observation.state === "cancelled"
        ? "Codex cancelled this MCP server during startup."
        : "Codex could not start this MCP server.");
  const availableActions = Array.from(
    new Set<McpRuntimeAction>([
      ...server.availableActions,
      ...(authorizationRequired && server.source !== "t3-built-in" ? ["authorize" as const] : []),
    ]),
  );
  return {
    ...server,
    state: authorizationRequired ? "auth-required" : "failed",
    statusSource: "provider-event",
    observedAt: observation.observedAt,
    authState: authorizationRequired ? "required" : server.authState,
    availableActions,
    issue: {
      code:
        observation.failureReason ??
        (observation.state === "cancelled" ? "startup-cancelled" : "startup-failed"),
      message: issueMessage,
    },
  };
}

function normalizeExpectedCodexMcpServer(input: {
  readonly providerKey: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly builtIn: boolean;
}): McpRuntimeServer {
  const managedServer = input.managedMcpServers.get(input.providerKey);
  return {
    ...(managedServer ? { serverId: managedServer.id } : {}),
    providerKey: codexMcpProviderKey(input.providerKey),
    source: input.builtIn ? "t3-built-in" : managedServer ? "t3-managed" : "provider-native",
    providerInstanceId: input.providerInstanceId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    name:
      managedServer?.name ??
      (input.builtIn
        ? "T3 Code System Server"
        : (boundedText(input.providerKey, 128) ?? "Unknown MCP server")),
    ...(managedServer ? { transport: managedServer.transport } : {}),
    state: "unknown",
    statusSource: "configuration",
    observedAt: input.observedAt,
    authState: "unknown",
    availableActions: ["refresh", "reconnect"],
    reportsTools: true,
    configDrift: "none",
  };
}

function normalizeCodexMcpSnapshot(input: {
  readonly statuses: ReadonlyArray<CodexMcpServerStatus>;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly startupStatuses: ReadonlyMap<string, CodexMcpStartupObservation>;
  readonly builtInMcpExpected: boolean;
}): ReadonlyArray<McpRuntimeServer> {
  const normalized = new Map<string, McpRuntimeServer>();
  for (const status of input.statuses) {
    const server = normalizeCodexMcpServer({
      status,
      providerInstanceId: input.providerInstanceId,
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      observedAt: input.observedAt,
      managedMcpServers: input.managedMcpServers,
      builtInMcpExpected: input.builtInMcpExpected,
    });
    normalized.set(
      status.name,
      applyCodexMcpStartupObservation(server, input.startupStatuses.get(status.name)),
    );
  }

  const expectedKeys = new Set([
    ...input.managedMcpServers.keys(),
    ...input.startupStatuses.keys(),
    ...(input.builtInMcpExpected ? ["t3-code"] : []),
  ]);
  for (const providerKey of expectedKeys) {
    if (normalized.has(providerKey)) {
      continue;
    }
    const server = normalizeExpectedCodexMcpServer({
      providerKey,
      providerInstanceId: input.providerInstanceId,
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      observedAt: input.observedAt,
      managedMcpServers: input.managedMcpServers,
      builtIn: providerKey === "t3-code",
    });
    normalized.set(
      providerKey,
      applyCodexMcpStartupObservation(server, input.startupStatuses.get(providerKey)),
    );
  }
  return Array.from(normalized.values());
}

function observeCodexMcpEvent(
  event: ProviderEvent,
  startupStatuses: Map<string, CodexMcpStartupObservation>,
): void {
  if (event.method === "mcpServer/startupStatus/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerStatusUpdatedNotification,
      event.payload,
    );
    if (!payload) {
      return;
    }
    startupStatuses.set(payload.name, {
      state: payload.status,
      observedAt: event.createdAt,
      ...(payload.failureReason ? { failureReason: payload.failureReason } : {}),
      ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
    });
    return;
  }
  if (event.method !== "mcpServer/oauthLogin/completed") {
    return;
  }
  const payload = readPayload(
    EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
    event.payload,
  );
  if (payload?.success === true) {
    startupStatuses.delete(payload.name);
  }
}

export function sanitizeCodexMcpNativeEvent(event: ProviderEvent): ProviderEvent {
  if (event.method === "mcpServer/startupStatus/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerStatusUpdatedNotification,
      event.payload,
    );
    return {
      ...event,
      payload: payload
        ? {
            threadId: payload.threadId,
            name: payload.name,
            status: payload.status,
            ...(payload.failureReason ? { failureReason: payload.failureReason } : {}),
            ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
          }
        : { redacted: true },
    };
  }
  if (event.method === "mcpServer/oauthLogin/completed") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
      event.payload,
    );
    return {
      ...event,
      payload: payload
        ? {
            threadId: payload.threadId,
            name: payload.name,
            success: payload.success,
            ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
          }
        : { redacted: true },
    };
  }
  return event;
}

const FATAL_CODEX_STDERR_SNIPPETS = ["failed to connect to websocket"];

function isFatalCodexProcessStderrMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return FATAL_CODEX_STDERR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

function normalizeCodexTokenUsage(
  usage: EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification["tokenUsage"],
): ThreadTokenUsageSnapshot | undefined {
  const totalProcessedTokens = usage.total.totalTokens;
  const usedTokens = usage.last.totalTokens;
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined;
  }

  const maxTokens = usage.modelContextWindow ?? undefined;
  const inputTokens = usage.last.inputTokens;
  const cachedInputTokens = usage.last.cachedInputTokens;
  const outputTokens = usage.last.outputTokens;
  const reasoningOutputTokens = usage.last.reasoningOutputTokens;

  return {
    usedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(usedTokens !== undefined ? { lastUsedTokens: usedTokens } : {}),
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined
      ? { lastReasoningOutputTokens: reasoningOutputTokens }
      : {}),
    compactsAutomatically: true,
  };
}

function toTurnStatus(
  value: EffectCodexSchema.V2TurnCompletedNotification["turn"]["status"] | "cancelled",
): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (value) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return value;
    default:
      return "completed";
  }
}

function normalizeItemType(raw: string | undefined | null): string {
  const type = trimText(raw);
  if (!type) return "item";
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toCanonicalItemType(raw: string | undefined | null): CanonicalItemType {
  const type = normalizeItemType(raw);
  if (type.includes("user")) return "user_message";
  if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
  if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
  if (type.includes("plan") || type.includes("todo")) return "plan";
  if (type.includes("command")) return "command_execution";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit"))
    return "file_change";
  if (type.includes("mcp")) return "mcp_tool_call";
  if (type.includes("dynamic tool")) return "dynamic_tool_call";
  if (type.includes("collab")) return "collab_agent_tool_call";
  if (type.includes("web search")) return "web_search";
  if (type.includes("image")) return "image_view";
  if (type.includes("review entered")) return "review_entered";
  if (type.includes("review exited")) return "review_exited";
  if (type.includes("compact")) return "context_compaction";
  if (type.includes("error")) return "error";
  return "unknown";
}

function itemTitle(itemType: CanonicalItemType, item?: CodexLifecycleItem): string | undefined {
  if (itemType === "mcp_tool_call" && item?.type === "mcpToolCall") {
    return `${item.server} · ${item.tool}`;
  }
  switch (itemType) {
    case "assistant_message":
      return "Assistant message";
    case "user_message":
      return "User message";
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "dynamic_tool_call":
      return "Tool call";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "error":
      return "Error";
    default:
      return undefined;
  }
}

function itemDetail(itemType: CanonicalItemType, item: CodexLifecycleItem): string | undefined {
  const itemRecord = item as Record<string, unknown>;
  const action = itemRecord.action as Record<string, unknown> | undefined;
  const actionQueries = Array.isArray(action?.queries) ? action.queries : [];
  const candidates = [
    ...(itemType === "web_search"
      ? [itemRecord.query, action?.query, ...actionQueries, action?.pattern, action?.url]
      : []),
    "command" in item ? item.command : undefined,
    "title" in item ? item.title : undefined,
    "summary" in item ? item.summary : undefined,
    "text" in item ? item.text : undefined,
    "path" in item ? item.path : undefined,
    "prompt" in item ? item.prompt : undefined,
  ];

  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? trimText(candidate) : undefined;
    if (!trimmed) continue;
    return trimmed;
  }
  return undefined;
}

function toRequestTypeFromMethod(method: string): CanonicalRequestType {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution_approval";
    case "item/fileRead/requestApproval":
      return "file_read_approval";
    case "item/fileChange/requestApproval":
      return "file_change_approval";
    case "applyPatchApproval":
      return "apply_patch_approval";
    case "execCommandApproval":
      return "exec_command_approval";
    case "item/tool/requestUserInput":
      return "tool_user_input";
    case "item/tool/call":
      return "dynamic_tool_call";
    case "account/chatgptAuthTokens/refresh":
      return "auth_tokens_refresh";
    default:
      return "unknown";
  }
}

function toRequestTypeFromKind(kind: ProviderRequestKind | undefined): CanonicalRequestType {
  switch (kind) {
    case "command":
      return "command_execution_approval";
    case "file-read":
      return "file_read_approval";
    case "file-change":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function toCanonicalUserInputAnswers(
  answers: EffectCodexSchema.ToolRequestUserInputResponse["answers"],
): ProviderUserInputAnswers {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, value]) => {
      const normalizedAnswers = value.answers.length === 1 ? value.answers[0]! : [...value.answers];
      return [questionId, normalizedAnswers] as const;
    }),
  );
}

function toUserInputQuestions(questions: ReadonlyArray<CodexToolUserInputQuestion>) {
  const parsedQuestions = questions
    .map((question) => {
      const options =
        question.options
          ?.map((option) => {
            const label = trimText(option.label);
            const description = trimText(option.description);
            if (!label || !description) {
              return undefined;
            }
            return { label, description };
          })
          .filter((option) => option !== undefined) ?? [];

      const id = trimText(question.id);
      const header = trimText(question.header);
      const prompt = trimText(question.question);
      if (!id || !header || !prompt || options.length === 0) {
        return undefined;
      }
      return {
        id,
        header,
        question: prompt,
        options,
        multiSelect: false,
      };
    })
    .filter((question) => question !== undefined);

  return parsedQuestions.length > 0 ? parsedQuestions : undefined;
}

function toThreadState(
  status: EffectCodexSchema.V2ThreadStatusChangedNotification["status"],
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" {
  switch (status.type) {
    case "idle":
      return "idle";
    case "systemError":
      return "error";
    default:
      return "active";
  }
}

function contentStreamKindFromMethod(
  method: string,
):
  | "assistant_text"
  | "reasoning_text"
  | "reasoning_summary_text"
  | "plan_text"
  | "command_output"
  | "file_change_output" {
  switch (method) {
    case "item/agentMessage/delta":
      return "assistant_text";
    case "item/reasoning/textDelta":
      return "reasoning_text";
    case "item/reasoning/summaryTextDelta":
      return "reasoning_summary_text";
    case "item/commandExecution/outputDelta":
      return "command_output";
    case "item/fileChange/outputDelta":
      return "file_change_output";
    default:
      return "assistant_text";
  }
}

function asRuntimeItemId(itemId: ProviderEvent["itemId"] & string): RuntimeItemId {
  return RuntimeItemId.make(itemId);
}

function asRuntimeRequestId(requestId: string): RuntimeRequestId {
  return RuntimeRequestId.make(requestId);
}

type CodexCollabAgentStatus = EffectCodexSchema.ServerNotification__CollabAgentState["status"];

export function normalizeCodexCollabAgentStatus(
  status: CodexCollabAgentStatus,
): RuntimeSubagentState {
  switch (status) {
    case "pendingInit":
      return "starting";
    case "running":
      return "running";
    case "interrupted":
      return "interrupted";
    case "completed":
    case "shutdown":
      return "completed";
    case "errored":
      return "error";
    case "notFound":
      return "unavailable";
  }
}

function toSubagentStateFromThreadStatus(
  status: EffectCodexSchema.V2ThreadStatusChangedNotification["status"],
): RuntimeSubagentState {
  switch (status.type) {
    case "active":
      return status.activeFlags.length > 0 ? "waiting" : "running";
    case "idle":
      return "completed";
    case "systemError":
      return "error";
    case "notLoaded":
      return "unavailable";
  }
}

function unknownRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function subagentDepthFromPath(agentPath: string | undefined): number | undefined {
  if (!agentPath) {
    return undefined;
  }
  const segments = agentPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  return Math.max(0, segments.length - (segments[0] === "root" ? 1 : 0));
}

function lifecycleItemFromEvent(
  event: ProviderEvent,
): Readonly<Record<string, unknown>> | undefined {
  if (event.method !== "item/started" && event.method !== "item/completed") {
    return undefined;
  }
  return unknownRecord(unknownRecord(event.payload)?.item);
}

function eventRawSource(event: ProviderEvent): NonNullable<ProviderRuntimeEvent["raw"]>["source"] {
  return event.kind === "request" ? "codex.app-server.request" : "codex.app-server.notification";
}

function providerRefsFromEvent(
  event: ProviderEvent,
): ProviderRuntimeEvent["providerRefs"] | undefined {
  const refs: Record<string, string> = {};
  if (event.providerThreadId) refs.providerThreadId = event.providerThreadId;
  if (event.turnId) refs.providerTurnId = event.turnId;
  if (event.itemId) refs.providerItemId = event.itemId;
  if (event.requestId) refs.providerRequestId = event.requestId;

  return Object.keys(refs).length > 0 ? (refs as ProviderRuntimeEvent["providerRefs"]) : undefined;
}

function runtimeEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  const refs = providerRefsFromEvent(event);
  return {
    eventId: event.id,
    provider: event.provider,
    threadId: canonicalThreadId,
    createdAt: event.createdAt,
    ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId } : {}),
    ...(event.subagentId ? { subagentId: event.subagentId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.itemId ? { itemId: asRuntimeItemId(event.itemId) } : {}),
    ...(event.requestId ? { requestId: asRuntimeRequestId(event.requestId) } : {}),
    ...(refs ? { providerRefs: refs } : {}),
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: event.payload ?? {},
    },
  };
}

function mapItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: "item.started" | "item.updated" | "item.completed",
): ProviderRuntimeEvent | undefined {
  const payload =
    readPayload(EffectCodexSchema.V2ItemStartedNotification, event.payload) ??
    readPayload(EffectCodexSchema.V2ItemCompletedNotification, event.payload);
  const item = payload?.item;
  if (!item) {
    return undefined;
  }
  const itemType = toCanonicalItemType(item.type);
  if (itemType === "unknown" && lifecycle !== "item.updated") {
    return undefined;
  }

  const detail = itemDetail(itemType, item);
  const status =
    lifecycle === "item.started"
      ? "inProgress"
      : lifecycle === "item.completed"
        ? "completed"
        : undefined;

  return {
    ...runtimeEventBase(event, canonicalThreadId),
    type: lifecycle,
    payload: {
      itemType,
      ...(status ? { status } : {}),
      ...(itemTitle(itemType, item) ? { title: itemTitle(itemType, item) } : {}),
      ...(detail ? { detail } : {}),
      ...(event.payload !== undefined ? { data: event.payload } : {}),
    },
  };
}

function makeSubagentDiscoveredEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  providerThreadId: string,
  metadata?: {
    readonly parentSubagentId?: SubagentId;
    readonly agentPath?: string;
    readonly nickname?: string;
    readonly role?: string;
    readonly task?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly depth?: number;
  },
): ProviderRuntimeEvent {
  const subagentId = makeCodexSubagentId(providerThreadId);
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    subagentId,
    type: "subagent.discovered",
    payload: {
      subagentId,
      providerThreadId,
      ...(metadata?.parentSubagentId ? { parentSubagentId: metadata.parentSubagentId } : {}),
      ...(trimText(metadata?.agentPath) ? { agentPath: trimText(metadata?.agentPath) } : {}),
      ...(trimText(metadata?.nickname) ? { nickname: trimText(metadata?.nickname) } : {}),
      ...(trimText(metadata?.role) ? { role: trimText(metadata?.role) } : {}),
      ...(trimText(metadata?.task) ? { task: trimText(metadata?.task) } : {}),
      ...(trimText(metadata?.model) ? { model: trimText(metadata?.model) } : {}),
      ...(trimText(metadata?.reasoningEffort)
        ? { reasoningEffort: trimText(metadata?.reasoningEffort) }
        : {}),
      ...(metadata?.depth !== undefined ? { depth: metadata.depth } : {}),
    },
  };
}

function makeSubagentStateChangedEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  subagentId: SubagentId,
  state: RuntimeSubagentState,
  statusMessage?: string | null,
): ProviderRuntimeEvent {
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    subagentId,
    type: "subagent.state.changed",
    payload: {
      subagentId,
      state,
      ...(trimText(statusMessage) ? { statusMessage: trimText(statusMessage) } : {}),
    },
  };
}

function parentSubagentId(
  providerThreadId: string | undefined,
  rootProviderThreadId: string | undefined,
): SubagentId | undefined {
  if (!providerThreadId || providerThreadId === rootProviderThreadId) {
    return undefined;
  }
  return makeCodexSubagentId(providerThreadId);
}

function mapSubagentActivityEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const item = lifecycleItemFromEvent(event);
  if (item?.type !== "subAgentActivity") {
    return [];
  }
  const providerThreadId = trimText(
    typeof item.agentThreadId === "string" ? item.agentThreadId : undefined,
  );
  const agentPath = trimText(typeof item.agentPath === "string" ? item.agentPath : undefined);
  if (!providerThreadId || providerThreadId === rootProviderThreadId || agentPath === "/root") {
    return [];
  }
  const depth = subagentDepthFromPath(agentPath);
  const subagentId = makeCodexSubagentId(providerThreadId);
  const kind = item.kind;
  const state =
    kind === "started" ? "starting" : kind === "interrupted" ? "interrupted" : undefined;
  return [
    makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
      ...(event.subagentId ? { parentSubagentId: event.subagentId } : {}),
      ...(agentPath ? { agentPath } : {}),
      ...(depth !== undefined ? { depth } : {}),
    }),
    ...(state ? [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, state)] : []),
  ];
}

function isCodexCollabAgentStatus(value: unknown): value is CodexCollabAgentStatus {
  return (
    value === "pendingInit" ||
    value === "running" ||
    value === "interrupted" ||
    value === "completed" ||
    value === "errored" ||
    value === "shutdown" ||
    value === "notFound"
  );
}

function collabToolFallbackState(tool: unknown, status: unknown): RuntimeSubagentState | undefined {
  if (status === "failed") {
    return "error";
  }
  switch (tool) {
    case "spawnAgent":
      return "starting";
    case "resumeAgent":
      return "running";
    case "closeAgent":
      return "completed";
    default:
      return undefined;
  }
}

function mapCollabAgentEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const item = lifecycleItemFromEvent(event);
  if (item?.type !== "collabAgentToolCall") {
    return [];
  }

  const agentStates = unknownRecord(item.agentsStates) ?? {};
  const receiverThreadIds = stringArray(item.receiverThreadIds);
  const providerThreadIds = Array.from(
    new Set([...receiverThreadIds, ...Object.keys(agentStates)]),
  ).filter(
    (providerThreadId) =>
      providerThreadId.trim().length > 0 && providerThreadId !== rootProviderThreadId,
  );
  const senderThreadId = trimText(
    typeof item.senderThreadId === "string" ? item.senderThreadId : undefined,
  );
  const parentId = event.subagentId ?? parentSubagentId(senderThreadId, rootProviderThreadId);
  const task = trimText(typeof item.prompt === "string" ? item.prompt : undefined);
  const model = trimText(typeof item.model === "string" ? item.model : undefined);
  const reasoningEffort = trimText(
    typeof item.reasoningEffort === "string" ? item.reasoningEffort : undefined,
  );
  const events: Array<ProviderRuntimeEvent> = [];

  for (const providerThreadId of providerThreadIds) {
    events.push(
      makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
        ...(parentId ? { parentSubagentId: parentId } : {}),
        ...(task ? { task } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }),
    );

    const stateRecord = unknownRecord(agentStates[providerThreadId]);
    const rawState = stateRecord?.status;
    const state = isCodexCollabAgentStatus(rawState)
      ? normalizeCodexCollabAgentStatus(rawState)
      : collabToolFallbackState(item.tool, item.status);
    if (!state) {
      continue;
    }
    events.push(
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        makeCodexSubagentId(providerThreadId),
        state,
        typeof stateRecord?.message === "string" ? stateRecord.message : undefined,
      ),
    );
  }

  return events;
}

function threadSpawnMetadata(thread: EffectCodexSchema.V2ThreadStartedNotification["thread"]): {
  readonly agentPath?: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly parentProviderThreadId?: string;
  readonly depth?: number;
} {
  const source = thread.source;
  const subAgent = typeof source === "object" && "subAgent" in source ? source.subAgent : undefined;
  const spawn =
    typeof subAgent === "object" && "thread_spawn" in subAgent ? subAgent.thread_spawn : undefined;
  const agentPath = trimText(spawn?.agent_path);
  const nickname = trimText(thread.agentNickname) ?? trimText(spawn?.agent_nickname);
  const role = trimText(thread.agentRole) ?? trimText(spawn?.agent_role);
  const parentProviderThreadId =
    trimText(thread.parentThreadId) ?? trimText(spawn?.parent_thread_id);
  const depth = spawn ? nonNegativeInt(spawn.depth) : subagentDepthFromPath(agentPath);
  return {
    ...(agentPath ? { agentPath } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(parentProviderThreadId ? { parentProviderThreadId } : {}),
    ...(depth !== undefined ? { depth } : {}),
  };
}

function mapChildThreadEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const subagentId = event.subagentId;
  const providerThreadId = event.providerThreadId;
  if (!subagentId || !providerThreadId) {
    return [];
  }

  if (event.method === "thread/started") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStartedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const metadata = threadSpawnMetadata(payload.thread);
    const parentId = parentSubagentId(metadata.parentProviderThreadId, rootProviderThreadId);
    const task = trimText(payload.thread.preview);
    return [
      makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
        ...(parentId ? { parentSubagentId: parentId } : {}),
        ...(metadata.agentPath ? { agentPath: metadata.agentPath } : {}),
        ...(metadata.nickname ? { nickname: metadata.nickname } : {}),
        ...(metadata.role ? { role: metadata.role } : {}),
        ...(task ? { task } : {}),
        ...(metadata.depth !== undefined ? { depth: metadata.depth } : {}),
      }),
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        toSubagentStateFromThreadStatus(payload.thread.status),
      ),
    ];
  }

  if (event.method === "thread/status/changed") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStatusChangedNotification, event.payload);
    return payload
      ? [
          makeSubagentStateChangedEvent(
            event,
            canonicalThreadId,
            subagentId,
            toSubagentStateFromThreadStatus(payload.status),
          ),
        ]
      : [];
  }

  if (event.method === "thread/closed" || event.method === "thread/archived") {
    return [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, "completed")];
  }

  if (event.method === "thread/unarchived" || event.method === "turn/started") {
    return [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, "running")];
  }

  if (event.method === "turn/completed") {
    const payload = readPayload(EffectCodexSchema.V2TurnCompletedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const state =
      payload.turn.status === "failed"
        ? "error"
        : payload.turn.status === "interrupted"
          ? "interrupted"
          : "completed";
    return [
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        state,
        payload.turn.error?.message,
      ),
    ];
  }

  if (event.method === "error") {
    const payload = readPayload(EffectCodexSchema.V2ErrorNotification, event.payload);
    return [
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        payload?.willRetry ? "running" : "error",
        payload?.error.message ?? event.message,
      ),
    ];
  }

  return [];
}

function suppressGenericChildThreadEvent(event: ProviderEvent): boolean {
  if (!event.subagentId) {
    return false;
  }
  return (
    event.method === "thread/started" ||
    event.method === "thread/status/changed" ||
    event.method === "thread/archived" ||
    event.method === "thread/unarchived" ||
    event.method === "thread/closed"
  );
}

export function makeCodexRuntimeEventMapper(initialRootProviderThreadId?: string) {
  let rootProviderThreadId = trimText(initialRootProviderThreadId);
  const knownProviderThreadIds = new Set<string>();

  return (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
  ): ReadonlyArray<ProviderRuntimeEvent> => {
    if (event.kind === "notification" && event.method.startsWith("collabAgent/")) {
      return mapCollabAgentEvent(event, canonicalThreadId);
    }
    if (!event.subagentId && event.providerThreadId && !rootProviderThreadId) {
      rootProviderThreadId = event.providerThreadId;
    }

    const explicitEvents = [
      ...mapSubagentActivityEvents(event, canonicalThreadId, rootProviderThreadId),
      ...mapCollabAgentEvents(event, canonicalThreadId, rootProviderThreadId),
      ...mapChildThreadEvents(event, canonicalThreadId, rootProviderThreadId),
    ];
    for (const explicitEvent of explicitEvents) {
      if (explicitEvent.type === "subagent.discovered") {
        knownProviderThreadIds.add(explicitEvent.payload.providerThreadId);
      }
    }

    const placeholder =
      event.subagentId &&
      event.providerThreadId &&
      !knownProviderThreadIds.has(event.providerThreadId)
        ? [makeSubagentDiscoveredEvent(event, canonicalThreadId, event.providerThreadId)]
        : [];
    if (event.providerThreadId && event.subagentId) {
      knownProviderThreadIds.add(event.providerThreadId);
    }

    return [
      ...placeholder,
      ...explicitEvents,
      ...(suppressGenericChildThreadEvent(event)
        ? []
        : mapCanonicalRuntimeEvents(event, canonicalThreadId)),
    ];
  };
}

/**
 * Maps the session runtime's synthetic `collabAgent/*` events (native
 * multi-agent v2 child-thread signals) into the shared task.* lifecycle.
 * Agent identity = child thread id; nickname is the display title, role is
 * agentRole (fallback: last agentPath segment, then "general-purpose").
 * A completed child turn is idle (resumable), not terminal. timelineBypass
 * keeps these rows out of the parent chat.
 */
function mapCollabAgentEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : undefined;
  const agentThreadId = typeof payload?.agentThreadId === "string" ? payload.agentThreadId : "";
  if (!payload || agentThreadId.length === 0) {
    return [];
  }
  const base = runtimeEventBase(event, canonicalThreadId);
  const taskId = RuntimeTaskId.make(agentThreadId);
  const agentPath = typeof payload.agentPath === "string" ? payload.agentPath : undefined;
  const pathLeaf = agentPath?.split("/").findLast((segment) => segment.length > 0);
  const nickname = typeof payload.nickname === "string" ? payload.nickname : undefined;
  const role =
    (typeof payload.role === "string" ? payload.role : undefined) ?? pathLeaf ?? "general-purpose";
  // A bare thread id is not a name. Omitting the title lets the client fold
  // keep the real one from task.started instead of clobbering it (probe
  // finding: progress rows renamed math_one to its UUID).
  const knownName = nickname ?? pathLeaf;
  const title = knownName ?? agentThreadId;
  // Identity repeated on every status patch so rows are self-describing when
  // the start row ages out of activity retention (review finding: a
  // reconstructed agent had a UUID name and no role/path).
  const statusLinkage = {
    role,
    ...(knownName ? { title: knownName } : {}),
    ...(agentPath ? { agentPath } : {}),
    timelineBypass: true,
  } as const;

  switch (event.method) {
    case "collabAgent/started":
      return [
        {
          ...base,
          type: "task.started",
          payload: {
            taskId,
            description: title,
            title,
            role,
            ...(agentPath ? { agentPath } : {}),
            ...(typeof payload.parentThreadId === "string"
              ? { parentAgentId: payload.parentThreadId }
              : {}),
            timelineBypass: true,
          },
        },
      ];
    case "collabAgent/activity": {
      const activityKind = typeof payload.activityKind === "string" ? payload.activityKind : "";
      if (activityKind === "interrupted") {
        return [
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "interrupted", ...statusLinkage },
          },
        ];
      }
      if (activityKind === "started") {
        // Wire-probe finding: children often register via subAgentActivity
        // alone (no thread/started with a spawn source), so this is the one
        // shot at a task.started with a real name — agentPath leaf beats a
        // bare thread-id title.
        return [
          {
            ...base,
            type: "task.started",
            payload: {
              taskId,
              description: title,
              title,
              role,
              ...(agentPath ? { agentPath } : {}),
              timelineBypass: true,
            },
          },
        ];
      }
      // interacted → the child is (again) actively driven.
      return [
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status: "running", ...statusLinkage },
        },
      ];
    }
    case "collabAgent/turnStarted":
      return [
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status: "running", ...statusLinkage },
        },
      ];
    case "collabAgent/turnCompleted": {
      // Idle, not terminal: the identity is resumable via sendInput/resume.
      const turn =
        typeof payload.turn === "object" && payload.turn !== null
          ? (payload.turn as Record<string, unknown>)
          : undefined;
      const turnStatus = typeof turn?.status === "string" ? turn.status : undefined;
      const status =
        turnStatus === "failed"
          ? ("failed" as const)
          : turnStatus === "interrupted"
            ? ("interrupted" as const)
            : ("idle" as const);
      return [
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status, ...statusLinkage },
        },
      ];
    }
    case "collabAgent/statusChanged": {
      const status =
        typeof payload.status === "object" && payload.status !== null
          ? (payload.status as Record<string, unknown>)
          : undefined;
      const statusType = typeof status?.type === "string" ? status.type : undefined;
      if (statusType === "systemError") {
        // Silently dropping this once left children stuck running forever.
        return [
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "failed", ...statusLinkage },
          },
        ];
      }
      if (statusType === "active") {
        const flags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
        const waiting = flags.some(
          (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
        );
        return [
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: waiting ? "waiting" : "running", ...statusLinkage },
          },
        ];
      }
      if (statusType === "idle") {
        return [
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "idle", ...statusLinkage },
          },
        ];
      }
      return [];
    }
    case "collabAgent/tokenUsage": {
      // Cumulative per child thread: always the `total` breakdown, never
      // `last` (which shrinks on follow-ups). Client folds max-merge.
      const tokenUsage =
        typeof payload.tokenUsage === "object" && payload.tokenUsage !== null
          ? (payload.tokenUsage as Record<string, unknown>)
          : undefined;
      const total =
        typeof tokenUsage?.total === "object" && tokenUsage.total !== null
          ? (tokenUsage.total as Record<string, unknown>)
          : undefined;
      const count = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
      // Same validation as every other field: RuntimeTaskUsage.totalTokens
      // is NonNegativeInt, so NaN/Infinity/negative wire values must miss.
      const totalTokens = count(total?.totalTokens);
      if (totalTokens === undefined) {
        return [];
      }
      const typedUsage: RuntimeTaskUsage = {
        totalTokens,
        ...(count(total?.inputTokens) !== undefined
          ? { inputTokens: count(total?.inputTokens) }
          : {}),
        ...(count(total?.cachedInputTokens) !== undefined
          ? { cachedInputTokens: count(total?.cachedInputTokens) }
          : {}),
        ...(count(total?.outputTokens) !== undefined
          ? { outputTokens: count(total?.outputTokens) }
          : {}),
        ...(count(total?.reasoningOutputTokens) !== undefined
          ? { reasoningOutputTokens: count(total?.reasoningOutputTokens) }
          : {}),
      };
      return [
        {
          ...base,
          type: "task.progress",
          payload: {
            taskId,
            description: title,
            ...(knownName ? { title: knownName } : {}),
            typedUsage,
            timelineBypass: true,
          },
        },
      ];
    }
    case "collabAgent/item": {
      const item =
        typeof payload.item === "object" && payload.item !== null
          ? (payload.item as Record<string, unknown>)
          : undefined;
      const itemTypeRaw = typeof item?.type === "string" ? item.type : undefined;
      if (!itemTypeRaw) {
        return [];
      }
      // A loose summary from the raw item: the child stream is untyped at
      // this boundary (synthetic event payload), so read best-effort fields
      // rather than force a schema decode.
      const looseSummary =
        (typeof item?.command === "string" ? item.command : undefined) ??
        (typeof item?.title === "string" ? item.title : undefined) ??
        (typeof item?.query === "string" ? item.query : undefined);
      const canonical = toCanonicalItemType(itemTypeRaw);
      const summary = looseSummary ?? canonical.replaceAll("_", " ");
      return [
        {
          ...base,
          type: "task.progress",
          payload: {
            taskId,
            description: title,
            ...(knownName ? { title: knownName } : {}),
            summary,
            timelineBypass: true,
          },
        },
      ];
    }
    case "collabAgent/closed":
      return [
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status: "interrupted", ...statusLinkage },
        },
      ];
    default:
      return [];
  }
}

function mapCanonicalRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  if (event.kind === "error") {
    if (!event.message) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "runtime.error",
        payload: {
          message: event.message,
          class: "provider_error",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.kind === "request") {
    if (event.method === "item/tool/requestUserInput") {
      const payload =
        readPayload(EffectCodexSchema.ServerRequest__ToolRequestUserInputParams, event.payload) ??
        readPayload(EffectCodexSchema.ToolRequestUserInputParams, event.payload);
      const questions = payload ? toUserInputQuestions(payload.questions) : undefined;
      if (!questions) {
        return [];
      }
      return [
        {
          ...runtimeEventBase(event, canonicalThreadId),
          type: "user-input.requested",
          payload: {
            questions,
          },
        },
      ];
    }

    const detail = (() => {
      switch (event.method) {
        case "item/commandExecution/requestApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__CommandExecutionRequestApprovalParams,
            event.payload,
          );
          return payload?.command ?? payload?.reason ?? undefined;
        }
        case "item/fileChange/requestApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__FileChangeRequestApprovalParams,
            event.payload,
          );
          return payload?.reason ?? undefined;
        }
        case "applyPatchApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__ApplyPatchApprovalParams,
            event.payload,
          );
          return payload?.reason ?? undefined;
        }
        case "execCommandApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__ExecCommandApprovalParams,
            event.payload,
          );
          return payload?.reason ?? payload?.command.join(" ");
        }
        case "item/tool/call": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__DynamicToolCallParams,
            event.payload,
          );
          return payload?.tool ?? undefined;
        }
        default:
          return undefined;
      }
    })();

    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.opened",
        payload: {
          requestType: toRequestTypeFromMethod(event.method),
          ...(detail ? { detail } : {}),
          ...(event.payload !== undefined ? { args: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/requestApproval/decision" && event.requestId) {
    const payload = readPayload(ApprovalDecisionPayload, event.payload);
    const requestType =
      event.requestKind !== undefined
        ? toRequestTypeFromKind(event.requestKind)
        : toRequestTypeFromMethod(event.method);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(payload ? { decision: payload.decision } : {}),
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/connecting") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "starting",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/ready") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "ready",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/started") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.started",
        payload: {
          ...(event.message ? { message: event.message } : {}),
          ...(event.payload !== undefined ? { resume: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/exited" || event.method === "session/closed") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.exited",
        payload: {
          ...(event.message ? { reason: event.message } : {}),
          ...(event.method === "session/closed" ? { exitKind: "graceful" } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/started") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStartedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.started",
        payload: {
          providerThreadId: payload.thread.id,
        },
      },
    ];
  }

  if (
    event.method === "thread/status/changed" ||
    event.method === "thread/archived" ||
    event.method === "thread/unarchived" ||
    event.method === "thread/closed" ||
    event.method === "thread/compacted"
  ) {
    const payload =
      event.method === "thread/status/changed"
        ? readPayload(EffectCodexSchema.V2ThreadStatusChangedNotification, event.payload)
        : undefined;
    return [
      {
        type: "thread.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state:
            event.method === "thread/archived"
              ? "archived"
              : event.method === "thread/closed"
                ? "closed"
                : event.method === "thread/compacted"
                  ? "compacted"
                  : payload
                    ? toThreadState(payload.status)
                    : "active",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/name/updated") {
    const payload = readPayload(EffectCodexSchema.V2ThreadNameUpdatedNotification, event.payload);
    return [
      {
        type: "thread.metadata.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          ...(trimText(payload?.threadName) ? { name: trimText(payload?.threadName) } : {}),
          ...(payload
            ? {
                metadata: {
                  threadId: payload.threadId,
                  ...(payload.threadName !== undefined && payload.threadName !== null
                    ? { threadName: payload.threadName }
                    : {}),
                },
              }
            : {}),
        },
      },
    ];
  }

  if (event.method === "thread/tokenUsage/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification,
      event.payload,
    );
    const normalizedUsage = payload ? normalizeCodexTokenUsage(payload.tokenUsage) : undefined;
    if (!normalizedUsage) {
      return [];
    }
    return [
      {
        type: "thread.token-usage.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          usage: normalizedUsage,
        },
      },
    ];
  }

  if (event.method === "turn/started") {
    const turnId = event.turnId;
    if (!turnId) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        turnId,
        type: "turn.started",
        payload: {},
      },
    ];
  }

  if (event.method === "turn/completed") {
    const payload = readPayload(EffectCodexSchema.V2TurnCompletedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const errorMessage = trimText(payload.turn.error?.message);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.completed",
        payload: {
          state: toTurnStatus(payload.turn.status),
          ...(errorMessage ? { errorMessage } : {}),
        },
      },
    ];
  }

  if (event.method === "turn/aborted") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.aborted",
        payload: {
          reason: event.message ?? "Turn aborted",
        },
      },
    ];
  }

  if (event.method === "turn/plan/updated") {
    const payload = readPayload(EffectCodexSchema.V2TurnPlanUpdatedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.plan.updated",
        payload: {
          ...(trimText(payload.explanation) ? { explanation: trimText(payload.explanation) } : {}),
          plan: payload.plan.map((step) => ({
            step: trimText(step.step) ?? "step",
            status:
              step.status === "completed" || step.status === "inProgress" ? step.status : "pending",
          })),
        },
      },
    ];
  }

  if (event.method === "turn/diff/updated") {
    const payload = readPayload(EffectCodexSchema.V2TurnDiffUpdatedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.diff.updated",
        payload: {
          unifiedDiff: payload.diff,
        },
      },
    ];
  }

  if (event.method === "item/started") {
    const started = mapItemLifecycle(event, canonicalThreadId, "item.started");
    return started ? [started] : [];
  }

  if (event.method === "item/completed") {
    const payload = readPayload(EffectCodexSchema.V2ItemCompletedNotification, event.payload);
    const item = payload?.item;
    if (!item) {
      return [];
    }
    const itemType = toCanonicalItemType(item.type);
    if (itemType === "plan") {
      const detail = itemDetail(itemType, item);
      if (!detail) {
        return [];
      }
      return [
        {
          ...runtimeEventBase(event, canonicalThreadId),
          type: "turn.proposed.completed",
          payload: {
            planMarkdown: detail,
          },
        },
      ];
    }
    const completed = mapItemLifecycle(event, canonicalThreadId, "item.completed");
    return completed ? [completed] : [];
  }

  if (
    event.method === "item/reasoning/summaryPartAdded" ||
    event.method === "item/commandExecution/terminalInteraction"
  ) {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "item.updated",
        payload: {
          itemType:
            event.method === "item/reasoning/summaryPartAdded" ? "reasoning" : "command_execution",
          ...(event.payload !== undefined ? { data: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/plan/delta") {
    const payload = readPayload(EffectCodexSchema.V2PlanDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.proposed.delta",
        payload: {
          delta,
        },
      },
    ];
  }

  if (event.method === "item/agentMessage/delta") {
    const payload = readPayload(EffectCodexSchema.V2AgentMessageDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: contentStreamKindFromMethod(event.method),
          delta,
        },
      },
    ];
  }

  if (event.method === "item/commandExecution/outputDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2CommandExecutionOutputDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "command_output",
          delta,
        },
      },
    ];
  }

  if (event.method === "item/fileChange/outputDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2FileChangeOutputDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "file_change_output",
          delta,
        },
      },
    ];
  }

  if (event.method === "item/reasoning/summaryTextDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2ReasoningSummaryTextDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_summary_text",
          delta,
          ...(payload ? { summaryIndex: payload.summaryIndex } : {}),
        },
      },
    ];
  }

  if (event.method === "item/reasoning/textDelta") {
    const payload = readPayload(EffectCodexSchema.V2ReasoningTextDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_text",
          delta,
          ...(payload ? { contentIndex: payload.contentIndex } : {}),
        },
      },
    ];
  }

  if (event.method === "item/mcpToolCall/progress") {
    const payload = readPayload(EffectCodexSchema.V2McpToolCallProgressNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "tool.progress",
        payload: {
          summary: payload.message,
        },
      },
    ];
  }

  if (event.method === "serverRequest/resolved") {
    const payload = readPayload(
      EffectCodexSchema.V2ServerRequestResolvedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const requestType = toRequestTypeFromKind(event.requestKind);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/tool/requestUserInput/answered") {
    const payload = readPayload(EffectCodexSchema.ToolRequestUserInputResponse, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "user-input.resolved",
        payload: {
          answers: toCanonicalUserInputAnswers(payload.answers),
        },
      },
    ];
  }

  if (event.method === "model/rerouted") {
    const payload = readPayload(EffectCodexSchema.V2ModelReroutedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "model.rerouted",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          fromModel: payload.fromModel,
          toModel: payload.toModel,
          reason: payload.reason,
        },
      },
    ];
  }

  if (event.method === "deprecationNotice") {
    const payload = readPayload(EffectCodexSchema.V2DeprecationNoticeNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "deprecation.notice",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: payload.summary,
          ...(trimText(payload.details) ? { details: trimText(payload.details) } : {}),
        },
      },
    ];
  }

  if (event.method === "configWarning") {
    const payload = readPayload(EffectCodexSchema.V2ConfigWarningNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "config.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: payload.summary,
          ...(trimText(payload.details) ? { details: trimText(payload.details) } : {}),
          ...(trimText(payload.path) ? { path: trimText(payload.path) } : {}),
          ...(payload.range !== undefined && payload.range !== null
            ? { range: payload.range }
            : {}),
        },
      },
    ];
  }

  if (event.method === "account/updated") {
    if (!readPayload(EffectCodexSchema.V2AccountUpdatedNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "account.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          account: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "account/rateLimits/updated") {
    if (!readPayload(EffectCodexSchema.V2AccountRateLimitsUpdatedNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "account.rate-limits.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          rateLimits: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "mcpServer/oauthLogin/completed") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const error = payload.error ? sanitizeMcpRuntimeText(payload.error) : undefined;
    return [
      {
        type: "mcp.oauth.completed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          success: payload.success,
          name: payload.name,
          ...(error ? { error } : {}),
        },
      },
    ];
  }

  if (event.method === "mcpServer/startupStatus/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerStatusUpdatedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const error = payload.error ? sanitizeMcpRuntimeText(payload.error) : undefined;
    return [
      {
        type: "mcp.status.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          status: {
            name: payload.name,
            status: payload.status,
            ...(error ? { error } : {}),
            ...(payload.failureReason ? { failureReason: payload.failureReason } : {}),
          },
        },
      },
    ];
  }

  if (event.method === "thread/realtime/started") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeStartedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.started",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          realtimeSessionId: payload.realtimeSessionId ?? undefined,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/itemAdded") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeItemAddedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.item-added",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          item: payload.item,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/outputAudio/delta") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeOutputAudioDeltaNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.audio.delta",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          audio: payload.audio,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/error") {
    const payload = readPayload(EffectCodexSchema.V2ThreadRealtimeErrorNotification, event.payload);
    const message = payload?.message ?? event.message ?? "Realtime error";
    return [
      {
        type: "thread.realtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/closed") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeClosedNotification,
      event.payload,
    );
    return [
      {
        type: "thread.realtime.closed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          reason: payload?.reason ?? event.message,
        },
      },
    ];
  }

  if (event.method === "error") {
    const payload = readPayload(EffectCodexSchema.V2ErrorNotification, event.payload);
    const message = payload?.error.message ?? event.message ?? "Provider runtime error";
    const willRetry = payload?.willRetry === true;
    return [
      {
        type: willRetry ? "runtime.warning" : "runtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
          ...(!willRetry ? { class: "provider_error" as const } : {}),
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "process/stderr") {
    const message = event.message ?? "Codex process stderr";
    const isFatal = isFatalCodexProcessStderrMessage(message);
    return [
      isFatal
        ? {
            type: "runtime.error",
            ...runtimeEventBase(event, canonicalThreadId),
            payload: {
              message,
              class: "provider_error" as const,
              ...(event.payload !== undefined ? { detail: event.payload } : {}),
            },
          }
        : {
            type: "runtime.warning",
            ...runtimeEventBase(event, canonicalThreadId),
            payload: {
              message,
              ...(event.payload !== undefined ? { detail: event.payload } : {}),
            },
          },
    ];
  }

  if (event.method === "windows/worldWritableWarning") {
    if (!readPayload(EffectCodexSchema.V2WindowsWorldWritableWarningNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "runtime.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message: event.message ?? "Windows world-writable warning",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "windowsSandbox/setupCompleted") {
    const payload = readPayload(
      EffectCodexSchema.V2WindowsSandboxSetupCompletedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const successMessage = event.message ?? "Windows sandbox setup completed";
    const failureMessage = event.message ?? "Windows sandbox setup failed";

    return [
      {
        type: "session.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state: payload.success === false ? "error" : "ready",
          reason: payload.success === false ? failureMessage : successMessage,
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
      ...(payload.success === false
        ? [
            {
              type: "runtime.warning" as const,
              ...runtimeEventBase(event, canonicalThreadId),
              payload: {
                message: failureMessage,
                ...(event.payload !== undefined ? { detail: event.payload } : {}),
              },
            },
          ]
        : []),
    ];
  }

  return [];
}

/**
 * Build a Codex provider adapter bound to a specific `CodexSettings` payload.
 *
 * The adapter is a captured closure over `codexConfig` — the `binaryPath` and
 * `homePath` are read from that payload, not from `ServerSettingsService`.
 * This is what makes multi-instance routing possible: each `ProviderInstance`
 * in the registry owns its own closure with its own config, so two Codex
 * instances with different `homePath`s cannot step on each other.
 */
export const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function* (
  codexConfig: CodexSettings,
  options?: CodexAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("codex");
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* Effect.service(ServerConfig);
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, CodexAdapterSessionContext>();

  const startSession: CodexAdapterShape["startSession"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) {
          yield* Effect.suspend(() => stopSessionInternal(existing));
        }
        const runtimeSessionId =
          input.runtimeSessionId ??
          RuntimeSessionId.make(
            yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "crypto/randomUUIDv4",
                    detail: "Failed to generate Codex runtime identifier.",
                    cause,
                  }),
              ),
            ),
          );

        const serviceTier =
          input.modelSelection?.instanceId === boundInstanceId
            ? getCodexServiceTierOptionValue(input.modelSelection)
            : undefined;
        const fetchWorker = input.purpose === "fetch-worker";
        const runtimeMode = fetchWorker ? "approval-required" : input.runtimeMode;
        const cwd = input.cwd ?? process.cwd();
        const resolvedMcpServers =
          !fetchWorker && options?.resolveMcpServers
            ? yield* options.resolveMcpServers({ cwd })
            : [];
        const mcpSession = fetchWorker
          ? undefined
          : McpProviderSession.readMcpProviderSession(input.threadId);
        const appServerArgs = [
          ...(fetchWorker ? ["--disable", "multi_agent", "-c", "mcp_servers={}"] : []),
          ...(mcpSession
            ? [
                "-c",
                `mcp_servers.t3-code.url=${mcpSession.endpoint}`,
                "-c",
                'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"',
              ]
            : []),
        ];
        const runtimeInput: CodexSessionRuntimeOptions = {
          threadId: input.threadId,
          providerInstanceId: boundInstanceId,
          cwd,
          binaryPath: codexConfig.binaryPath,
          launchArgs: resolveCodexLaunchArgs(codexConfig.launchArgs, options?.environment),
          ...(options?.environment ? { environment: options.environment } : {}),
          ...(codexConfig.homePath ? { homePath: codexConfig.homePath } : {}),
          ...(!fetchWorker && isCodexResumeCursorSchema(input.resumeCursor)
            ? { resumeCursor: input.resumeCursor }
            : {}),
          runtimeMode,
          ...(input.modelSelection?.instanceId === boundInstanceId
            ? { model: input.modelSelection.model }
            : {}),
          ...(serviceTier ? { serviceTier } : {}),
          ...(mcpSession
            ? {
                environment: {
                  ...(options?.environment ?? process.env),
                  T3_MCP_BEARER_TOKEN: mcpSession.authorizationHeader.replace(/^Bearer\s+/, ""),
                },
                internalMcpServer: {
                  url: mcpSession.endpoint,
                  bearerTokenEnvVar: "T3_MCP_BEARER_TOKEN",
                },
              }
            : {}),
          ...(appServerArgs.length > 0 ? { appServerArgs } : {}),
          ...(options?.resolveMcpServers ? { mcpServers: resolvedMcpServers } : {}),
        };
        const sessionScope = yield* Scope.make("sequential");
        let sessionScopeTransferred = false;
        yield* Effect.addFinalizer(() =>
          sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const createRuntime = options?.makeRuntime ?? makeCodexSessionRuntime;
        const runtime = yield* createRuntime(runtimeInput).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );
        const mapRuntimeEvent = makeCodexRuntimeEventMapper(runtimeInput.resumeCursor?.threadId);
        const mcpStartupStatuses = new Map<string, CodexMcpStartupObservation>();

        const eventFiber = yield* Stream.runForEach(runtime.events, (event) =>
          Effect.gen(function* () {
            yield* writeNativeEvent(sanitizeCodexMcpNativeEvent(event));
            observeCodexMcpEvent(event, mcpStartupStatuses);
            const runtimeEvents = mapRuntimeEvent(event, event.threadId);
            if (runtimeEvents.length === 0) {
              yield* Effect.logDebug("ignoring unhandled Codex provider event", {
                method: event.method,
                threadId: event.threadId,
                turnId: event.turnId,
                itemId: event.itemId,
              });
              return;
            }
            yield* Queue.offerAll(
              runtimeEventQueue,
              runtimeEvents.map((runtimeEvent) =>
                stampProviderRuntimeEventOrigin(runtimeSessionId, runtimeEvent),
              ),
            );
          }),
        ).pipe(Effect.forkIn(sessionScope));

        const started = yield* runtime.start().pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
          Effect.onError(() =>
            runtime.close.pipe(
              Effect.andThen(Effect.ignore(Scope.close(sessionScope, Exit.void))),
              Effect.andThen(Fiber.interrupt(eventFiber)),
              Effect.ignore,
            ),
          ),
        );

        sessions.set(input.threadId, {
          threadId: input.threadId,
          runtimeSessionId,
          cwd,
          scope: sessionScope,
          runtime,
          eventFiber,
          managedMcpServers: codexManagedMcpServers(resolvedMcpServers),
          mcpStartupStatuses,
          builtInMcpExpected: mcpSession !== undefined,
          stopped: false,
        });
        sessionScopeTransferred = true;

        return {
          ...started,
          runtimeSessionId,
        };
      }),
    );

  const resolveAttachment = Effect.fn("resolveAttachment")(function* (
    input: ProviderSendTurnInput,
    attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
  ) {
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Invalid attachment id '${attachment.id}'.`,
      });
    }
    const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: `Failed to read attachment file: ${cause.message}.`,
            cause,
          }),
      ),
    );
    return {
      type: "image" as const,
      url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  });

  const sendTurn: CodexAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
    const codexAttachments = yield* Effect.forEach(
      input.attachments ?? [],
      (attachment) => resolveAttachment(input, attachment),
      { concurrency: 1 },
    );

    const session = yield* requireSession(input.threadId);
    const reasoningEffort =
      input.modelSelection?.instanceId === boundInstanceId
        ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
        : undefined;
    const serviceTier =
      input.modelSelection?.instanceId === boundInstanceId
        ? getCodexServiceTierOptionValue(input.modelSelection)
        : undefined;
    return yield* session.runtime
      .sendTurn({
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.modelSelection?.instanceId === boundInstanceId
          ? { model: input.modelSelection.model }
          : {}),
        ...(reasoningEffort
          ? {
              effort: reasoningEffort as EffectCodexSchema.V2TurnStartParams__ReasoningEffort,
            }
          : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
        ...(codexAttachments.length > 0 ? { attachments: codexAttachments } : {}),
      })
      .pipe(Effect.mapError((cause) => mapCodexRuntimeError(input.threadId, "turn/start", cause)));
  });

  const requireSession = Effect.fn("requireSession")(function* (threadId: ThreadId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      });
    }
    return session;
  });

  const requireMcpRuntimeSession = Effect.fn("requireMcpRuntimeSession")(function* (input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly threadId: ThreadId;
    readonly runtimeSessionId: RuntimeSessionId;
  }) {
    const session = sessions.get(input.threadId);
    if (
      input.providerInstanceId !== boundInstanceId ||
      !session ||
      session.stopped ||
      session.runtimeSessionId !== input.runtimeSessionId
    ) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId: input.threadId,
      });
    }
    return session;
  });

  const readMcpStatuses = (
    session: CodexAdapterSessionContext,
    detail: EffectCodexSchema.V2ListMcpServerStatusParams__McpServerStatusDetail,
  ) =>
    session.runtime
      .listMcpServerStatuses(detail)
      .pipe(
        Effect.mapError((cause) =>
          mapCodexRuntimeError(session.threadId, "mcpServerStatus/list", cause),
        ),
      );

  const reloadMcpStatuses = (session: CodexAdapterSessionContext) => {
    const previousStatuses = new Map(session.mcpStartupStatuses);
    return Effect.sync(() => session.mcpStartupStatuses.clear()).pipe(
      Effect.andThen(session.runtime.reloadMcpServers),
      Effect.tapError(() =>
        Effect.sync(() => {
          for (const [providerKey, status] of previousStatuses) {
            if (!session.mcpStartupStatuses.has(providerKey)) {
              session.mcpStartupStatuses.set(providerKey, status);
            }
          }
        }),
      ),
      Effect.mapError((cause) =>
        mapCodexRuntimeError(session.threadId, "config/mcpServer/reload", cause),
      ),
    );
  };

  const getMcpRuntimeSnapshot: NonNullable<CodexAdapterShape["mcpRuntime"]>["getSnapshot"] =
    Effect.fn("CodexAdapter.getMcpRuntimeSnapshot")(function* (input) {
      const session = yield* requireMcpRuntimeSession(input);
      const statuses = yield* readMcpStatuses(session, "toolsAndAuthOnly");
      const observedAt = DateTime.formatIso(yield* DateTime.now);
      return normalizeCodexMcpSnapshot({
        statuses,
        providerInstanceId: boundInstanceId,
        threadId: session.threadId,
        runtimeSessionId: session.runtimeSessionId,
        observedAt,
        managedMcpServers: session.managedMcpServers,
        startupStatuses: session.mcpStartupStatuses,
        builtInMcpExpected: session.builtInMcpExpected,
      });
    });

  const getMcpRuntimeServerDetails: NonNullable<
    NonNullable<CodexAdapterShape["mcpRuntime"]>["getServerDetails"]
  > = Effect.fn("CodexAdapter.getMcpRuntimeServerDetails")(function* (input) {
    const session = yield* requireMcpRuntimeSession(input);
    const statuses = yield* readMcpStatuses(session, "full");
    const providerKey = codexMcpProviderKey(input.providerKey);
    const status = findCodexMcpStatus(statuses, providerKey);
    if (!status) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "mcpServerStatus/list",
        detail: `Codex MCP server '${input.providerKey}' is not part of the selected runtime.`,
      });
    }
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const server = applyCodexMcpStartupObservation(
      normalizeCodexMcpServer({
        status,
        providerInstanceId: boundInstanceId,
        threadId: session.threadId,
        runtimeSessionId: session.runtimeSessionId,
        observedAt,
        managedMcpServers: session.managedMcpServers,
        builtInMcpExpected: session.builtInMcpExpected,
      }),
      session.mcpStartupStatuses.get(status.name),
    );
    const tools = Object.values(status.tools).flatMap((tool) => {
      const normalized = normalizeCodexMcpTool(tool);
      return normalized ? [normalized] : [];
    });
    const resources = status.resources.flatMap((resource) => {
      const normalized = normalizeCodexMcpResource(resource);
      return normalized ? [normalized] : [];
    });
    const templates = status.resourceTemplates.flatMap((template) => {
      const normalized = normalizeCodexMcpResourceTemplate(template);
      return normalized ? [normalized] : [];
    });
    return { server, tools, resources, templates };
  });

  const runMcpRuntimeAction: NonNullable<
    NonNullable<CodexAdapterShape["mcpRuntime"]>["runAction"]
  > = Effect.fn("CodexAdapter.runMcpRuntimeAction")(function* (input) {
    const session = yield* requireMcpRuntimeSession(input);
    const statuses = yield* readMcpStatuses(session, "toolsAndAuthOnly");
    const providerKey = codexMcpProviderKey(input.providerKey);
    const status = findCodexMcpStatus(statuses, providerKey);
    if (!status) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "mcpServerStatus/list",
        detail: `Codex MCP server '${input.providerKey}' is not part of the selected runtime.`,
      });
    }

    if (input.action === "authorize") {
      const source =
        status.name === "t3-code" && session.builtInMcpExpected
          ? ("t3-built-in" as const)
          : session.managedMcpServers.has(status.name)
            ? ("t3-managed" as const)
            : ("provider-native" as const);
      if (!codexMcpAvailableActions(status, source).includes("authorize")) {
        return {
          accepted: false,
          action: input.action,
          providerKey,
          message: "Codex does not currently report an OAuth authorization requirement.",
        };
      }
      const authorization = yield* session.runtime
        .startMcpOauth({ serverName: status.name })
        .pipe(
          Effect.mapError((cause) =>
            mapCodexRuntimeError(session.threadId, "mcpServer/oauth/login", cause),
          ),
        );
      return {
        accepted: true,
        action: input.action,
        providerKey,
        authorizationUrl: authorization.authorizationUrl,
      };
    }

    yield* reloadMcpStatuses(session);
    const refreshedStatuses = yield* readMcpStatuses(session, "toolsAndAuthOnly");
    if (!findCodexMcpStatus(refreshedStatuses, providerKey)) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "config/mcpServer/reload",
        detail: `Codex MCP server '${input.providerKey}' was not reported after reload.`,
      });
    }
    return {
      accepted: true,
      action: input.action,
      providerKey,
      message:
        input.action === "reconnect"
          ? "Codex reloaded and rediscovered this MCP server."
          : "Codex refreshed this MCP server.",
    };
  });

  const applyMcpConfiguration: NonNullable<
    NonNullable<CodexAdapterShape["mcpRuntime"]>["applyConfiguration"]
  > = Effect.fn("CodexAdapter.applyMcpConfiguration")(function* (input) {
    const session = yield* requireMcpRuntimeSession(input);
    const desiredServers = options?.resolveMcpServers
      ? yield* options.resolveMcpServers({ cwd: session.cwd })
      : Array.from(session.managedMcpServers.values());
    const desiredManagedServers = codexManagedMcpServers(desiredServers);
    const previouslyManagedKeys = new Set(session.managedMcpServers.keys());

    yield* reloadMcpStatuses(session);
    const statuses = yield* readMcpStatuses(session, "toolsAndAuthOnly");
    const observedKeys = new Set(statuses.map((status) => status.name));
    const missingKeys = Array.from(desiredManagedServers.keys()).filter(
      (providerKey) => !observedKeys.has(providerKey),
    );
    const lingeringKeys = Array.from(previouslyManagedKeys).filter(
      (providerKey) => !desiredManagedServers.has(providerKey) && observedKeys.has(providerKey),
    );

    if (missingKeys.length > 0 || lingeringKeys.length > 0) {
      return "pending-next-session";
    }
    session.managedMcpServers = desiredManagedServers;
    return "applied";
  });

  const interruptTurn: CodexAdapterShape["interruptTurn"] = (
    threadId,
    turnId,
    expectedRuntimeSessionId,
  ) =>
    Effect.gen(function* () {
      const current = sessions.get(threadId);
      if (
        expectedRuntimeSessionId !== undefined &&
        (!current || current.stopped || current.runtimeSessionId !== expectedRuntimeSessionId)
      ) {
        return;
      }
      const session = yield* requireSession(threadId);
      yield* session.runtime.interruptTurn(turnId);
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "turn/interrupt", cause),
      ),
    );

  const forceStopSession: CodexAdapterShape["forceStopSession"] = Effect.fn(
    "CodexAdapter.forceStopSession",
  )(function* (threadId, expectedRuntimeSessionId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped || session.runtimeSessionId !== expectedRuntimeSessionId) {
      return {
        outcome: "terminated",
        mechanism: "already-stopped",
      };
    }

    session.stopped = true;
    sessions.delete(threadId);
    yield* session.runtime.forceClose.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: cause.message,
            cause,
          }),
      ),
      Effect.ensuring(
        Fiber.interrupt(session.eventFiber).pipe(
          Effect.ignore,
          Effect.andThen(Scope.close(session.scope, Exit.void).pipe(Effect.ignore)),
        ),
      ),
    );

    return {
      outcome: "terminated",
      mechanism: "process-tree",
    };
  });

  const readThread: CodexAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.readThread),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/read", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );

  const rollbackThread: CodexAdapterShape["rollbackThread"] = (threadId, numTurns) => {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        }),
      );
    }

    return requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.rollbackThread(numTurns)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/rollback", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );
  };

  const respondToRequest: CodexAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToRequest(requestId, decision)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/requestApproval/decision", cause),
      ),
    );

  const respondToUserInput: CodexAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToUserInput(requestId, answers)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/tool/requestUserInput", cause),
      ),
    );

  const writeNativeEvent = Effect.fnUntraced(function* (event: ProviderEvent) {
    if (!nativeEventLogger) {
      return;
    }
    yield* nativeEventLogger.write(event, event.threadId);
  });

  const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (
    session: CodexAdapterSessionContext,
  ) {
    if (session.stopped) {
      return;
    }
    session.stopped = true;
    sessions.delete(session.threadId);
    yield* session.runtime.close.pipe(Effect.ignore);
    yield* Effect.ignore(Scope.close(session.scope, Exit.void));
    yield* Fiber.interrupt(session.eventFiber).pipe(Effect.ignore);
  });

  const stopSession: CodexAdapterShape["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (!session) {
        return;
      }
      yield* stopSessionInternal(session);
    });

  const listSessions: CodexAdapterShape["listSessions"] = () =>
    Effect.forEach(
      Array.from(sessions.values()).filter((session) => !session.stopped),
      (session) => session.runtime.getSession,
      { concurrency: 1 },
    );

  const hasSession: CodexAdapterShape["hasSession"] = (threadId) =>
    Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

  const stopAll: CodexAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, {
      concurrency: 1,
      discard: true,
    }).pipe(Effect.asVoid);

  yield* Effect.acquireRelease(Effect.void, () =>
    stopAll().pipe(
      Effect.andThen(Queue.shutdown(runtimeEventQueue)),
      Effect.andThen(managedNativeEventLogger?.close() ?? Effect.void),
      Effect.ignore,
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
      mcp: "nativeConfig",
    },
    mcpRuntime: {
      getSnapshot: getMcpRuntimeSnapshot,
      getServerDetails: getMcpRuntimeServerDetails,
      runAction: runMcpRuntimeAction,
      applyConfiguration: applyMcpConfiguration,
    },
    startSession,
    sendTurn,
    interruptTurn,
    forceStopSession,
    readThread,
    rollbackThread,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies CodexAdapterShape;
});

// NOTE: the old `CodexAdapterLive` / `makeCodexAdapterLive` singleton Layer
// exports have been removed as part of the per-instance-driver refactor.
// `makeCodexAdapter(codexConfig, options?)` is now invoked directly by
// `CodexDriver.create()` for each configured instance; downstream consumers
// (server bootstrap, integration harness, this module's tests) will be
// migrated to the registry in a follow-up pass.
