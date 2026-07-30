import type { ServerProvider } from "@t3tools/contracts";

export type PlanSubagentCount = 2 | 3 | 4;

export type PlanImplementationStrategy =
  | { readonly kind: "standard" }
  | { readonly kind: "subagents"; readonly count: PlanSubagentCount };

export interface PlanImplementationSuggestion {
  readonly strategy: Extract<PlanImplementationStrategy, { readonly kind: "subagents" }>;
  readonly supportedCounts: ReadonlyArray<PlanSubagentCount>;
}

export interface BuildPlanImplementationPromptOptions {
  readonly strategy: PlanImplementationStrategy;
  readonly provider?: ServerProvider;
}

const PLAN_SUBAGENT_COUNTS = [2, 3, 4] as const satisfies ReadonlyArray<PlanSubagentCount>;
const EXCLUDED_SECTION_TITLES = new Set([
  "summary",
  "assumptions",
  "defaults",
  "non goals",
  "out of scope",
]);

interface MarkdownFence {
  readonly marker: "`" | "~";
  readonly length: number;
}

function parseFenceOpening(line: string): MarkdownFence | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  const fence = match?.[1];
  if (!fence) {
    return null;
  }

  const marker = fence[0];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  return { marker, length: fence.length };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) {
    return false;
  }
  if ([...trimmed].some((character) => character !== fence.marker)) {
    return false;
  }
  return line.length - line.trimStart().length <= 3;
}

function normalizeSectionTitle(title: string): string {
  return title
    .replace(/\s+#+\s*$/, "")
    .replace(/[*_`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-–—_]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseHeading(line: string): { readonly level: number; readonly title: string } | null {
  const match = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
  const marker = match?.[1];
  const title = match?.[2];
  if (!marker || !title) {
    return null;
  }

  return {
    level: marker.length,
    title: normalizeSectionTitle(title),
  };
}

function listItemIndent(line: string): number | null {
  const match = line.match(/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?\S/);
  const indentation = match?.[1];
  if (indentation === undefined) {
    return null;
  }
  return [...indentation].reduce((width, character) => width + (character === "\t" ? 4 : 1), 0);
}

export function estimatePlanImplementationWorkUnits(planMarkdown: string): number {
  let eligibleHeadingCount = 0;
  let topLevelListItemCount = 0;
  let excludedSectionLevel: number | null = null;
  let activeListIndent: number | null = null;
  let fence: MarkdownFence | null = null;

  for (const line of planMarkdown.split(/\r?\n/)) {
    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
        activeListIndent = null;
      }
      continue;
    }

    fence = parseFenceOpening(line);
    if (fence) {
      activeListIndent = null;
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      activeListIndent = null;
      if (excludedSectionLevel !== null && heading.level > excludedSectionLevel) {
        continue;
      }

      excludedSectionLevel = null;
      if (EXCLUDED_SECTION_TITLES.has(heading.title)) {
        excludedSectionLevel = heading.level;
        continue;
      }
      if (heading.level === 2 || heading.level === 3) {
        eligibleHeadingCount += 1;
      }
      continue;
    }

    if (excludedSectionLevel !== null) {
      continue;
    }

    const indent = listItemIndent(line);
    if (indent === null) {
      if (line.trim().length > 0) {
        activeListIndent = null;
      }
      continue;
    }

    if (activeListIndent === null || indent < activeListIndent) {
      activeListIndent = indent;
      topLevelListItemCount += 1;
      continue;
    }
    if (indent === activeListIndent) {
      topLevelListItemCount += 1;
    }
  }

  return Math.max(1, eligibleHeadingCount, topLevelListItemCount);
}

function planSubagentCeiling(
  provider: ServerProvider | null | undefined,
): PlanSubagentCount | null {
  if (!provider?.enabled || !provider.installed || provider.availability === "unavailable") {
    return null;
  }

  const capability = provider.nativeSubagents;
  if (!capability || capability.toolName.trim().length === 0) {
    return null;
  }

  const ceiling = Math.min(4, Math.floor(capability.maxRecommendedSubagents));
  if (ceiling < 2) {
    return null;
  }

  return ceiling as PlanSubagentCount;
}

export function getSupportedPlanSubagentCounts(
  provider: ServerProvider | null | undefined,
): ReadonlyArray<PlanSubagentCount> {
  const ceiling = planSubagentCeiling(provider);
  if (ceiling === null) {
    return [];
  }
  return PLAN_SUBAGENT_COUNTS.filter((count) => count <= ceiling);
}

export function resolvePlanImplementationSuggestion(input: {
  readonly featureEnabled: boolean;
  readonly planMarkdown: string;
  readonly provider: ServerProvider | null | undefined;
}): PlanImplementationSuggestion | null {
  if (!input.featureEnabled) {
    return null;
  }

  const supportedCounts = getSupportedPlanSubagentCounts(input.provider);
  const ceiling = supportedCounts.at(-1);
  if (ceiling === undefined) {
    return null;
  }

  const workUnitCount = estimatePlanImplementationWorkUnits(input.planMarkdown);
  const count = Math.max(2, Math.min(workUnitCount, ceiling)) as PlanSubagentCount;
  return {
    strategy: { kind: "subagents", count },
    supportedCounts,
  };
}

function buildStandardPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`;
}

function buildSubagentPlanImplementationPrompt(input: {
  readonly planMarkdown: string;
  readonly count: PlanSubagentCount;
  readonly toolName: string;
}): string {
  const { count, toolName } = input;
  return `PLEASE IMPLEMENT THIS COMPLETE PLAN USING EXACTLY ${count} SUBAGENTS.

EXECUTION CONTRACT:
- Before modifying files, decompose the complete plan into exactly ${count} concrete, non-overlapping workstreams.
- Use the provider's native \`${toolName}\` tool to spawn exactly ${count} direct child subagents in one parallel batch. Do not spawn fewer or more.
- Give every subagent meaningful implementation or verification work and explicit ownership. Do not create dummy or duplicate tasks.
- Subagents must not spawn additional agents.
- The parent agent owns shared-file integration, conflict resolution, unfinished work, and final verification.
- Wait for every subagent, use their results, integrate the complete plan, and run every specified acceptance check.
- Do not report completion while any plan item remains unfinished.
- If \`${toolName}\` is unavailable or exactly ${count} subagents cannot be started, STOP before modifying files and report the blocker. Do not silently fall back to serial implementation.

PLAN:
${input.planMarkdown.trim()}`;
}

export function buildPlanImplementationPrompt(
  planMarkdown: string,
  options?: BuildPlanImplementationPromptOptions,
): string {
  const strategy = options?.strategy ?? { kind: "standard" };
  if (strategy.kind === "standard") {
    return buildStandardPlanImplementationPrompt(planMarkdown);
  }

  const capability = options?.provider?.nativeSubagents;
  if (!capability) {
    throw new Error("Selected provider does not support native subagents");
  }

  const supportedCounts = getSupportedPlanSubagentCounts(options.provider);
  if (!supportedCounts.includes(strategy.count)) {
    const ceiling = supportedCounts.at(-1);
    if (ceiling !== undefined) {
      throw new Error(`Selected provider supports at most ${ceiling} subagents`);
    }
    throw new Error("Selected provider does not support native subagents");
  }

  return buildSubagentPlanImplementationPrompt({
    planMarkdown,
    count: strategy.count,
    toolName: capability.toolName,
  });
}
