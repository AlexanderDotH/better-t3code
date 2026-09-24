import {
  ProjectBehaviorV1,
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectEvidenceV1,
  ProjectFlowV1,
  ProjectImportV1,
  ProjectIndexGapV1,
  ProjectModuleV1,
  ProjectRuleV1,
  ProjectSourceFileV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { isSafeProjectSourcePath, isWorkspaceRelativePath } from "../privacy/WorkspacePrivacy.ts";
import { KnowledgeStoreError, asStoreError } from "./KnowledgeStoreSchema.ts";
import type {
  KnowledgeBatch,
  KnowledgeRecordKind,
  KnowledgeRecordMap,
} from "./KnowledgeStoreTypes.ts";

const RECORD_SCHEMAS: {
  readonly [Kind in KnowledgeRecordKind]: Schema.Codec<KnowledgeRecordMap[Kind], unknown>;
} = {
  files: ProjectSourceFileV1,
  entities: ProjectEntityV1,
  evidence: ProjectEvidenceV1,
  callsites: ProjectCallsiteV1,
  imports: ProjectImportV1,
  modules: ProjectModuleV1,
  behaviors: ProjectBehaviorV1,
  flows: ProjectFlowV1,
  rules: ProjectRuleV1,
  gaps: ProjectIndexGapV1,
};

type KnowledgeRecord = KnowledgeRecordMap[KnowledgeRecordKind];

interface RecordCodec<Kind extends KnowledgeRecordKind> {
  readonly decode: (input: unknown) => Effect.Effect<KnowledgeRecordMap[Kind], Schema.SchemaError>;
  readonly decodeJson: (
    input: string,
  ) => Effect.Effect<KnowledgeRecordMap[Kind], Schema.SchemaError>;
  readonly encodeJson: (
    input: KnowledgeRecordMap[Kind],
  ) => Effect.Effect<string, Schema.SchemaError>;
}

function compileRecord<Kind extends KnowledgeRecordKind>(kind: Kind): RecordCodec<Kind> {
  const schema: Schema.Codec<KnowledgeRecordMap[Kind], unknown> = RECORD_SCHEMAS[kind];
  const json = Schema.fromJsonString(schema);
  return {
    decode: Schema.decodeEffect(schema, { onExcessProperty: "error" }),
    decodeJson: Schema.decodeEffect(json),
    encodeJson: Schema.encodeEffect(json),
  };
}
const RECORD_CODECS: { readonly [Kind in KnowledgeRecordKind]: RecordCodec<Kind> } = {
  files: compileRecord("files"),
  entities: compileRecord("entities"),
  evidence: compileRecord("evidence"),
  callsites: compileRecord("callsites"),
  imports: compileRecord("imports"),
  modules: compileRecord("modules"),
  behaviors: compileRecord("behaviors"),
  flows: compileRecord("flows"),
  rules: compileRecord("rules"),
  gaps: compileRecord("gaps"),
};

export function recordCodec<Kind extends KnowledgeRecordKind>(kind: Kind): RecordCodec<Kind> {
  return RECORD_CODECS[kind];
}

export const decodeRecord = <Kind extends KnowledgeRecordKind>(kind: Kind, json: string) =>
  recordCodec(kind)
    .decodeJson(json)
    .pipe(Effect.mapError(asStoreError("decode records")));

export function recordId(record: KnowledgeRecord): string {
  return "id" in record ? record.id : record.path;
}

export function recordFilePath(record: KnowledgeRecord): string | null {
  return "filePath" in record ? (record.filePath ?? null) : "path" in record ? record.path : null;
}

export function recordName(record: KnowledgeRecord): string {
  return "name" in record
    ? record.name
    : "expression" in record
      ? record.expression
      : "specifier" in record
        ? record.specifier
        : "path" in record
          ? record.path
          : "summary" in record
            ? record.summary
            : "message" in record
              ? record.message
              : record.id;
}

export function recordEntityIds(record: KnowledgeRecord): ReadonlyArray<string> {
  if ("targetEntityIds" in record)
    return [...(record.callerEntityId ? [record.callerEntityId] : []), ...record.targetEntityIds];
  if ("entityIds" in record) return record.entityIds;
  if ("entryEntityIds" in record)
    return [
      ...record.entryEntityIds,
      ...record.exitEntityIds,
      ...record.steps.flatMap((step) => (step.entityId ? [step.entityId] : [])),
    ];
  if ("appliesToEntityIds" in record) return record.appliesToEntityIds;
  if ("entityId" in record && record.entityId !== undefined) return [record.entityId];
  if ("qualifiedName" in record) return [record.id];
  return [];
}

export const putKnowledgeBatch = Effect.fn("putKnowledgeBatch")(function* (
  sql: SqlClient.SqlClient,
  revision: number,
  batch: KnowledgeBatch,
) {
  for (const kind of Object.keys(RECORD_SCHEMAS) as KnowledgeRecordKind[]) {
    for (const candidate of batch[kind] ?? []) {
      const record = yield* recordCodec(kind)
        .decode(candidate)
        .pipe(Effect.mapError(asStoreError("validate records")));
      if (
        (kind === "modules" || kind === "behaviors" || kind === "flows" || kind === "rules") &&
        "provenance" in record &&
        record.provenance === "llm"
      ) {
        if (
          !("analysis" in record) ||
          record.analysis === undefined ||
          record.analysis.sourceRevision !== revision ||
          record.evidenceIds.length === 0
        )
          return yield* new KnowledgeStoreError({
            code: "invalid-analysis",
            detail:
              "Model-generated knowledge requires current revision metadata and source evidence.",
          });
      }
      const payload = yield* recordCodec(kind)
        .encodeJson(record)
        .pipe(Effect.mapError(asStoreError("encode records")));
      const id = recordId(record);
      const filePath = recordFilePath(record);
      const filePaths = new Set([
        ...(filePath ? [filePath] : []),
        ...("filePaths" in record ? record.filePaths : []),
        ...("configDependencies" in record ? record.configDependencies : []),
        ...("targetPath" in record && record.targetPath ? [record.targetPath] : []),
      ]);
      const exclusionMetadata =
        (kind === "files" &&
          "path" in record &&
          record.contentHash === "unread" &&
          record.bytes === 0 &&
          record.configDependencies.length === 0 &&
          (record.status === "skipped" ||
            record.status === "stale" ||
            record.status === "deleted")) ||
        (kind === "gaps" && "kind" in record && record.kind === "excluded");
      if (
        [...filePaths].some(
          (value) =>
            !(exclusionMetadata ? isWorkspaceRelativePath(value) : isSafeProjectSourcePath(value)),
        )
      ) {
        return yield* new KnowledgeStoreError({
          code: "private-source",
          detail: "Private or out-of-workspace source paths cannot enter project knowledge.",
        });
      }
      if ("sourceHash" in record) {
        const source = yield* sql<{
          payload: string;
        }>`SELECT payload FROM knowledge_records WHERE revision = ${revision} AND kind = 'files' AND id = ${record.filePath}`;
        if (kind === "imports" && !source[0])
          return yield* new KnowledgeStoreError({
            code: "stale-source",
            detail: "An import has no indexed source file for its source hash.",
          });
        if (source[0]) {
          const file = yield* decodeRecord("files", source[0].payload);
          if (file.contentHash !== record.sourceHash)
            return yield* new KnowledgeStoreError({
              code: "stale-source",
              detail: "An indexing result refers to an outdated source hash.",
            });
        }
      }
      const name = recordName(record);
      const text = [
        name,
        filePath ?? "",
        "qualifiedName" in record ? record.qualifiedName : "",
        "signature" in record ? (record.signature ?? "") : "",
        "packageName" in record ? (record.packageName ?? "") : "",
        "summary" in record ? record.summary : "",
        "description" in record ? record.description : "",
        ...("inputs" in record ? record.inputs : []),
        ...("outputs" in record ? record.outputs : []),
        ...("errorPaths" in record ? record.errorPaths : []),
        ...("invariants" in record ? record.invariants : []),
        ...("sideEffects" in record ? record.sideEffects : []),
      ]
        .join("\n")
        .toLowerCase();
      yield* sql`INSERT INTO knowledge_records(revision, kind, id, file_path, name, search_text, payload)
        VALUES (${revision}, ${kind}, ${id}, ${filePath}, ${name}, ${text}, ${payload})
        ON CONFLICT(revision, kind, id) DO UPDATE SET file_path = excluded.file_path, name = excluded.name, search_text = excluded.search_text, payload = excluded.payload`;
      yield* sql`DELETE FROM knowledge_record_dependencies WHERE revision = ${revision} AND kind = ${kind} AND id = ${id}`;
      for (const entityId of new Set(recordEntityIds(record))) {
        const entity = yield* sql<{
          file_path: string;
        }>`SELECT file_path FROM knowledge_records WHERE revision = ${revision} AND kind = 'entities' AND id = ${entityId}`;
        const dependencyPath = entity[0]?.file_path ?? filePath ?? "";
        yield* sql`INSERT OR IGNORE INTO knowledge_record_dependencies VALUES (${revision}, ${kind}, ${id}, ${dependencyPath}, ${entityId})`;
      }
      if ("evidenceIds" in record) {
        const evidenceIds = new Set([
          ...record.evidenceIds,
          ...("steps" in record ? record.steps.flatMap((step) => step.evidenceIds) : []),
        ]);
        for (const evidenceId of evidenceIds) {
          const evidence = yield* sql<{
            file_path: string;
          }>`SELECT file_path FROM knowledge_records WHERE revision = ${revision} AND kind = 'evidence' AND id = ${evidenceId}`;
          if (evidence[0]?.file_path) filePaths.add(evidence[0].file_path);
        }
      }
      for (const dependencyPath of filePaths)
        yield* sql`INSERT OR IGNORE INTO knowledge_record_dependencies VALUES (${revision}, ${kind}, ${id}, ${dependencyPath}, ${""})`;
      if (kind === "callsites" && "targetEntityIds" in record) {
        yield* sql`DELETE FROM knowledge_calls WHERE revision = ${revision} AND callsite_id = ${id}`;
        for (const calleeId of record.targetEntityIds)
          yield* sql`INSERT INTO knowledge_calls VALUES (${revision}, ${id}, ${record.callerEntityId ?? ""}, ${calleeId})`;
        if (record.targetEntityIds.length === 0 && record.callerEntityId)
          yield* sql`INSERT INTO knowledge_calls VALUES (${revision}, ${id}, ${record.callerEntityId}, ${""})`;
      }
    }
  }
  for (const callsite of batch.callsites ?? []) {
    if (callsite.provenance !== "compiler" || callsite.resolution === "unresolved") continue;
    const gapId = `gap:${callsite.id}`;
    yield* sql`DELETE FROM knowledge_records WHERE revision = ${revision} AND kind = 'gaps' AND id = ${gapId} AND file_path = ${callsite.filePath} AND json_extract(payload, '$.kind') = 'unresolved-call'`;
    yield* sql`DELETE FROM knowledge_record_dependencies WHERE revision = ${revision} AND kind = 'gaps' AND id = ${gapId} AND NOT EXISTS (SELECT 1 FROM knowledge_records record WHERE record.revision = knowledge_record_dependencies.revision AND record.kind = 'gaps' AND record.id = knowledge_record_dependencies.id)`;
  }
});

export const removeKnowledgeFiles = Effect.fn("removeKnowledgeFiles")(function* (
  sql: SqlClient.SqlClient,
  revision: number,
  filePaths: ReadonlyArray<string>,
  now: number,
) {
  for (const filePath of new Set(filePaths)) {
    if (!isWorkspaceRelativePath(filePath))
      return yield* new KnowledgeStoreError({
        code: "private-source",
        detail: "Cannot remove knowledge for an out-of-workspace path.",
      });
    yield* sql`DELETE FROM knowledge_records WHERE revision = ${revision} AND (
      file_path = ${filePath} OR EXISTS (
        SELECT 1 FROM knowledge_record_dependencies dependency WHERE dependency.revision = knowledge_records.revision AND dependency.kind = knowledge_records.kind AND dependency.id = knowledge_records.id AND dependency.file_path = ${filePath}
      )
    )`;
    yield* sql`UPDATE knowledge_jobs SET state = 'cancelled', claim_token = NULL, claim_lease_token = NULL, detail = 'Source changed', updated_at = ${now} WHERE revision = ${revision} AND file_path = ${filePath} AND state IN ('pending', 'running')`;
  }
  yield* sql`DELETE FROM knowledge_calls WHERE revision = ${revision} AND NOT EXISTS (SELECT 1 FROM knowledge_records record WHERE record.revision = knowledge_calls.revision AND record.kind = 'callsites' AND record.id = knowledge_calls.callsite_id)`;
  yield* sql`DELETE FROM knowledge_record_dependencies WHERE revision = ${revision} AND NOT EXISTS (SELECT 1 FROM knowledge_records record WHERE record.revision = knowledge_record_dependencies.revision AND record.kind = knowledge_record_dependencies.kind AND record.id = knowledge_record_dependencies.id)`;
});
