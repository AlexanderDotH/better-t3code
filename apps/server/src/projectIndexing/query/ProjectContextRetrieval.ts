import type {
  ProjectCallsiteV1,
  ProjectContextInput,
  ProjectEntityV1,
  ProjectIndexGapV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProjectContextPosition } from "./ProjectContextCursor.ts";
import type { ProjectContextReader, ProjectContextRecord } from "./ProjectContextSources.ts";
import { projectContextImpact } from "./ProjectContextTraversal.ts";
import type { KnowledgeStoreError } from "../persistence/KnowledgeStore.ts";
import type { KnowledgeSearchPage } from "../persistence/KnowledgeStoreTypes.ts";
import { projectContextRecordEntityIds } from "./ProjectContextDependencies.ts";
import {
  applicableAgentRuleFiles,
  isOriginalAgentRule,
  readTaskAgentRules,
  type OriginalRuleScope,
} from "./ProjectContextRules.ts";
import { isWithinWorkspaceContextScopes } from "../../workspace/WorkspaceContextPathPolicy.ts";
import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";

export type ProjectContextRecordKind =
  | "entities"
  | "callsites"
  | "imports"
  | "modules"
  | "behaviors"
  | "flows"
  | "rules";
export interface ProjectContextCandidate {
  readonly kind: ProjectContextRecordKind;
  readonly record: ProjectContextRecord;
  readonly originalRuleScope?: OriginalRuleScope;
}

interface QueryStage {
  readonly kind: ProjectContextRecordKind | "search";
  readonly originalRuleFile?: string;
}

const MAX_RELATED_ENTITIES = 8;
const SEARCH_BATCH_SIZE = 32;
type ContextSearchKind = "entities" | "imports" | "modules" | "rules";

function queryStages(
  input: ProjectContextInput,
  selectedEntity?: ProjectEntityV1,
): ReadonlyArray<QueryStage> {
  if (input.operation === "overview") {
    return [
      { kind: "entities" },
      { kind: "modules" },
      { kind: "rules" },
      { kind: "imports" },
      { kind: "callsites" },
    ];
  }
  if (input.operation === "entity") {
    return [
      ...(selectedEntity
        ? applicableAgentRuleFiles(selectedEntity.filePath).map((originalRuleFile) => ({
            kind: "rules" as const,
            originalRuleFile,
          }))
        : []),
      { kind: "rules" },
      { kind: "entities" },
      { kind: "callsites" },
      { kind: "imports" },
      { kind: "modules" },
    ];
  }
  if (
    input.operation === "callers" ||
    input.operation === "callees" ||
    input.operation === "impact"
  )
    return [{ kind: "callsites" }];
  const scopedRules =
    input.operation === "task"
      ? [
          ...new Set(
            (input.scopes ?? []).flatMap((scope) => [
              ...applicableAgentRuleFiles(scope),
              `${scope.replace(/\/+$/u, "")}/AGENTS.md`,
            ]),
          ),
        ].map((originalRuleFile) => ({ kind: "rules" as const, originalRuleFile }))
      : [];
  return [...scopedRules, { kind: "search" as const }];
}

