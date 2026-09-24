import type { ProjectEntityV1, ProjectIndexGapV1, ProjectRuleV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProjectContextReader } from "./ProjectContextSources.ts";

export interface OriginalRuleScope {
  readonly filePath: string;
  readonly entityIds: ReadonlyArray<string>;
}

const MAX_TASK_RULE_FILES = 16;
const MAX_TASK_RULES_PER_FILE = 4;
const MAX_SCANNED_RULES_PER_FILE = 64;

export function applicableAgentRuleFiles(filePath: string): ReadonlyArray<string> {
  const directories = filePath.split("/").slice(0, -1);
  return [
    "AGENTS.md",
    ...directories.map((_, index) => `${directories.slice(0, index + 1).join("/")}/AGENTS.md`),
  ];
}

export const isOriginalAgentRule = Effect.fn("ProjectContextRules.isOriginal")(function* (
  reader: ProjectContextReader,
  rule: ProjectRuleV1,
  filePath: string,
  revision: number,
) {
  if (rule.source !== "explicit" || rule.provenance !== "parser") return false;
  for (const id of rule.evidenceIds) {
    const evidence = yield* reader.getRecord("evidence", id, revision);
    if (evidence?.filePath === filePath) return true;
  }
  return false;
});

export const readTaskAgentRules = Effect.fn("ProjectContextRules.readTaskRules")(function* (
  reader: ProjectContextReader,
  targets: ReadonlyArray<ProjectEntityV1>,
  revision: number,
) {
  const scopes = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const filePath of applicableAgentRuleFiles(target.filePath)) {
      const ids = scopes.get(filePath) ?? new Set<string>();
      ids.add(target.id);
      scopes.set(filePath, ids);
    }
  }
  const records: Array<{
    readonly kind: "rules";
    readonly record: ProjectRuleV1;
    readonly originalRuleScope: OriginalRuleScope;
  }> = [];
  const gaps: ProjectIndexGapV1[] = [];
  for (const [filePath, ids] of [...scopes].slice(0, MAX_TASK_RULE_FILES)) {
    const page = yield* reader.listRecords({
      kind: "rules",
      filePath,
      revision,
      limit: MAX_SCANNED_RULES_PER_FILE,
    });
    let originals = 0;
    for (const record of page.items) {
      if (yield* isOriginalAgentRule(reader, record, filePath, revision)) {
        originals += 1;
        if (originals <= MAX_TASK_RULES_PER_FILE)
          records.push({
            kind: "rules",
            record,
            originalRuleScope: { filePath, entityIds: [...ids] },
          });
      }
    }
    if (page.nextCursor !== null || originals > MAX_TASK_RULES_PER_FILE)
      gaps.push({
        id: `agent-rules:${filePath}`,
        kind: "limit",
        message: `Original directives in ${filePath} exceed this context batch. Read that file for all applicable instructions.`,
        filePath,
        retryable: true,
      });
  }
  const uninspected = [...scopes.keys()][MAX_TASK_RULE_FILES];
  if (uninspected)
    gaps.push({
      id: "agent-rule-scope-limit",
      kind: "limit",
      message: `Ancestor rule lookup was bounded before ${uninspected}. Read the applicable original AGENTS files.`,
      filePath: uninspected,
      retryable: true,
    });
  return { records, gaps };
});
