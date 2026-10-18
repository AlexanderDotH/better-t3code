import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";

const FRONTMATTER_BOUNDARY = "---";
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export interface ParsedSkillFile {
  readonly name: string | null;
  readonly description: string | null;
  readonly displayName: string | null;
  readonly shortDescription: string | null;
  readonly body: string;
}

export interface SkillFileMetadata {
  readonly name: string;
  readonly description: string;
  readonly displayName?: string | undefined;
  readonly shortDescription?: string | undefined;
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name) && name !== "." && name !== "..";
}

const SkillMetadata = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  shortDescription: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        "display-name": Schema.optional(Schema.String),
        "short-description": Schema.optional(Schema.String),
      }),
    ),
  ),
});
const decodeSkillMetadata = Schema.decodeUnknownResult(SkillMetadata);

function readFrontmatter(contents: string): {
  readonly frontmatter: string | null;
  readonly body: string;
} {
  const normalized = contents.replaceAll("\r\n", "\n");
  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    return { frontmatter: null, body: normalized };
  }

  const endIndex = normalized.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, 4);
  if (endIndex === -1) {
    return { frontmatter: null, body: normalized };
  }

  return {
    frontmatter: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + FRONTMATTER_BOUNDARY.length + 2).replace(/^\n/, ""),
  };
}

export function parseSkillFile(contents: string): ParsedSkillFile {
  const { frontmatter, body } = readFrontmatter(contents);
  let metadata: typeof SkillMetadata.Type = {};
  if (frontmatter) {
    try {
      const decoded = decodeSkillMetadata(parseYaml(frontmatter, { maxAliasCount: 10 }));
      if (Result.isSuccess(decoded)) metadata = decoded.success;
    } catch {
      // Invalid community metadata must not make the instruction body unreadable.
    }
  }
  return {
    name: metadata.name ?? null,
    description: metadata.description ?? null,
    displayName: metadata.displayName ?? metadata.metadata?.["display-name"] ?? null,
    shortDescription: metadata.shortDescription ?? metadata.metadata?.["short-description"] ?? null,
    body,
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function serializeSkillFile(metadata: SkillFileMetadata, body: string): string {
  const lines = [
    FRONTMATTER_BOUNDARY,
    `name: ${yamlString(metadata.name)}`,
    `description: ${yamlString(metadata.description)}`,
  ];
  if (metadata.displayName || metadata.shortDescription) {
    lines.push("metadata:");
    if (metadata.displayName) {
      lines.push(`  display-name: ${yamlString(metadata.displayName)}`);
    }
    if (metadata.shortDescription) {
      lines.push(`  short-description: ${yamlString(metadata.shortDescription)}`);
    }
  }
  lines.push(FRONTMATTER_BOUNDARY);

  const normalizedBody = body.replaceAll("\r\n", "\n");
  return `${lines.join("\n")}\n\n${normalizedBody.replace(/^\n+/, "")}`;
}
