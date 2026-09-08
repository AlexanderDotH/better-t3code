import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const AgentImportTool = Schema.Literals(["codex", "cursor", "claude", "opencode"]);
export type AgentImportTool = typeof AgentImportTool.Type;

export const AgentImportSourceId = TrimmedNonEmptyString;
export type AgentImportSourceId = typeof AgentImportSourceId.Type;

export const AgentImportSource = Schema.Struct({
  id: AgentImportSourceId,
  tool: AgentImportTool,
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  mcpServerCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  skillCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mcpConfigPaths: Schema.Array(TrimmedNonEmptyString),
  skillPaths: Schema.Array(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedString),
});
export type AgentImportSource = typeof AgentImportSource.Type;

export const AgentImportSourcesInput = Schema.Struct({});
export type AgentImportSourcesInput = typeof AgentImportSourcesInput.Type;

export const AgentImportSourcesResult = Schema.Struct({
  sources: Schema.Array(AgentImportSource),
});
export type AgentImportSourcesResult = typeof AgentImportSourcesResult.Type;
