import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SkillMutationScope } from "./skills.ts";

export const ExtensionCatalogSearchInput = Schema.Struct({
  kind: Schema.Literals(["mcp", "skill"]),
  query: Schema.String.check(Schema.isMaxLength(200)),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
});
export type ExtensionCatalogSearchInput = typeof ExtensionCatalogSearchInput.Type;

export const CatalogInput = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  description: Schema.String,
  required: Schema.Boolean,
  secret: Schema.Boolean,
  defaultValue: Schema.String,
});
export type CatalogInput = typeof CatalogInput.Type;

export const CatalogMcpConnection = Schema.Struct({
  label: Schema.String,
  transport: Schema.Literals(["stdio", "http", "sse"]),
  command: Schema.String,
  args: Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String), value: Schema.String })),
  url: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  inputs: Schema.Array(CatalogInput),
});
export type CatalogMcpConnection = typeof CatalogMcpConnection.Type;

export const ExtensionCatalogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["mcp", "skill"]),
  name: Schema.String,
  description: Schema.String,
  source: Schema.String,
  sourceUrl: Schema.String,
  version: Schema.optional(Schema.String),
  installs: Schema.optional(Schema.Number),
  connections: Schema.Array(CatalogMcpConnection),
});
export type ExtensionCatalogEntry = typeof ExtensionCatalogEntry.Type;

export const ExtensionCatalogSearchResult = Schema.Struct({
  entries: Schema.Array(ExtensionCatalogEntry),
  nextCursor: Schema.optional(Schema.String),
});
export type ExtensionCatalogSearchResult = typeof ExtensionCatalogSearchResult.Type;

export const SkillRegistrySource = Schema.String.check(
  Schema.isPattern(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/,
  ),
  Schema.isMaxLength(300),
);
export const SkillRegistryPreviewInput = Schema.Struct({ source: SkillRegistrySource });
export type SkillRegistryPreviewInput = typeof SkillRegistryPreviewInput.Type;
export const SkillRegistryPreviewResult = Schema.Struct({
  source: SkillRegistrySource,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  body: Schema.String,
  fileCount: Schema.Int,
  contentHash: Schema.String,
});
export type SkillRegistryPreviewResult = typeof SkillRegistryPreviewResult.Type;
export const SkillRegistryInstallInput = Schema.Struct({
  source: SkillRegistrySource,
  contentHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  scope: SkillMutationScope,
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type SkillRegistryInstallInput = typeof SkillRegistryInstallInput.Type;
