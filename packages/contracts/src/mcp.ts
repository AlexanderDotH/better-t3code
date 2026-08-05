import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AgentImportSourceId,
  AgentImportSourcesInput,
  AgentImportSourcesResult,
} from "./agentImport.ts";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RuntimeSessionId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

const MCP_ID_MAX_CHARS = 96;
const MCP_NAME_MAX_CHARS = 128;
const MCP_SECRET_VALUE_MAX_CHARS = 65_536;
const MCP_ENV_NAME_MAX_CHARS = 128;
const MCP_HEADER_NAME_MAX_CHARS = 128;
const MCP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MCP_ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MCP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MCP_HTTP_URL_PATTERN = /^https?:\/\/.+/i;

export const McpServerId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MCP_ID_MAX_CHARS),
  Schema.isPattern(MCP_ID_PATTERN),
).pipe(Schema.brand("McpServerId"));
export type McpServerId = typeof McpServerId.Type;

export const McpServerName = TrimmedNonEmptyString.check(Schema.isMaxLength(MCP_NAME_MAX_CHARS));
export type McpServerName = typeof McpServerName.Type;

export const McpServerScope = Schema.Literals(["global", "project"]);
export type McpServerScope = typeof McpServerScope.Type;

export const McpServerTransport = Schema.Literals(["stdio", "sse", "http"]);
export type McpServerTransport = typeof McpServerTransport.Type;

export const McpProviderRouting = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("all") }),
  Schema.Struct({
    mode: Schema.Literal("selected"),
    instanceIds: Schema.Array(ProviderInstanceId),
  }),
]);
export type McpProviderRouting = typeof McpProviderRouting.Type;

const defaultMcpProviderRouting = { mode: "all" as const };

export const McpSecretValue = Schema.Struct({
  value: Schema.String.check(Schema.isMaxLength(MCP_SECRET_VALUE_MAX_CHARS)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  sensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});
export type McpSecretValue = typeof McpSecretValue.Type;

export const McpEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MCP_ENV_NAME_MAX_CHARS),
  Schema.isPattern(MCP_ENV_NAME_PATTERN),
);
export type McpEnvironmentVariableName = typeof McpEnvironmentVariableName.Type;

export const McpHeaderName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MCP_HEADER_NAME_MAX_CHARS),
  Schema.isPattern(MCP_HEADER_NAME_PATTERN),
);
export type McpHeaderName = typeof McpHeaderName.Type;

export const McpEnvironment = Schema.Record(McpEnvironmentVariableName, McpSecretValue);
export type McpEnvironment = typeof McpEnvironment.Type;

export const McpHeaders = Schema.Record(McpHeaderName, McpSecretValue);
export type McpHeaders = typeof McpHeaders.Type;

export const McpServerUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(8_192),
  Schema.isPattern(MCP_HTTP_URL_PATTERN),
);
export type McpServerUrl = typeof McpServerUrl.Type;

const McpServerDefinitionBase = {
  id: McpServerId,
  name: McpServerName,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  providerRouting: McpProviderRouting.pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultMcpProviderRouting)),
  ),
  scope: McpServerScope.pipe(Schema.withDecodingDefault(Effect.succeed("global" as const))),
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
} as const;

