import {
  ProjectMemoryEntry as ProjectMemoryEntrySchema,
  type ProjectMemoryEntry,
  type ProjectMemorySection,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { redactKnowledgeGraphEvidenceExcerpt } from "../knowledge-graph/extraction/KnowledgeGraphSecretRedaction.ts";

const sections: ReadonlyArray<readonly [ProjectMemorySection, string]> = [
  ["project-profile", "Project profile"],
  ["active-decisions", "Active decisions"],
  ["verified-workflows", "Verified workflows"],
  ["known-pitfalls", "Known pitfalls"],
  ["recent-outcomes", "Recent outcomes"],
];

const sectionByHeading = new Map(sections.map(([section, heading]) => [heading, section]));
const sectionOrder = new Map(sections.map(([section], index) => [section, index]));
const decodeEntry = Schema.decodeUnknownOption(ProjectMemoryEntrySchema);
const minimumRelevance = 40;
const commonQueryTokens = new Set([
  "aber",
  "als",
  "am",
  "an",
  "and",
  "are",
  "arbeit",
  "auf",
  "aus",
  "bei",
  "bin",
  "bitte",
  "but",
  "can",
  "continue",
  "could",
  "das",
  "dem",
  "den",
  "der",
  "des",
  "did",
  "die",
  "do",
  "does",
  "doing",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "for",
  "from",
  "fortfahren",
  "für",
  "had",
  "has",
  "have",
  "how",
  "ich",
  "if",
  "im",
  "in",
  "into",
  "is",
  "ist",
  "its",
  "keep",
  "going",
  "mach",
  "machen",
  "may",
  "mit",
  "my",
  "nach",
  "next",
  "nächste",
  "nächsten",
  "nächstes",
  "oder",
  "of",
  "on",
  "or",
  "our",
  "please",
  "proceed",
  "project",
  "run",
  "sein",
  "should",
  "so",
  "sollen",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "tun",
  "und",
  "uns",
  "up",
  "us",
  "von",
  "vor",
  "was",
  "we",
  "weiter",
  "werden",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "wie",
  "will",
  "wir",
  "with",
  "wo",
  "work",
  "working",
  "would",
  "you",
  "your",
  "zu",
  "zum",
  "zur",
]);

export function sanitizeProjectMemoryContent(content: string): string {
  return redactKnowledgeGraphEvidenceExcerpt(content).trim();
}

function quotedContent(content: string): string {
  return content
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function sortedEntries(
  entries: ReadonlyArray<ProjectMemoryEntry>,
): ReadonlyArray<ProjectMemoryEntry> {
  return [...entries].sort(
    (left, right) =>
      (sectionOrder.get(left.section) ?? 0) - (sectionOrder.get(right.section) ?? 0) ||
      left.key.localeCompare(right.key),
  );
}

export function serializeProjectMemoryDocument(entries: ReadonlyArray<ProjectMemoryEntry>): string {
  const ordered = sortedEntries(entries);
  const lines = [
    "# Project memory",
    "",
    "Project-owned facts maintained by T3 Code. Entries use stable keys for exact updates.",
    "",
  ];
  for (const [section, heading] of sections) {
    lines.push(`## ${heading}`, "");
    for (const entry of ordered.filter((candidate) => candidate.section === section)) {
      lines.push(
        `### \`${entry.key}\``,
        "",
        `- Verified: ${entry.verified ? "yes" : "no"}`,
        `- Source thread: \`${entry.sourceThreadId}\``,
      );
      if (entry.checkpointRef !== undefined) {
        lines.push(`- Checkpoint: \`${entry.checkpointRef}\``);
      }
      lines.push("", quotedContent(entry.content), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function contentFromLines(lines: ReadonlyArray<string>): string {
  return lines
    .map((line) => (line === ">" ? "" : line.startsWith("> ") ? line.slice(2) : line))
    .join("\n")
    .trim();
}

export function parseProjectMemoryDocument(markdown: string): ReadonlyArray<ProjectMemoryEntry> {
  const lines = markdown.split(/\r?\n/);
  const entries: ProjectMemoryEntry[] = [];
  let section: ProjectMemorySection | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = /^## (.+)$/.exec(lines[index] ?? "");
    if (sectionMatch) {
      section = sectionByHeading.get(sectionMatch[1] ?? "");
      continue;
    }
    const entryMatch = /^### `([^`]+)`$/.exec(lines[index] ?? "");
    if (!entryMatch || section === undefined) continue;

    const body: string[] = [];
    while (index + 1 < lines.length && !/^#{2,3} /.test(lines[index + 1] ?? "")) {
      body.push(lines[(index += 1)] ?? "");
    }
    const verified = body.find((line) => line.startsWith("- Verified: "))?.slice(12) === "yes";
    const sourceThreadId = /^- Source thread: `([^`]+)`$/m.exec(body.join("\n"))?.[1];
    const checkpointRef = /^- Checkpoint: `([^`]+)`$/m.exec(body.join("\n"))?.[1];
    const firstContentLine = body.findIndex((line) => line === ">" || line.startsWith("> "));
    const decoded = decodeEntry({
      section,
      key: entryMatch[1],
      content: contentFromLines(firstContentLine < 0 ? [] : body.slice(firstContentLine)),
      verified,
      sourceThreadId,
      ...(checkpointRef === undefined ? {} : { checkpointRef }),
    });
    if (Option.isSome(decoded)) entries.push(decoded.value);
  }
  return entries;
}

export function upsertProjectMemoryEntry(
  entries: ReadonlyArray<ProjectMemoryEntry>,
  entry: ProjectMemoryEntry,
): { readonly entries: ReadonlyArray<ProjectMemoryEntry>; readonly replaced: boolean } {
  const first = entries.findIndex((candidate) => candidate.key === entry.key);
  const next = entries.filter((candidate) => candidate.key !== entry.key);
  next.splice(first < 0 ? next.length : first, 0, entry);
  return { entries: next, replaced: first >= 0 };
}

export function projectMemoryTokenBudget(contextWindowTokens: number): number {
  return Math.min(4_000, Math.max(1_000, Math.floor(contextWindowTokens * 0.02)));
}

function searchTokens(value: string): ReadonlyArray<string> {
  const original = value.toLowerCase().match(/[\p{L}\p{N}_.:/-]+/gu) ?? [];
  const expanded =
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}_.:/-]+/gu) ?? [];
  return [
    ...new Set(
      [...original, ...expanded].flatMap((token) => [
        token,
        ...token.split(/[_.:/-]+/).filter(Boolean),
      ]),
    ),
  ];
}

function searchWords(value: string): ReadonlyArray<string> {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function relevance(
  entry: ProjectMemoryEntry,
  query: string,
  queryTokens: ReadonlyArray<string>,
  frequentTokens: ReadonlySet<string>,
): number {
  const key = entry.key.toLowerCase();
  if (query.toLowerCase() === key || queryTokens.includes(key)) return 1_000;

  const keyTokens = new Set(searchTokens(entry.key));
  const contentTokens = new Set(searchTokens(entry.content));
  let score = queryTokens.reduce((total, token) => {
    const structured = /[_.:/-]/u.test(token);
    if (!structured && frequentTokens.has(token)) return total;
    if (keyTokens.has(token)) return total + (structured ? 200 : 80);
    if (contentTokens.has(token)) return total + (structured ? 160 : 40);
    return total;
  }, 0);

  const queryWords = searchWords(query).filter(
    (token) => token.length >= 3 && !commonQueryTokens.has(token),
  );
  if (
    queryWords.length >= 2 &&
    queryWords.some((token) => !frequentTokens.has(token)) &&
    searchWords(`${entry.key} ${entry.content}`).join(" ").includes(queryWords.join(" "))
  ) {
    score += 160;
  }
  return score;
}

function estimateTokens(markdown: string): number {
  return Math.ceil(markdown.length / 4);
}

function fitEntry(
  selected: ReadonlyArray<ProjectMemoryEntry>,
  entry: ProjectMemoryEntry,
  tokenBudget: number,
): ProjectMemoryEntry | undefined {
  let low = 0;
  let high = entry.content.length;
  let best: ProjectMemoryEntry | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const content = `${entry.content.slice(0, middle).trimEnd()}\n[truncated]`.trim();
    const candidate = { ...entry, content };
    if (estimateTokens(serializeProjectMemoryDocument([...selected, candidate])) <= tokenBudget) {
      best = candidate;
      low = middle + 1;
      continue;
    }
    high = middle - 1;
  }
  return best;
}

export function selectProjectMemoryEntries(
  entries: ReadonlyArray<ProjectMemoryEntry>,
  query: string,
  contextWindowTokens: number,
): {
  readonly entries: ReadonlyArray<ProjectMemoryEntry>;
  readonly markdown: string;
  readonly tokenBudget: number;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
} {
  const tokenBudget = projectMemoryTokenBudget(contextWindowTokens);
  const queryValue = query.trim();
  const tokenFrequency = new Map<string, number>();
  for (const entry of entries) {
    for (const token of new Set(searchTokens(`${entry.key} ${entry.content}`))) {
      tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
  }
  const frequentTokens = new Set(
    [...tokenFrequency]
      .filter(([, frequency]) => frequency > 1 && frequency / entries.length >= 0.5)
      .map(([token]) => token),
  );
  const queryTokens = searchTokens(queryValue).filter(
    (token) => token.length >= 3 && (!commonQueryTokens.has(token) || /[_.:/-]/u.test(token)),
  );
  const ranked = entries
    .map((entry) => ({ entry, score: relevance(entry, queryValue, queryTokens, frequentTokens) }))
    .filter(({ score }) => score >= minimumRelevance)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (sectionOrder.get(left.entry.section) ?? 0) -
          (sectionOrder.get(right.entry.section) ?? 0) ||
        left.entry.key.localeCompare(right.entry.key),
    );
  const selected: ProjectMemoryEntry[] = [];
  let contentTruncated = false;
  for (const { entry } of ranked) {
    const complete = serializeProjectMemoryDocument([...selected, entry]);
    if (estimateTokens(complete) <= tokenBudget) {
      selected.push(entry);
      continue;
    }
    const fitted = fitEntry(selected, entry, tokenBudget);
    if (fitted) selected.push(fitted);
    contentTruncated = true;
    break;
  }
  const markdown = serializeProjectMemoryDocument(selected);
  return {
    entries: selected,
    markdown,
    tokenBudget,
    estimatedTokens: estimateTokens(markdown),
    truncated: contentTruncated || selected.length < ranked.length,
  };
}
