// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { ProjectId, type ProjectIndexScopeV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EvaluationCorpus,
  type EvaluationCase,
} from "../../../../../scripts/evaluate-project-indexing.ts";
import * as DateTime from "effect/DateTime";
import { resolveProject, scanInventory } from "../extraction/index.ts";
import type { KnowledgeBatch, KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { liveProjectIndexExtraction } from "../runtime/ProjectIndexingExtraction.ts";
import { encodeProjectIndexJson } from "../runtime/ProjectIndexingErrors.ts";
import { initialProjectIndexGenerationMetadata } from "../runtime/ProjectIndexingMetadata.ts";
const decodeCorpus = Schema.decodeSync(Schema.fromJsonString(EvaluationCorpus));

export async function readSyntheticIndexCorpus() {
  return decodeCorpus(
    await NodeFSP.readFile(
      new URL("../../../../../scripts/project-indexing-evaluation/cases.json", import.meta.url),
      "utf8",
    ),
  );
}

export async function extractSyntheticIndexFixture(
  root: string,
  files: EvaluationCase["failure"]["files"],
): Promise<KnowledgeBatch> {
  for (const file of files) {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, file.path)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, file.path), file.content);
  }
  const inventory = await scanInventory(root, { batchSize: 200 });
  if (!inventory.done)
    throw new Error("Synthetic fixture unexpectedly exceeds one inventory page.");
  const extracted = await Promise.all(
    inventory.files
      .filter((file) => file.status === "pending")
      .map((file) => Effect.runPromise(liveProjectIndexExtraction.extract(root, file))),
  );
  const indexedFiles = extracted.flatMap((batch) => batch.files ?? []);
  const entities = extracted.flatMap((batch) => batch.entities ?? []);
  const semantic = await resolveProject({
    root,
    files: indexedFiles,
    entities,
    callsites: extracted.flatMap((batch) => batch.callsites ?? []),
    typescriptMode: "compatible",
  });
  return {
    files: indexedFiles,
    entities,
    callsites: semantic.callsites,
    imports: extracted.flatMap((batch) => batch.imports ?? []),
    modules: extracted.flatMap((batch) => batch.modules ?? []),
    rules: extracted.flatMap((batch) => batch.rules ?? []),
    evidence: extracted.flatMap((batch) => batch.evidence ?? []),
    gaps: [...extracted.flatMap((batch) => batch.gaps ?? []), ...semantic.gaps],
  };
}

export const publishSyntheticIndexFixture = Effect.fn("publishSyntheticIndexFixture")(function* (
  store: KnowledgeStore,
  batch: KnowledgeBatch,
  key: string,
  knowledgeFormat: "static-v1" | "legacy-ai" = "static-v1",
) {
  const previous = yield* store.getState();
  if (!previous.settings.enabled) yield* store.setSettings({ ...previous.settings, enabled: true });
  const lease = yield* store.acquireLease(`synthetic:${key}`);
  const { revision } = yield* store.beginGeneration({
    lease,
    expectedRevision: previous.revision,
    idempotencyKey: key,
    copyPublished: false,
  });
  if (knowledgeFormat === "static-v1")
    yield* store.setGenerationMetadata({
      lease,
      revision,
      metadataJson: encodeProjectIndexJson(
        initialProjectIndexGenerationMetadata({
          kind: "initial",
          manual: true,
          startedAt: DateTime.formatIso(yield* DateTime.now),
        }),
      ),
    });
  yield* store.applyBatch({ lease, revision, batch });
  yield* store.publishGeneration({ lease, revision });
  yield* store.releaseLease(lease);
  return revision;
});

export function syntheticIndexScope(store: KnowledgeStore): ProjectIndexScopeV1 {
  return {
    projectId: ProjectId.make("synthetic-project"),
    scopeId: `scope:${store.workspace.workspaceId}`,
    workspaceFingerprint: store.workspace.workspaceId,
  };
}
