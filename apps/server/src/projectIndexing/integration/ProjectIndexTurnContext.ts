import { type ProjectIndexQueryResultV1, type ProjectIndexScopeInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as References from "effect/References";

import type { ProjectContextQuery } from "../query/ProjectContextQuery.ts";
import { estimateProjectIndexTokens } from "../semantic/ProjectIndexContextBudget.ts";

const TASK_SEARCH_MAX_CHARACTERS = 8_000;
const AUTOMATIC_CONTEXT_MAX_TOKENS = 2_000;
const CONTEXT_PREFIX = [
  "<t3_project_knowledge>",
  "Static source facts follow. Read original code and applicable AGENTS.md before editing.",
  "Calls and imports are static relationships, not proven runtime paths. Hash matches do not mean checks ran.",
  "Neighboring signatures and import forms are examples, not project rules.",
].join("\n");
const CONTEXT_SUFFIX = "</t3_project_knowledge>";

function compactText(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength - 1)}…`
    : normalized;
}

export function formatProjectIndexTurnContext(
  result: ProjectIndexQueryResultV1,
): string | undefined {
  const lines: string[] = [];
  const fits = (line: string) =>
    estimateProjectIndexTokens(
      `${CONTEXT_PREFIX}\n${[...lines, line].join("\n")}\n${CONTEXT_SUFFIX}`,
    ) <= AUTOMATIC_CONTEXT_MAX_TOKENS;
  const add = (line: string) => {
    if (!fits(line)) return false;
    lines.push(line);
    return true;
  };
  const sourcePath = (evidenceIds: ReadonlyArray<string>) =>
    result.evidence.find((source) => evidenceIds.includes(source.id))?.filePath;

  add(`Index revision ${result.revision}.`);
  for (const rule of result.rules) {
    const path = sourcePath(rule.evidenceIds);
    if (!path) continue;
    if (!add(`Rule ${path}: ${compactText(rule.description, 500)}`))
      add(`Read original rule file: ${path}`);
  }
  for (const gap of result.gaps) {
    if (
      gap.filePath &&
      (gap.id.startsWith("agent-rule") ||
        (gap.id.startsWith("budget:") && gap.message.includes("original rule")))
    )
      add(`Read original rule file: ${gap.filePath}`);
  }
  for (const entity of result.entities) {
    const declaration = compactText(entity.signature ?? entity.qualifiedName, 220);
    add(`Symbol ${entity.filePath}:${entity.range.startLine} ${declaration}`);
  }
  for (const module of result.modules) {
    const manifest = module.filePaths[0] ?? sourcePath(module.evidenceIds);
    if (manifest) add(`Package ${manifest}: ${compactText(module.name, 120)}`);
  }
  for (const dependency of result.imports ?? []) {
    const destination = dependency.targetPath ?? dependency.packageName ?? dependency.resolution;
    add(
      `Import ${dependency.filePath}:${dependency.range.startLine} ${compactText(dependency.importText, 160)} → ${compactText(destination, 120)}`,
    );
  }
  for (const call of result.callsites) {
    if (call.resolution !== "resolved") continue;
    add(
      `Static call ${call.filePath}:${call.range.startLine} ${compactText(call.expression, 120)} → ${call.targetEntityIds[0]}`,
    );
  }
  return lines.length > 1 ? `${CONTEXT_PREFIX}\n${lines.join("\n")}\n${CONTEXT_SUFFIX}` : undefined;
}

export const prepareProjectIndexTurnContext = Effect.fnUntraced(
  function* (query: ProjectContextQuery["Service"], scope: ProjectIndexScopeInput, task: string) {
    if (task.trim().length === 0 || task.trimStart().startsWith("/")) return undefined;
    const result = yield* query
      .query({
        ...scope,
        operation: "task",
        text: task.slice(0, TASK_SEARCH_MAX_CHARACTERS),
      })
      .pipe(Effect.option);
    if (result._tag === "None" || result.value.revision === 0) return undefined;
    return formatProjectIndexTurnContext(result.value);
  },
  Effect.provideService(References.TracerEnabled, false),
);
