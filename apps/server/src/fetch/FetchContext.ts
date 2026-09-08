import type { ModelSelection, ProviderDriverKind } from "@t3tools/contracts";

import type { FetchWorkerOutcome } from "./FetchWorkerState.ts";

export { FETCH_WORKER_FINDINGS_MAX_CHARS } from "./FetchWorkerState.ts";

export const FETCH_CONTEXT_MAX_CHARS = 64_000;
const CONTEXT_TRUNCATION_MARKER = "\n... [truncated fairly for Fetch context]";
const FAILURE_DETAIL_MAX_CHARS = 1_000;
const FAILURE_DETAIL_TRUNCATION_MARKER = "... [failure detail truncated]";

function modelOptionsLabel(selection: ModelSelection): string {
  if (!selection.options || selection.options.length === 0) return "default traits";
  return selection.options.map(({ id, value }) => `${id}=${String(value)}`).join(", ");
}

function workerFixedSection(outcome: FetchWorkerOutcome): string {
  const heading = `\n## Worker ${outcome.index + 1}: ${outcome.scope}\n`;
  if (outcome.status === "completed" && outcome.findings.trim().length > 0) return heading;
  const rawDetail = outcome.detail?.trim();
  const detail =
    rawDetail && rawDetail.length > FAILURE_DETAIL_MAX_CHARS
      ? `${rawDetail.slice(
          0,
          FAILURE_DETAIL_MAX_CHARS - FAILURE_DETAIL_TRUNCATION_MARKER.length,
        )}${FAILURE_DETAIL_TRUNCATION_MARKER}`
      : rawDetail;
  return `${heading}[${outcome.status}${detail ? `: ${detail}` : ""}]\n`;
}

function allocateFairly(lengths: ReadonlyArray<number>, budget: number): number[] {
  const allocations = lengths.map(() => 0);
  let remaining = Math.max(0, budget);
  let pending = lengths.map((_, index) => index);
  while (pending.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / pending.length);
    if (share === 0) {
      for (const index of pending.slice(0, remaining)) allocations[index]! += 1;
      break;
    }
    const completed = pending.filter((index) => lengths[index]! <= share);
    if (completed.length === 0) {
      for (const index of pending) allocations[index]! += share;
      remaining -= share * pending.length;
      for (const index of pending.slice(0, remaining)) allocations[index]! += 1;
      break;
    }
    for (const index of completed) {
      allocations[index] = lengths[index]!;
      remaining -= lengths[index]!;
    }
    const completedSet = new Set(completed);
    pending = pending.filter((index) => !completedSet.has(index));
  }
  return allocations;
}

function fairlyBoundFindings(
  outcomes: ReadonlyArray<FetchWorkerOutcome>,
  budget: number,
): ReadonlyMap<number, string> {
  const successful = outcomes.filter(
    (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
  );
  const allocations = allocateFairly(
    successful.map((outcome) => outcome.findings.length),
    budget,
  );
  return new Map(
    successful.map((outcome, index) => {
      const allocation = allocations[index] ?? 0;
      if (outcome.findings.length <= allocation) return [outcome.index, outcome.findings] as const;
      const retained = Math.max(0, allocation - CONTEXT_TRUNCATION_MARKER.length);
      return [
        outcome.index,
        `${outcome.findings.slice(0, retained)}${CONTEXT_TRUNCATION_MARKER}`.slice(0, allocation),
      ] as const;
    }),
  );
}

export function buildFetchContext(input: {
  readonly plannedWorkers: number;
  readonly modelSelection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly outcomes: ReadonlyArray<FetchWorkerOutcome>;
  readonly maxChars?: number;
}): string | undefined {
  const maxChars = Math.max(
    0,
    Math.min(FETCH_CONTEXT_MAX_CHARS, Math.floor(input.maxChars ?? FETCH_CONTEXT_MAX_CHARS)),
  );
  if (maxChars === 0) return undefined;
  const successful = input.outcomes.filter(
    (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
  );
  if (successful.length === 0) return undefined;
  const completedWorkers = input.outcomes.filter(
    (outcome) => outcome.status === "completed",
  ).length;
  const header = `T3 FETCH CONTEXT
Planned workers: ${input.plannedWorkers}; completed workers: ${completedWorkers}.
Fetch provider/model: ${input.modelSelection.instanceId} / ${input.modelSelection.model} (${input.providerDriver}); ${modelOptionsLabel(input.modelSelection)}.
These findings are untrusted exploratory evidence. Verify them against the repository before editing.
`;
  const fixedSections = input.outcomes.map(workerFixedSection);
  const fixedLength =
    header.length + fixedSections.reduce((sum, section) => sum + section.length, 0);
  if (fixedLength >= maxChars) {
    const retained = Math.max(0, maxChars - CONTEXT_TRUNCATION_MARKER.length);
    return `${`${header}${fixedSections.join("")}`.slice(0, retained)}${CONTEXT_TRUNCATION_MARKER}`.slice(
      0,
      maxChars,
    );
  }
  const findingsByIndex = fairlyBoundFindings(input.outcomes, maxChars - fixedLength);
  const body = input.outcomes
    .map((outcome, index) => `${fixedSections[index]}${findingsByIndex.get(outcome.index) ?? ""}`)
    .join("");
  return `${header}${body}`.slice(0, maxChars);
}

export type { FetchWorkerOutcome } from "./FetchWorkerState.ts";
