import type { ProjectRuleV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as References from "effect/References";

import {
  extractFile,
  readSourceUnit,
  resolveProject,
  resolveProjectBatches,
  scanInventory,
} from "../extraction/index.ts";
import { rangeFromOffsets, stableId } from "../extraction/source.ts";
import type { KnowledgeBatch } from "../persistence/KnowledgeStoreTypes.ts";
import { asProjectIndexRuntimeError } from "./ProjectIndexingErrors.ts";
import type { ProjectIndexExtractionBridge } from "./ProjectIndexingPipeline.ts";
import { listExtractedProjectFiles } from "./ProjectIndexingRecords.ts";

const InventoryCursor = Schema.Struct({
  version: Schema.Literal(1),
  root: Schema.String,
  stack: Schema.Array(
    Schema.Struct({ directory: Schema.String, after: Schema.NullOr(Schema.String) }),
  ),
});
const decodeInventoryCursor = Schema.decodeUnknownEffect(InventoryCursor);
const asError = asProjectIndexRuntimeError;
const MAX_RULE_PART_LENGTH = 16_000;
const MAX_EVIDENCE_LENGTH = 2_000;

export const liveProjectIndexExtraction: ProjectIndexExtractionBridge = {
  scan: Effect.fn("ProjectIndexExtraction.scan")(function* (root, cursor) {
    const decoded =
      cursor === null
        ? undefined
        : yield* decodeInventoryCursor(cursor).pipe(Effect.mapError(asError));
    const page = yield* Effect.tryPromise({
      try: (signal) =>
        scanInventory(root, {
          ...(decoded === undefined
            ? {}
            : { cursor: { ...decoded, stack: decoded.stack.map((frame) => ({ ...frame })) } }),
          batchSize: 128,
          signal,
        }),
      catch: asError,
    });
    return {
      ...page,
      files: page.files,
      gaps: page.gaps,
      nextCursor: page.nextCursor ?? null,
    };
  }),
  extract: Effect.fn("ProjectIndexExtraction.extract")(function* (root, file) {
    const extracted = yield* Effect.tryPromise({
      try: (signal) => extractFile({ root, file, signal }),
      catch: asError,
    });
    const batch: KnowledgeBatch = {
      files: [extracted.file],
      entities: extracted.entities,
      callsites: extracted.callsites,
      imports: extracted.imports,
      modules: extracted.modules,
      evidence: extracted.evidence,
      gaps: extracted.gaps,
    };
    if (file.classification !== "rule" || extracted.file.status !== "indexed") return batch;
    const source = yield* Effect.tryPromise({
      try: (signal) =>
        readSourceUnit({ root, filePath: file.path, expectedHash: file.contentHash, signal }),
      catch: asError,
    });
    const rules: ProjectRuleV1[] = [];
    const evidence: NonNullable<KnowledgeBatch["evidence"]>[number][] = [...extracted.evidence];
    for (let start = 0; start < source.length; start += MAX_RULE_PART_LENGTH) {
      const end = Math.min(source.length, start + MAX_RULE_PART_LENGTH);
      const evidenceEnd = Math.min(end, start + MAX_EVIDENCE_LENGTH);
      const evidenceId = stableId("rule-evidence", file.path, file.contentHash, String(start));
      evidence.push({
        id: evidenceId,
        filePath: file.path,
        sourceHash: file.contentHash,
        range: rangeFromOffsets(source, start, evidenceEnd),
        excerpt: source.slice(start, evidenceEnd),
        provenance: "parser",
      });
      rules.push({
        id: stableId("rule", file.path, file.contentHash, String(start)),
        name: `${file.path} (${Math.floor(start / MAX_RULE_PART_LENGTH) + 1})`,
        description: source.slice(start, end),
        severity: "info",
        source: "explicit",
        appliesToEntityIds: extracted.entities
          .filter((entity) => entity.kind === "file")
          .map((entity) => entity.id),
        evidenceIds: [evidenceId],
        provenance: "parser",
        freshness: "current",
      });
    }
    return { ...batch, rules, evidence };
  }),
  resolve: (input) =>
    Effect.tryPromise({
      try: (signal) =>
        resolveProject({
          ...input,
          files: [...input.files],
          entities: [...input.entities],
          callsites: [...input.callsites],
          signal,
        }),
      catch: asError,
    }),
  resolveBatches: ({ root, store, revision }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        const runRead = <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.runPromise(effect.pipe(Effect.provideService(References.TracerEnabled, false)));
        return Stream.fromAsyncIterable(
          resolveProjectBatches({
            root,
            signal: controller.signal,
            reader: {
              files: (languages, afterId, limit) =>
                runRead(
                  listExtractedProjectFiles(store, revision, afterId, limit).pipe(
                    Effect.map((page) => ({
                      ...page,
                      items: page.items.filter((file) => languages.includes(file.language)),
                    })),
                  ),
                ),
              callsites: (filePath, afterId, limit) =>
                runRead(
                  store.listRecords({
                    kind: "callsites",
                    revision,
                    sourceFilePath: filePath,
                    limit,
                    ...(afterId === undefined ? {} : { afterId }),
                  }),
                ),
              file: (filePath) =>
                runRead(
                  store
                    .getRecord("files", filePath, revision)
                    .pipe(Effect.map((file) => file ?? undefined)),
                ),
              callsitesAt: (locations) => runRead(store.getCallsitesAt({ revision, locations })),
              target: (location) =>
                runRead(
                  store
                    .getDeclarationTarget({ revision, ...location })
                    .pipe(Effect.map((entity) => entity ?? undefined)),
                ),
            },
          }),
          asError,
        );
      }),
    ),
  readSource: (root, filePath, expectedHash) =>
    Effect.tryPromise({
      try: (signal) => readSourceUnit({ root, filePath, expectedHash, signal }),
      catch: asError,
    }),
};
