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

function parseScalar(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

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
  const metadata = new Map<string, string>();
  const nestedMetadata = new Map<string, string>();
  let section: string | null = null;

  if (frontmatter) {
    for (const line of frontmatter.split("\n")) {
      if (!line.trim() || line.trimStart().startsWith("#")) {
        continue;
      }

      const nestedMatch = /^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (nestedMatch && section === "metadata") {
        nestedMetadata.set(nestedMatch[1]!, parseScalar(nestedMatch[2] ?? ""));
        continue;
      }

      section = null;
      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!match) {
        continue;
      }

      const key = match[1]!;
      const rawValue = match[2] ?? "";
      if (rawValue.trim().length === 0) {
        section = key;
        continue;
      }
      metadata.set(key, parseScalar(rawValue));
    }
  }

  return {
    name: metadata.get("name") ?? null,
    description: metadata.get("description") ?? null,
    displayName: metadata.get("displayName") ?? nestedMetadata.get("display-name") ?? null,
    shortDescription:
      metadata.get("shortDescription") ?? nestedMetadata.get("short-description") ?? null,
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