export const McpStdioServerDefinition = Schema.Struct({
  ...McpServerDefinitionBase,
  transport: Schema.Literal("stdio"),
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(8_192)),
  args: Schema.Array(TrimmedString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  cwd: Schema.optionalKey(TrimmedNonEmptyString),
  env: McpEnvironment.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type McpStdioServerDefinition = typeof McpStdioServerDefinition.Type;

export const McpSseServerDefinition = Schema.Struct({
  ...McpServerDefinitionBase,
  transport: Schema.Literal("sse"),
  url: McpServerUrl,
  headers: McpHeaders.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type McpSseServerDefinition = typeof McpSseServerDefinition.Type;

export const McpHttpServerDefinition = Schema.Struct({
  ...McpServerDefinitionBase,
  transport: Schema.Literal("http"),
  url: McpServerUrl,
  headers: McpHeaders.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type McpHttpServerDefinition = typeof McpHttpServerDefinition.Type;

export const McpServerDefinition = Schema.Union([
  McpStdioServerDefinition,
  McpSseServerDefinition,
  McpHttpServerDefinition,
]);
export type McpServerDefinition = typeof McpServerDefinition.Type;

export const McpSettings = Schema.Struct({
  servers: Schema.Array(McpServerDefinition).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type McpSettings = typeof McpSettings.Type;

export const McpProviderCapability = Schema.Literals([
  "unsupported",
  "sessionConfig",
  "nativeConfig",
]);
export type McpProviderCapability = typeof McpProviderCapability.Type;

export const McpProviderStatusState = Schema.Literals(["ready", "limited", "unsupported"]);
export type McpProviderStatusState = typeof McpProviderStatusState.Type;

export const McpProviderStatus = Schema.Struct({
  provider: ProviderDriverKind,
  instanceId: ProviderInstanceId,
  capability: McpProviderCapability,
  state: McpProviderStatusState,
  activeServerCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  message: Schema.optionalKey(TrimmedNonEmptyString),
});
export type McpProviderStatus = typeof McpProviderStatus.Type;

export const McpListInput = Schema.Struct({});
export type McpListInput = typeof McpListInput.Type;

export const McpListResult = Schema.Struct({
  servers: Schema.Array(McpServerDefinition),
});
export type McpListResult = typeof McpListResult.Type;

export const McpCreateInput = Schema.Struct({
  server: McpServerDefinition,
});
export type McpCreateInput = typeof McpCreateInput.Type;

export const McpServerUpdateDefinition = Schema.Union([
  Schema.Struct({
    ...McpStdioServerDefinition.fields,
    providerRouting: Schema.optionalKey(McpProviderRouting),
  }),
  Schema.Struct({
    ...McpSseServerDefinition.fields,
    providerRouting: Schema.optionalKey(McpProviderRouting),
  }),
  Schema.Struct({
    ...McpHttpServerDefinition.fields,
    providerRouting: Schema.optionalKey(McpProviderRouting),
  }),
]);
export type McpServerUpdateDefinition = typeof McpServerUpdateDefinition.Type;

export const McpUpdateInput = Schema.Struct({
  server: McpServerUpdateDefinition,
});
export type McpUpdateInput = typeof McpUpdateInput.Type;

export const McpDeleteInput = Schema.Struct({
  id: McpServerId,
});
export type McpDeleteInput = typeof McpDeleteInput.Type;

export const McpSetEnabledInput = Schema.Struct({
  id: McpServerId,
  enabled: Schema.Boolean,
});
export type McpSetEnabledInput = typeof McpSetEnabledInput.Type;

export const McpLiveApplyOutcome = Schema.Literals([
  "applied",
  "pending-next-session",
  "unsupported",
  "failed",
]);
export type McpLiveApplyOutcome = typeof McpLiveApplyOutcome.Type;

export const McpLiveApplyResult = Schema.Struct({
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  outcome: McpLiveApplyOutcome,
  message: Schema.optionalKey(TrimmedNonEmptyString),
});
export type McpLiveApplyResult = typeof McpLiveApplyResult.Type;

export const McpSetProviderEnabledInput = Schema.Struct({
  serverId: McpServerId,
  providerInstanceId: ProviderInstanceId,
  enabled: Schema.Boolean,
});
export type McpSetProviderEnabledInput = typeof McpSetProviderEnabledInput.Type;

export const McpMutationResult = Schema.Struct({
  servers: Schema.Array(McpServerDefinition),
  liveApplyResults: Schema.Array(McpLiveApplyResult).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type McpMutationResult = typeof McpMutationResult.Type;

export const McpSetProviderEnabledResult = McpMutationResult;
export type McpSetProviderEnabledResult = McpMutationResult;

export const McpImportCursorJsonInput = Schema.Struct({
  json: Schema.String,
  providerRouting: McpProviderRouting.pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultMcpProviderRouting)),
  ),
  scope: McpServerScope.pipe(Schema.withDecodingDefault(Effect.succeed("global" as const))),
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
  replace: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type McpImportCursorJsonInput = typeof McpImportCursorJsonInput.Type;

export const McpDiscoverImportSourcesInput = AgentImportSourcesInput;
export type McpDiscoverImportSourcesInput = typeof McpDiscoverImportSourcesInput.Type;

export const McpDiscoverImportSourcesResult = AgentImportSourcesResult;
export type McpDiscoverImportSourcesResult = typeof McpDiscoverImportSourcesResult.Type;

export const McpImportSourcesInput = Schema.Struct({
  sourceIds: Schema.Array(AgentImportSourceId),
  providerRouting: McpProviderRouting.pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultMcpProviderRouting)),
  ),
  scope: McpServerScope.pipe(Schema.withDecodingDefault(Effect.succeed("global" as const))),
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
  replace: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  deduplicate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type McpImportSourcesInput = typeof McpImportSourcesInput.Type;

export const McpExportCursorJsonInput = Schema.Struct({
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  scope: Schema.optionalKey(McpServerScope),
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
  includeDisabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type McpExportCursorJsonInput = typeof McpExportCursorJsonInput.Type;

export const McpCursorJsonResult = Schema.Struct({
  json: Schema.String,
  servers: Schema.Array(McpServerDefinition),
});
export type McpCursorJsonResult = typeof McpCursorJsonResult.Type;

export const McpProviderStatusInput = Schema.Struct({});
export type McpProviderStatusInput = typeof McpProviderStatusInput.Type;

export const McpProviderStatusResult = Schema.Struct({
  providers: Schema.Array(McpProviderStatus),
});
export type McpProviderStatusResult = typeof McpProviderStatusResult.Type;

export const McpRuntimeState = Schema.Literals([
  "not-started",
  "starting",
  "connected",
  "auth-required",
  "setup-required",
  "failed",
  "disabled",
  "unsupported",
  "unknown",
  "stale",
]);
export type McpRuntimeState = typeof McpRuntimeState.Type;

export const McpRuntimeSource = Schema.Literals(["t3-managed", "provider-native", "t3-built-in"]);
export type McpRuntimeSource = typeof McpRuntimeSource.Type;

export const McpRuntimeStatusSource = Schema.Literals([
  "provider-event",
  "provider-query",
  "internal-traffic",
  "configuration",
  "unknown",
]);
export type McpRuntimeStatusSource = typeof McpRuntimeStatusSource.Type;

export const McpRuntimeAuthState = Schema.Literals([
  "none",
  "authenticated",
  "required",
  "unsupported",
  "unknown",
]);
export type McpRuntimeAuthState = typeof McpRuntimeAuthState.Type;

export const McpRuntimeConfigDrift = Schema.Literals(["none", "pending-enable", "pending-disable"]);
export type McpRuntimeConfigDrift = typeof McpRuntimeConfigDrift.Type;

export const McpRuntimeAction = Schema.Literals(["refresh", "reconnect", "authorize"]);
export type McpRuntimeAction = typeof McpRuntimeAction.Type;

export const McpRuntimeServerKey = TrimmedNonEmptyString.check(Schema.isMaxLength(512)).pipe(
  Schema.brand("McpRuntimeServerKey"),
);
export type McpRuntimeServerKey = typeof McpRuntimeServerKey.Type;

export const McpRuntimeIssue = Schema.Struct({
  code: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(8_192)),
});
export type McpRuntimeIssue = typeof McpRuntimeIssue.Type;

export const McpRuntimeServerInfo = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  version: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
});
export type McpRuntimeServerInfo = typeof McpRuntimeServerInfo.Type;

export const McpRuntimeContextState = Schema.Literals(["active", "inactive"]);
export type McpRuntimeContextState = typeof McpRuntimeContextState.Type;

export const McpRuntimeContext = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
  threadTitle: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  state: McpRuntimeContextState,
  startedAt: Schema.optionalKey(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type McpRuntimeContext = typeof McpRuntimeContext.Type;

export const McpRuntimeServer = Schema.Struct({
  serverId: Schema.optionalKey(McpServerId),
  providerKey: McpRuntimeServerKey,
  source: McpRuntimeSource,
  providerInstanceId: ProviderInstanceId,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  name: McpServerName,
  transport: Schema.optionalKey(McpServerTransport),
  state: McpRuntimeState,
  statusSource: McpRuntimeStatusSource,
  observedAt: IsoDateTime,
  authState: McpRuntimeAuthState,
  availableActions: Schema.Array(McpRuntimeAction),
  reportsTools: Schema.Boolean,
  serverInfo: Schema.optionalKey(McpRuntimeServerInfo),
  toolCount: Schema.optionalKey(NonNegativeInt),
  resourceCount: Schema.optionalKey(NonNegativeInt),
  templateCount: Schema.optionalKey(NonNegativeInt),
  issue: Schema.optionalKey(McpRuntimeIssue),
  configDrift: McpRuntimeConfigDrift,
});
export type McpRuntimeServer = typeof McpRuntimeServer.Type;

export const McpRuntimeTool = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(65_536))),
  readOnly: Schema.optionalKey(Schema.Boolean),
  destructive: Schema.optionalKey(Schema.Boolean),
  openWorld: Schema.optionalKey(Schema.Boolean),
});
export type McpRuntimeTool = typeof McpRuntimeTool.Type;

export const McpRuntimeResource = Schema.Struct({
  uri: TrimmedNonEmptyString.check(Schema.isMaxLength(8_192)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(65_536))),
  mimeType: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  size: Schema.optionalKey(NonNegativeInt),
});
export type McpRuntimeResource = typeof McpRuntimeResource.Type;

export const McpRuntimeResourceTemplate = Schema.Struct({
  uriTemplate: TrimmedNonEmptyString.check(Schema.isMaxLength(8_192)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(65_536))),
  mimeType: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
});
export type McpRuntimeResourceTemplate = typeof McpRuntimeResourceTemplate.Type;

export const McpRuntimeContextsInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
});
export type McpRuntimeContextsInput = typeof McpRuntimeContextsInput.Type;

