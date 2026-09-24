// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type {
  ProjectEntityV1,
  ProjectEvidenceV1,
  ProjectIndexFreshness,
  ProjectIndexGapV1,
  ProjectIndexQueryVerificationV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import type { KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import type { KnowledgeRecordMap } from "../persistence/KnowledgeStoreTypes.ts";
import { hashProjectSourceFile, isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { isWithinWorkspaceContextScopes } from "../../workspace/WorkspaceContextPathPolicy.ts";
import {
  makeProjectContextDependencyReader,
  projectContextRecordEntityIds,
} from "./ProjectContextDependencies.ts";

export type ProjectContextReader = Pick<
  KnowledgeStore,
  | "getState"
  | "isStaticRevision"
  | "getCoverage"
  | "getRecord"
  | "getRecordDependencyPaths"
  | "listRecords"
  | "searchRecords"
  | "listCalls"
>;
export type ProjectContextRecord = KnowledgeRecordMap[
  | "entities"
  | "callsites"
  | "imports"
  | "modules"
  | "behaviors"
  | "flows"
  | "rules"];
export type ProjectContextHashReader = (
  workspaceRoot: string,
  filePath: string,
) => Effect.Effect<string, Error>;

const MAX_SOURCE_FILES_PER_QUERY = 64;
const MAX_RECORD_REFERENCES = 64;

type SourceHashCheck =
  | { readonly status: "read"; readonly hash: string }
  | { readonly status: "missing" | "unknown" };

function sourceReadFailureFreshness(error: unknown): "missing" | "unknown" {
  let cause = error;
  for (let depth = 0; depth < 4 && Predicate.isObject(cause); depth += 1) {
    if ("code" in cause && cause.code === "ENOENT") return "missing";
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return "unknown";
}

function combineFreshness(
  left: ProjectIndexFreshness,
  right: ProjectIndexFreshness,
): ProjectIndexFreshness {
  if (left === "missing" || right === "missing") return "missing";
  if (left === "stale" || right === "stale") return "stale";
  if (left === "unknown" || right === "unknown") return "unknown";
  return "current";
}

function sourceReference(
  source: Pick<ProjectEntityV1, "filePath" | "range" | "sourceHash" | "provenance">,
): ProjectEvidenceV1 {
  const id = NodeCrypto.createHash("sha256")
    .update(JSON.stringify([source.filePath, source.range, source.sourceHash]))
    .digest("hex")
    .slice(0, 32);
  return {
    id: `source:${id}`,
    filePath: source.filePath,
    range: source.range,
    sourceHash: source.sourceHash,
    provenance: source.provenance,
  };
}

export function projectContextGap(
  id: string,
  message: string,
  kind: ProjectIndexGapV1["kind"] = "other",
  filePath?: string,
): ProjectIndexGapV1 {
  return { id, kind, message, retryable: true, ...(filePath ? { filePath } : {}) };
}

export function makeProjectContextSourceValidator(input: {
  readonly reader: ProjectContextReader;
  readonly workspaceRoot: string;
  readonly revision: number;
  readonly scopes?: ReadonlyArray<string>;
  readonly readHash?: ProjectContextHashReader;
  readonly restrictEvidenceToScopes?: boolean;
}) {
  const hashes = new Map<string, SourceHashCheck>();
  const checksByRecord = new WeakMap<
    ProjectContextRecord,
    ReadonlyMap<string, ProjectIndexFreshness>
  >();
  const readDependencies = makeProjectContextDependencyReader(input.reader, input.revision);
  const readHash: ProjectContextHashReader = input.readHash ?? hashProjectSourceFile;
  const freshness = Effect.fn("ProjectContextSources.freshness")(function* (
    filePath: string,
    expectedHash: string,
  ) {
    if (!isSafeProjectSourcePath(filePath)) return "unknown" as const;
    if (!hashes.has(filePath)) {
      if (hashes.size >= MAX_SOURCE_FILES_PER_QUERY) return "unknown" as const;
      const hash = yield* readHash(input.workspaceRoot, filePath).pipe(
        Effect.match({
          onSuccess: (hash): SourceHashCheck => ({ status: "read", hash }),
          onFailure: (error): SourceHashCheck => ({ status: sourceReadFailureFreshness(error) }),
        }),
      );
      hashes.set(filePath, hash);
    }
    const hash = hashes.get(filePath);
    return hash?.status !== "read"
      ? (hash?.status ?? ("unknown" as const))
      : hash.hash === expectedHash
        ? ("current" as const)
        : ("stale" as const);
  });

  const validate = Effect.fn("ProjectContextSources.validate")(function* (
    record: ProjectContextRecord,
    allowRelatedPaths = false,
    applicableEntityIds?: ReadonlyArray<string>,
  ) {
    if (
      (record.provenance !== "parser" && record.provenance !== "compiler") ||
      "errorPaths" in record ||
      "entryEntityIds" in record ||
      ("appliesToEntityIds" in record &&
        (record.source !== "explicit" || record.provenance !== "parser"))
    ) {
      return { record: null, evidence: [], gaps: [] };
    }
    const references = new Map<string, ProjectEvidenceV1>();
    const originalEvidence: ProjectEvidenceV1[] = [];
    let missingReference = false;
    const entityIds = [...new Set(projectContextRecordEntityIds(record))];
    const evidenceIds = [...new Set(record.evidenceIds)];
    if (
      entityIds.length > MAX_RECORD_REFERENCES ||
      evidenceIds.length > MAX_RECORD_REFERENCES ||
      ("filePaths" in record && record.filePaths.length > MAX_RECORD_REFERENCES)
    ) {
      return {
        record: null,
        evidence: [],
        gaps: [
          projectContextGap(
            `sources:${record.id}`,
            "This record has too many source references for one answer. Narrow the entity or module scope.",
            "limit",
          ),
        ],
      };
    }
    if ("filePath" in record) {
      if (
        !isSafeProjectSourcePath(record.filePath) ||
        (!allowRelatedPaths && !isWithinWorkspaceContextScopes(record.filePath, input.scopes))
      ) {
        return { record: null, evidence: [], gaps: [] };
      }
      const evidence = sourceReference(record);
      references.set(evidence.id, evidence);
    }
    for (const evidenceId of evidenceIds) {
      const evidence = yield* input.reader.getRecord("evidence", evidenceId, input.revision);
      if (
        !evidence ||
        evidence.provenance === "llm" ||
        !isSafeProjectSourcePath(evidence.filePath)
      ) {
        missingReference = true;
        continue;
      }
      const reference = sourceReference(evidence);
      references.set(reference.id, reference);
      originalEvidence.push(reference);
    }
    for (const entityId of entityIds) {
      const entity = yield* input.reader.getRecord("entities", entityId, input.revision);
      if (!entity || !isSafeProjectSourcePath(entity.filePath)) {
        missingReference = true;
        continue;
      }
      const reference = sourceReference(entity);
      references.set(reference.id, reference);
    }
    if ("filePaths" in record) {
      for (const filePath of record.filePaths) {
        if (!isSafeProjectSourcePath(filePath)) {
          missingReference = true;
          continue;
        }
        const file = yield* input.reader.getRecord("files", filePath, input.revision);
        if (!file) {
          missingReference = true;
          continue;
        }
        if (
          [...references.values()].some(
            (source) => source.filePath === filePath && source.sourceHash === file.contentHash,
          )
        )
          continue;
        const reference = sourceReference({
          filePath,
          sourceHash: file.contentHash,
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          provenance: record.provenance,
        });
        references.set(reference.id, reference);
      }
    }
    let evidence = [...references.values()];
    if ("appliesToEntityIds" in record && originalEvidence.length === 0) {
      return {
        record: null,
        evidence: [],
        gaps: [
          projectContextGap(
            `rule-source:${record.id}`,
            "An explicit rule has no readable original source reference. Read its original rule file.",
            "incomplete-analysis",
          ),
        ],
      };
    }
    if (evidence.length > MAX_RECORD_REFERENCES) {
      return {
        record: null,
        evidence: [],
        gaps: [
          projectContextGap(
            `sources:${record.id}`,
            "This record needs more source references than fit in one answer. Narrow the module or entity scope.",
            "limit",
          ),
        ],
      };
    }
    if (
      evidence.length === 0 ||
      (!allowRelatedPaths &&
        input.restrictEvidenceToScopes !== false &&
        evidence.some((source) => !isWithinWorkspaceContextScopes(source.filePath, input.scopes)))
    ) {
      return {
        record: null,
        evidence: [],
        gaps:
          evidence.length === 0
            ? [
                projectContextGap(
                  `sources:${record.id}`,
                  "Indexed knowledge has no available source reference and was omitted.",
                  "incomplete-analysis",
                ),
              ]
            : [],
      };
    }
    const dependencies = yield* readDependencies(record);
    missingReference ||= dependencies.missingReference;
    const dependencySources = dependencies.files.map((file) =>
      sourceReference({
        filePath: file.path,
        sourceHash: file.contentHash,
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        provenance: record.provenance,
      }),
    );
    for (const source of dependencySources) {
      const visible =
        allowRelatedPaths ||
        input.restrictEvidenceToScopes === false ||
        isWithinWorkspaceContextScopes(source.filePath, input.scopes);
      if (
        visible &&
        !evidence.some(
          (existing) =>
            existing.filePath === source.filePath && existing.sourceHash === source.sourceHash,
        )
      ) {
        references.set(source.id, source);
      }
    }
    evidence = [...references.values()].slice(0, MAX_RECORD_REFERENCES);
    let status: ProjectIndexFreshness =
      record.freshness === "missing" ? "unknown" : record.freshness;
    if (missingReference || dependencies.incomplete || references.size > MAX_RECORD_REFERENCES) {
      status = combineFreshness(status, "unknown");
    }
    if (dependencies.invalidated) status = combineFreshness(status, "stale");
    const gaps: ProjectIndexGapV1[] = missingReference
      ? [
          projectContextGap(
            `unverified:${record.id}`,
            "Some indexed source references are unavailable. The record cannot be treated as current.",
            "incomplete-analysis",
          ),
        ]
      : [];
    if (dependencies.incomplete || references.size > MAX_RECORD_REFERENCES) {
      gaps.push(
        projectContextGap(
          `dependency-limit:${record.id}`,
          "Recorded dependencies exceeded this answer's verification limits. The record cannot be treated as current.",
          "limit",
        ),
      );
    }
    if (dependencies.invalidated) {
      gaps.push(
        projectContextGap(
          `dependency-invalidated:${record.id}`,
          "An indexed dependency was invalidated. Refresh the index or read original sources before relying on this record.",
          "stale-source",
        ),
      );
    }
    for (const filePath of dependencies.missingPaths) {
      const visible =
        allowRelatedPaths ||
        input.restrictEvidenceToScopes === false ||
        isWithinWorkspaceContextScopes(filePath, input.scopes);
      gaps.push(
        projectContextGap(
          `dependency-unverified:${visible ? filePath : record.id}`,
          "An indexed dependency has no readable source snapshot. The record cannot be treated as current.",
          "incomplete-analysis",
          visible ? filePath : undefined,
        ),
      );
    }
    const sourceChecks = new Map<string, ProjectIndexFreshness>();
    for (const source of [...evidence, ...dependencySources]) {
      const current = yield* freshness(source.filePath, source.sourceHash);
      sourceChecks.set(
        source.filePath,
        combineFreshness(sourceChecks.get(source.filePath) ?? "current", current),
      );
      if (current !== "current") {
        status = combineFreshness(status, current);
        const visible =
          allowRelatedPaths ||
          input.restrictEvidenceToScopes === false ||
          isWithinWorkspaceContextScopes(source.filePath, input.scopes);
        gaps.push(
          projectContextGap(
            `${current}:${visible ? source.filePath : record.id}`,
            current === "missing"
              ? "Indexed source is absent. Read original files before relying on this record."
              : current === "unknown"
                ? "Indexed source could not be verified safely within this answer's limits. Its freshness is unknown."
                : "Indexed source has changed. Read original code before relying on this record.",
            current === "unknown" ? "incomplete-analysis" : "stale-source",
            visible ? source.filePath : undefined,
          ),
        );
      }
    }
    for (const filePath of dependencies.missingPaths) {
      if (!sourceChecks.has(filePath)) sourceChecks.set(filePath, "unknown");
    }
    const checked = {
      ...record,
      freshness: status,
      evidenceIds: evidence.map((source) => source.id),
      ...("appliesToEntityIds" in record && applicableEntityIds !== undefined
        ? {
            appliesToEntityIds: [
              ...new Set([...record.appliesToEntityIds, ...applicableEntityIds]),
            ],
          }
        : {}),
    };
    checksByRecord.set(checked, sourceChecks);
    return { record: checked, evidence, gaps };
  });

  const verificationFor = (
    records: ReadonlyArray<ProjectContextRecord>,
  ): ProjectIndexQueryVerificationV1 => {
    const sources = new Map<string, ProjectIndexFreshness>();
    for (const record of records) {
      for (const [filePath, status] of checksByRecord.get(record) ?? []) {
        sources.set(filePath, combineFreshness(sources.get(filePath) ?? "current", status));
      }
    }
    const counts = { matchedFiles: 0, changedFiles: 0, missingFiles: 0, unverifiedFiles: 0 };
    for (const status of sources.values()) {
      switch (status) {
        case "current":
          counts.matchedFiles += 1;
          break;
        case "stale":
          counts.changedFiles += 1;
          break;
        case "missing":
          counts.missingFiles += 1;
          break;
        case "unknown":
          counts.unverifiedFiles += 1;
          break;
      }
    }
    const classified = counts.matchedFiles + counts.changedFiles + counts.missingFiles;
    return {
      context: "provided",
      sourceHashes: {
        ...counts,
        state:
          classified === 0 ? "unavailable" : counts.unverifiedFiles > 0 ? "partial" : "complete",
      },
      checks: "not-run",
    };
  };

  return { validate, verificationFor };
}
