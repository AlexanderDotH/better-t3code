import type { ProjectCallsiteV1, ProjectEntityV1, ProjectSourceFileV1 } from "@t3tools/contracts";

import { type ExtractionGap, coverageGap } from "./inventory.ts";

export interface SemanticInput {
  root: string;
  files: readonly ProjectSourceFileV1[];
  entities: readonly ProjectEntityV1[];
  callsites: readonly ProjectCallsiteV1[];
  signal?: AbortSignal;
}

export interface SemanticResult {
  callsites: ProjectCallsiteV1[];
  gaps: ExtractionGap[];
}

export function groupByFile<Value extends { filePath: string }>(
  values: readonly Value[],
): Map<string, Value[]> {
  const groups = new Map<string, Value[]>();
  for (const value of values) {
    const group = groups.get(value.filePath);
    if (group) group.push(value);
    else groups.set(value.filePath, [value]);
  }
  return groups;
}

export function declarationTarget(
  entities: readonly ProjectEntityV1[],
  start: number,
  end: number,
  name?: string,
): ProjectEntityV1 | undefined {
  const candidates = entities.filter(
    (entity) =>
      entity.kind !== "file" &&
      entity.range.startOffset !== undefined &&
      entity.range.endOffset !== undefined &&
      (name === undefined
        ? entity.range.startOffset >= start &&
          entity.range.startOffset <= end &&
          Math.abs(entity.range.endOffset - end) <= 1
        : entity.name === name &&
          entity.nameRange?.startOffset === start &&
          entity.nameRange.endOffset === end),
  );
  candidates.sort(
    (left, right) =>
      Number(right.range.startOffset === start) - Number(left.range.startOffset === start) ||
      right.range.endOffset! -
        right.range.startOffset! -
        (left.range.endOffset! - left.range.startOffset!),
  );
  const selected = candidates[0];
  if (!selected) return undefined;
  if (selected.kind === "variable" || selected.kind === "property") {
    return entities.find(
      (entity) =>
        entity.containerId === selected.id &&
        (entity.kind === "lambda" || entity.kind === "function"),
    );
  }
  return ["class", "constructor", "method", "function", "lambda", "initializer"].includes(
    selected.kind,
  )
    ? selected
    : undefined;
}

export function resolvedCallsite(
  callsite: ProjectCallsiteV1,
  targets: readonly ProjectEntityV1[],
  adapter: string,
  exact: boolean,
): ProjectCallsiteV1 {
  const unique = [...new Map(targets.map((entity) => [entity.id, entity])).values()];
  if (unique.length === 0)
    return {
      ...callsite,
      resolution: "unresolved",
      targetEntityIds: [],
      provenance: "compiler",
      reason: `${adapter}: no project executable declaration resolved; the target may be external or dynamic.`,
    };
  const resolution = exact && unique.length === 1 ? "resolved" : "candidate";
  const dispatch = unique.every(
    (entity) =>
      entity.kind !== "method" || /\b(static|private|final|sealed)\b/.test(entity.signature ?? ""),
  )
    ? "direct"
    : "virtual";
  return {
    ...callsite,
    resolution,
    targetEntityIds: unique.map((entity) => entity.id),
    provenance: "compiler",
    dispatch,
    reason:
      resolution === "resolved"
        ? `${adapter}: compiler-selected declaration.`
        : `${adapter}: compiler candidates; runtime dispatch or overload selection remains uncertain.`,
  };
}

export function unresolvedCallGaps(callsites: readonly ProjectCallsiteV1[]): ExtractionGap[] {
  return callsites
    .filter((callsite) => callsite.resolution === "unresolved")
    .map((callsite) => ({
      ...coverageGap(
        "unresolved-call",
        callsite.reason ?? "Call target is unresolved.",
        callsite.filePath,
      ),
      id: `gap:${callsite.id}`,
      ...(callsite.callerEntityId ? { entityId: callsite.callerEntityId } : {}),
    }));
}