export function makeProjectContextRetrieval(
  reader: ProjectContextReader,
  input: ProjectContextInput,
  revision: number,
  validateImpactCall?: (callsite: ProjectCallsiteV1) => Effect.Effect<boolean, KnowledgeStoreError>,
  selectedEntity?: ProjectEntityV1,
) {
  const stages = queryStages(input, selectedEntity);
  let impact: Effect.Success<ReturnType<typeof projectContextImpact>> | undefined;
  let searchBatch: KnowledgeSearchPage<ContextSearchKind> | undefined;
  let searchOffset = 0;
  const next = Effect.fn("ProjectContextQuery.next")(function* (position: ProjectContextPosition) {
    const stage = stages[position.stage];
    if (!stage) return { candidate: null, position, complete: true, traversalTruncated: false };
    if (stage.originalRuleFile !== undefined) {
      const page = yield* reader.listRecords({
        kind: "rules",
        filePath: stage.originalRuleFile,
        revision,
        limit: 1,
        ...(position.afterId === null ? {} : { afterId: position.afterId }),
      });
      const rule = page.items[0];
      const advanced =
        page.nextCursor === null
          ? { stage: position.stage + 1, afterId: null }
          : { stage: position.stage, afterId: rule?.id ?? position.afterId };
      const original =
        rule !== undefined &&
        (yield* isOriginalAgentRule(reader, rule, stage.originalRuleFile, revision));
      return {
        candidate: original
          ? {
              kind: "rules" as const,
              record: rule,
              originalRuleScope: {
                filePath: stage.originalRuleFile,
                entityIds: selectedEntity === undefined ? [] : [selectedEntity.id],
              },
            }
          : null,
        position: advanced,
        complete: advanced.stage >= stages.length,
        traversalTruncated: false,
      };
    }
    if (stage.kind === "search") {
      if (searchBatch === undefined || searchOffset >= searchBatch.items.length) {
        searchBatch = yield* reader.searchRecords({
          revision,
          query: input.text ?? "",
          kinds: ["entities", "imports", "modules", "rules"],
          ...(input.includeStale === undefined ? {} : { includeStale: input.includeStale }),
          limit: SEARCH_BATCH_SIZE,
          ...(input.scopes === undefined ? {} : { filePathPrefixes: input.scopes }),
          ...(position.afterId === null || position.afterKind == null || position.afterRank == null
            ? {}
            : {
                after: {
                  rank: position.afterRank,
                  kind: position.afterKind,
                  id: position.afterId,
                },
              }),
        });
        searchOffset = 0;
      }
      const hit = searchBatch.items[searchOffset++];
      const hasNext = searchOffset < searchBatch.items.length || searchBatch.nextCursor !== null;
      const advanced =
        !hit || !hasNext
          ? { stage: position.stage + 1, afterId: null }
          : {
              stage: position.stage,
              afterId: hit.record.id,
              afterKind: hit.kind,
              afterRank: hit.rank,
            };
      return {
        candidate: hit ? { kind: hit.kind, record: hit.record } : null,
        position: advanced,
        complete: advanced.stage >= stages.length,
        traversalTruncated: false,
      };
    }
    if (input.operation === "entity" && stage.kind === "entities") {
      const target = yield* reader.getRecord("entities", input.entityId ?? "", revision);
      const container = target?.containerId
        ? yield* reader.getRecord("entities", target.containerId, revision)
        : null;
      const nextPosition = { stage: position.stage + 1, afterId: null };
      return {
        candidate: container ? { kind: "entities" as const, record: container } : null,
        position: nextPosition,
        complete: nextPosition.stage >= stages.length,
        traversalTruncated: false,
      };
    }
    if (input.operation === "impact") {
      impact ??= yield* projectContextImpact(
        reader,
        input.entityId ?? "",
        revision,
        validateImpactCall,
      );
      const record = impact.callsites.find(
        (callsite) => position.afterId === null || callsite.id > position.afterId,
      );
      return record
        ? {
            candidate: { kind: "callsites" as const, record },
            position: { stage: position.stage, afterId: record.id },
            complete: false,
            traversalTruncated: impact.truncated,
          }
        : {
            candidate: null,
            position: { stage: position.stage + 1, afterId: null },
            complete: true,
            traversalTruncated: impact.truncated,
          };
    }
    const page =
      input.operation === "callers" ||
      input.operation === "callees" ||
      (input.operation === "entity" && stage.kind === "callsites")
        ? yield* reader.listCalls({
            entityIds: [input.entityId ?? ""],
            direction: input.operation === "entity" ? "both" : input.operation,
            revision,
            limit: 1,
            ...(position.afterId === null ? {} : { afterId: position.afterId }),
          })
        : yield* reader.listRecords({
            kind: stage.kind,
            revision,
            limit: 1,
            ...(input.scopes === undefined ? {} : { filePathPrefixes: input.scopes }),
            ...(input.operation === "entity" && stage.kind === "imports" && selectedEntity
              ? { sourceFilePath: selectedEntity.filePath }
              : {}),
            ...(input.operation === "entity" && input.entityId && stage.kind !== "imports"
              ? { entityIds: [input.entityId] }
              : {}),
            ...(position.afterId === null ? {} : { afterId: position.afterId }),
          });
    const record = page.items[0];
    const advanced =
      page.nextCursor === null
        ? { stage: position.stage + 1, afterId: null }
        : { stage: position.stage, afterId: record?.id ?? position.afterId };
    return {
      candidate: record ? { kind: stage.kind, record } : null,
      position: advanced,
      complete: advanced.stage >= stages.length,
      traversalTruncated: false,
    };
  });

  const related = Effect.fn("ProjectContextQuery.related")(function* (
    candidate: ProjectContextCandidate,
  ) {
    const { record } = candidate;
    const results: ProjectContextCandidate[] = [];
    const gaps: ProjectIndexGapV1[] = [];
    if (["callers", "callees", "impact"].includes(input.operation)) {
      const linkedIds = [...new Set(projectContextRecordEntityIds(record))];
      for (const id of linkedIds.slice(0, MAX_RELATED_ENTITIES)) {
        const entity = yield* reader.getRecord("entities", id, revision);
        if (entity) results.push({ kind: "entities", record: entity });
      }
      if (linkedIds.length > MAX_RELATED_ENTITIES)
        gaps.push({
          id: `call-entities:${record.id}`,
          kind: "limit",
          message: "Additional call targets are available through individual entity queries.",
          retryable: false,
        });
      return { records: results, gaps };
    }
    if (
      input.operation !== "task" &&
      input.operation !== "search" &&
      input.operation !== "entity" &&
      input.operation !== "overview"
    )
      return { records: results, gaps };
    const entityIds = [...new Set(projectContextRecordEntityIds(record))].slice(0, 4);
    if ("dependsOnModuleIds" in record) {
      for (const id of record.dependsOnModuleIds.slice(0, 4)) {
        const dependency = yield* reader.getRecord("modules", id, revision);
        if (dependency) results.push({ kind: "modules", record: dependency });
      }
    }
    const associatedEntityIds = new Set<string>();
    const associate = (ids: ReadonlyArray<string>) => {
      for (const id of ids) {
        if (id === record.id || entityIds.includes(id)) continue;
        if (associatedEntityIds.size >= MAX_RELATED_ENTITIES) break;
        associatedEntityIds.add(id);
      }
    };
    if ("containerId" in record && record.containerId) associate([record.containerId]);
    if (entityIds.length > 0 && input.operation === "task") {
      const targets = yield* Effect.forEach(entityIds, (id) =>
        reader.getRecord("entities", id, revision),
      );
      const applicable = yield* readTaskAgentRules(
        reader,
        targets.filter(
          (target): target is ProjectEntityV1 =>
            target !== null && isWithinWorkspaceContextScopes(target.filePath, input.scopes),
        ),
        revision,
      );
      results.push(...applicable.records);
      gaps.push(...applicable.gaps);
    }
    if (entityIds.length > 0) {
      for (const direction of ["callers", "callees"] as const) {
        const calls = yield* reader.listCalls({ entityIds, direction, revision, limit: 4 });
        for (const callsite of calls.items) {
          if (callsite.resolution !== "resolved" || callsite.provenance === "llm") continue;
          results.push({ kind: "callsites", record: callsite });
          associate([
            ...callsite.targetEntityIds,
            ...(callsite.callerEntityId ? [callsite.callerEntityId] : []),
          ]);
        }
      }
    }
    for (const entityId of associatedEntityIds) {
      const entity = yield* reader.getRecord("entities", entityId, revision);
      if (entity) results.push({ kind: "entities", record: entity });
    }
    const filePaths = new Set<string>();
    if ("filePath" in record) filePaths.add(record.filePath);
    if ("targetPath" in record && record.targetPath) filePaths.add(record.targetPath);
    for (const filePath of [...filePaths].slice(0, 2)) {
      if (input.operation === "task") {
        const sourceFile = yield* reader.getRecord("files", filePath, revision);
        for (const configPath of (sourceFile?.configDependencies ?? [])
          .filter(isSafeProjectSourcePath)
          .slice(0, 4)) {
          const configuration = yield* reader.listRecords({
            kind: "entities",
            sourceFilePath: configPath,
            revision,
            limit: 4,
          });
          results.push(
            ...configuration.items
              .filter((entity) => entity.kind === "file")
              .map((entity) => ({ kind: "entities" as const, record: entity })),
          );
        }
      }
      const outgoing = yield* reader.listRecords({
        kind: "imports",
        sourceFilePath: filePath,
        revision,
        limit: 3,
      });
      const incoming = yield* reader.listRecords({
        kind: "imports",
        filePath,
        revision,
        limit: 3,
      });
      const imports = [...outgoing.items, ...incoming.items].filter(
        (item) =>
          item.filePath === filePath ||
          (item.resolution === "workspace" && item.targetPath === filePath),
      );
      results.push(...imports.map((item) => ({ kind: "imports" as const, record: item })));
      for (const targetPath of [
        ...new Set(
          imports.flatMap((item) =>
            item.resolution === "workspace" && item.targetPath ? [item.targetPath] : [],
          ),
        ),
      ].slice(0, 3)) {
        const targetEntities = yield* reader.listRecords({
          kind: "entities",
          sourceFilePath: targetPath,
          revision,
          limit: 2,
        });
        results.push(
          ...targetEntities.items.map((entity) => ({ kind: "entities" as const, record: entity })),
        );
      }
      if (input.operation === "task") {
        const neighboring = yield* reader.listRecords({
          kind: "entities",
          sourceFilePath: filePath,
          revision,
          limit: 3,
        });
        results.push(
          ...neighboring.items
            .filter((entity) => entity.id !== record.id)
            .map((entity) => ({ kind: "entities" as const, record: entity })),
        );
      }
    }
    return { records: results, gaps };
  });

  return { next, related, stageCount: stages.length };
}