export const McpRuntimeContextsResult = Schema.Struct({
  contexts: Schema.Array(McpRuntimeContext),
});
export type McpRuntimeContextsResult = typeof McpRuntimeContextsResult.Type;

export const McpRuntimeContextChangesInput = McpRuntimeContextsInput;
export type McpRuntimeContextChangesInput = typeof McpRuntimeContextChangesInput.Type;

export const McpRuntimeContextSnapshot = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  revision: NonNegativeInt,
  observedAt: IsoDateTime,
  contexts: Schema.Array(McpRuntimeContext),
});
export type McpRuntimeContextSnapshot = typeof McpRuntimeContextSnapshot.Type;

export const McpRuntimeContextChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: McpRuntimeContextSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("context-upserted"),
    revision: NonNegativeInt,
    observedAt: IsoDateTime,
    context: McpRuntimeContext,
  }),
  Schema.Struct({
    type: Schema.Literal("context-removed"),
    revision: NonNegativeInt,
    observedAt: IsoDateTime,
    threadId: ThreadId,
    runtimeSessionId: RuntimeSessionId,
  }),
]);
export type McpRuntimeContextChange = typeof McpRuntimeContextChange.Type;

export const McpRuntimeSnapshotInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
});
export type McpRuntimeSnapshotInput = typeof McpRuntimeSnapshotInput.Type;

