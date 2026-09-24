import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import type { ProjectContextRecordKind } from "./ProjectContextRetrieval.ts";
import type { ProjectContextReader, ProjectContextRecord } from "./ProjectContextSources.ts";

const MAX_DEPENDENCY_FILES = 64;
const MAX_DEPENDENCY_ENTITIES = 64;
const MAX_CALLEES_PER_ENTITY = 64;

interface EntityDependencies {
  readonly filePaths: ReadonlyArray<string>;
  readonly entityIds: ReadonlyArray<string>;
  readonly incomplete: boolean;
  readonly invalidated: boolean;
  readonly unverified: boolean;
}

function recordKind(record: ProjectContextRecord): ProjectContextRecordKind {
  if ("kind" in record) return "entities";
  if ("targetEntityIds" in record) return "callsites";
  if ("importText" in record) return "imports";
  if ("errorPaths" in record) return "behaviors";
  if ("entryEntityIds" in record) return "flows";
  if ("appliesToEntityIds" in record) return "rules";
  return "modules";
}

export function projectContextRecordEntityIds(record: ProjectContextRecord): ReadonlyArray<string> {
  if ("kind" in record) return [record.id];
  if ("targetEntityIds" in record) {
    return [...record.targetEntityIds, ...(record.callerEntityId ? [record.callerEntityId] : [])];
  }
  if ("entityIds" in record) return record.entityIds;
  if ("appliesToEntityIds" in record) return record.appliesToEntityIds;
  if ("entryEntityIds" in record) {
    return [
      ...record.entryEntityIds,
      ...record.exitEntityIds,
      ...record.steps.flatMap((step) => (step.entityId ? [step.entityId] : [])),
    ];
  }
  return [];
}

/** Resolve recorded dependencies without relying on a watcher or starting refresh work. */
export function makeProjectContextDependencyReader(reader: ProjectContextReader, revision: number) {
  const files = new Map<string, ProjectSourceFileV1 | null>();
  const entities = new Map<string, EntityDependencies | null>();
  const readEntity = Effect.fn("ProjectContextDependencies.entity")(function* (id: string) {
    if (entities.has(id)) return entities.get(id) ?? null;
    const entity = yield* reader.getRecord("entities", id, revision);
    if (entity === null) {
      entities.set(id, null);
      return null;
    }
    const paths = yield* reader.getRecordDependencyPaths({
      kind: "entities",
      id,
      revision,
      limit: MAX_DEPENDENCY_FILES,
    });
    const calls = yield* reader.listCalls({
      entityIds: [id],
      direction: "callees",
      revision,
      limit: MAX_CALLEES_PER_ENTITY,
    });
    const targets = new Set<string>();
    let incomplete = paths.nextCursor !== null || calls.nextCursor !== null;
    for (const call of calls.items) {
      if (call.resolution !== "resolved" || call.provenance === "llm") continue;
      for (const target of call.targetEntityIds) {
        if (targets.size >= MAX_DEPENDENCY_ENTITIES && !targets.has(target)) {
          incomplete = true;
          break;
        }
        targets.add(target);
      }
    }
    const dependencies: EntityDependencies = {
      filePaths: [
        ...new Set([entity.filePath, ...paths.items, ...calls.items.map((call) => call.filePath)]),
      ],
      entityIds: [...targets],
      incomplete,
      invalidated:
        entity.freshness === "stale" || calls.items.some((call) => call.freshness === "stale"),
      unverified:
        entity.freshness === "unknown" ||
        entity.freshness === "missing" ||
        calls.items.some((call) => call.freshness === "unknown" || call.freshness === "missing"),
    };
    entities.set(id, dependencies);
    return dependencies;
  });

  return Effect.fn("ProjectContextDependencies.read")(function* (record: ProjectContextRecord) {
    const paths = yield* reader.getRecordDependencyPaths({
      kind: recordKind(record),
      id: record.id,
      revision,
      limit: MAX_DEPENDENCY_FILES,
    });
    const filePaths = new Set(paths.items);
    const pendingEntities = [...new Set(projectContextRecordEntityIds(record))];
    const queuedEntities = new Set(pendingEntities);
    const visitedEntities = new Set<string>();
    let incomplete = paths.nextCursor !== null;
    let invalidated = false;
    let missingReference = false;
    for (let index = 0; index < pendingEntities.length; index += 1) {
      const id = pendingEntities[index];
      if (id === undefined || visitedEntities.has(id)) continue;
      if (
        visitedEntities.size >= MAX_DEPENDENCY_ENTITIES ||
        (!entities.has(id) && entities.size >= MAX_DEPENDENCY_ENTITIES)
      ) {
        incomplete = true;
        break;
      }
      visitedEntities.add(id);
      const dependencies = yield* readEntity(id);
      if (dependencies === null) {
        missingReference = true;
        continue;
      }
      incomplete ||= dependencies.incomplete;
      invalidated ||= dependencies.invalidated;
      missingReference ||= dependencies.unverified;
      for (const filePath of dependencies.filePaths) filePaths.add(filePath);
      for (const entityId of dependencies.entityIds) {
        if (queuedEntities.has(entityId)) continue;
        if (queuedEntities.size >= MAX_DEPENDENCY_ENTITIES) {
          incomplete = true;
          break;
        }
        queuedEntities.add(entityId);
        pendingEntities.push(entityId);
      }
      if (filePaths.size > MAX_DEPENDENCY_FILES) {
        incomplete = true;
        break;
      }
    }
    const pendingFiles = [...filePaths].slice(0, MAX_DEPENDENCY_FILES);
    const queuedFiles = new Set(pendingFiles);
    incomplete ||= filePaths.size > MAX_DEPENDENCY_FILES;
    const visitedFiles = new Set<string>();
    const dependencies: ProjectSourceFileV1[] = [];
    const missingPaths: string[] = [];
    for (let index = 0; index < pendingFiles.length; index += 1) {
      const filePath = pendingFiles[index];
      if (filePath === undefined || visitedFiles.has(filePath)) continue;
      if (!isSafeProjectSourcePath(filePath)) {
        missingReference = true;
        continue;
      }
      if (
        visitedFiles.size >= MAX_DEPENDENCY_FILES ||
        (!files.has(filePath) && files.size >= MAX_DEPENDENCY_FILES)
      ) {
        incomplete = true;
        break;
      }
      visitedFiles.add(filePath);
      if (!files.has(filePath))
        files.set(filePath, yield* reader.getRecord("files", filePath, revision));
      const file = files.get(filePath);
      if (!file || file.contentHash === "unread") {
        missingPaths.push(filePath);
        missingReference = true;
        continue;
      }
      invalidated ||= file.status === "stale" || file.status === "deleted";
      missingReference ||= file.status === "failed";
      dependencies.push(file);
      for (const dependency of file.configDependencies) {
        if (queuedFiles.has(dependency)) continue;
        if (queuedFiles.size >= MAX_DEPENDENCY_FILES) {
          incomplete = true;
          break;
        }
        queuedFiles.add(dependency);
        pendingFiles.push(dependency);
      }
    }
    return { files: dependencies, missingPaths, missingReference, incomplete, invalidated };
  });
}
