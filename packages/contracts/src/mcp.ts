import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AgentImportSourceId,
  AgentImportSourcesInput,
  AgentImportSourcesResult,
} from "./agentImport.ts";
import { ProjectId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
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

export const McpUpdateInput = Schema.Struct({
  server: McpServerDefinition,
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

export const McpMutationResult = McpListResult;
export type McpMutationResult = McpListResult;

export const McpImportCursorJsonInput = Schema.Struct({
  json: Schema.String,
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
  scope: McpServerScope.pipe(Schema.withDecodingDefault(Effect.succeed("global" as const))),
  projectId: Schema.optionalKey(ProjectId),
  projectCwd: Schema.optionalKey(TrimmedNonEmptyString),
  replace: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  deduplicate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type McpImportSourcesInput = typeof McpImportSourcesInput.Type;

export const McpExportCursorJsonInput = Schema.Struct({
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

export class McpConfigError extends Schema.TaggedErrorClass<McpConfigError>()("McpConfigError", {
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `MCP configuration error: ${this.detail}`;
  }
}