export const McpRuntimeSnapshot = Schema.Struct({
  context: McpRuntimeContext,
  revision: NonNegativeInt,
  observedAt: IsoDateTime,
  servers: Schema.Array(McpRuntimeServer),
});
export type McpRuntimeSnapshot = typeof McpRuntimeSnapshot.Type;

export const McpRuntimeChangesInput = McpRuntimeSnapshotInput;
export type McpRuntimeChangesInput = typeof McpRuntimeChangesInput.Type;

export const McpRuntimeChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: McpRuntimeSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("server-upserted"),
    revision: NonNegativeInt,
    observedAt: IsoDateTime,
    server: McpRuntimeServer,
  }),
  Schema.Struct({
    type: Schema.Literal("server-removed"),
    revision: NonNegativeInt,
    observedAt: IsoDateTime,
    providerKey: McpRuntimeServerKey,
  }),
]);
export type McpRuntimeChange = typeof McpRuntimeChange.Type;

export const McpRuntimeServerDetailsInput = Schema.Struct({
  ...McpRuntimeSnapshotInput.fields,
  providerKey: McpRuntimeServerKey,
});
export type McpRuntimeServerDetailsInput = typeof McpRuntimeServerDetailsInput.Type;

export const McpRuntimeServerDetailsResult = Schema.Struct({
  server: McpRuntimeServer,
  tools: Schema.Array(McpRuntimeTool),
  resources: Schema.Array(McpRuntimeResource).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  templates: Schema.Array(McpRuntimeResourceTemplate).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type McpRuntimeServerDetailsResult = typeof McpRuntimeServerDetailsResult.Type;

export const McpRuntimeActionInput = Schema.Struct({
  ...McpRuntimeSnapshotInput.fields,
  providerKey: McpRuntimeServerKey,
  action: McpRuntimeAction,
});
export type McpRuntimeActionInput = typeof McpRuntimeActionInput.Type;

export const McpRuntimeActionResult = Schema.Struct({
  accepted: Schema.Boolean,
  action: McpRuntimeAction,
  providerKey: McpRuntimeServerKey,
  authorizationUrl: Schema.optionalKey(McpServerUrl),
  message: Schema.optionalKey(TrimmedNonEmptyString),
});
export type McpRuntimeActionResult = typeof McpRuntimeActionResult.Type;

export const McpRuntimeErrorCode = Schema.Literals([
  "context-not-found",
  "server-not-found",
  "session-replaced",
  "action-unsupported",
  "authorization-unavailable",
  "provider-error",
]);
export type McpRuntimeErrorCode = typeof McpRuntimeErrorCode.Type;

export class McpRuntimeError extends Schema.TaggedErrorClass<McpRuntimeError>()("McpRuntimeError", {
  code: McpRuntimeErrorCode,
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `MCP runtime error: ${this.detail}`;
  }
}

export class McpConfigError extends Schema.TaggedErrorClass<McpConfigError>()("McpConfigError", {
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `MCP configuration error: ${this.detail}`;
  }
}
