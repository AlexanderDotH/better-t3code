import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DeepPlanReadSourceChunkResult,
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  MessageId,
  ProjectId,
  ThreadId,
  type ChatAttachment,
  type DeepPlanSourceRecord,
  type DeepPlanSourceSnapshot,
  type DeepPlanDocument,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  canonicalSourceJson,
  sourceChunkHash,
  sourceManifestHasher,
  sourceRecordContentHash,
  sourceRecordId,
} from "./DeepPlanSourceContent.ts";
import { DeepPlanSources, DeepPlanSourcesLive, makeDeepPlanSources } from "./DeepPlanSources.ts";

const at = "2026-10-16T10:00:00.000Z";
const decodeSourceChunk = Schema.decodeUnknownEffect(DeepPlanReadSourceChunkResult);
const environmentId = EnvironmentId.make("deep-plan-source-test-environment");
const descriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)({
  environmentId,
  label: "Source test",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "test",
  orchestrationProtocolVersion: 1,
  capabilities: {},
});
const TestLayer = DeepPlanSourcesLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-deep-plan-sources-test-" }),
  ),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment, {
      getEnvironmentId: Effect.succeed(environmentId),
      getDescriptor: Effect.succeed(descriptor),
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

let fixtureCount = 0;
const seedProject = Effect.fnUntraced(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectId = ProjectId.make(`deep-source-project-${fixtureCount++}`);
  yield* sql`
    INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES (${projectId}, 'Source project', '/tmp/source-project', '[]', ${at}, ${at})
  `;
  return projectId;
});

const seedThread = Effect.fnUntraced(function* (
  projectId: ProjectId,
  name: string,
  archived = false,
  deleted = false,
) {
  const sql = yield* SqlClient.SqlClient;
  const threadId = ThreadId.make(`${projectId}-${name}`);
  yield* sql`
    INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode,
      interaction_mode, created_at, updated_at, archived_at, deleted_at)
    VALUES (${threadId}, ${projectId}, ${name}, '{"instanceId":"codex","model":"test"}',
      'full-access', 'default', ${at}, ${at}, ${archived ? at : null}, ${deleted ? at : null})
  `;
  return threadId;
});

const seedMessage = Effect.fnUntraced(function* (input: {
  readonly threadId: ThreadId;
  readonly id: string;
  readonly text: string;
  readonly streaming?: boolean;
  readonly role?: "user" | "assistant";
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly historyOrigin?: {
    readonly sourceThreadId: ThreadId;
    readonly sourceId: string;
    readonly ordinal: number;
  };
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming,
      attachments_json, history_origin_json, created_at, updated_at)
    VALUES (${input.id}, ${input.threadId}, ${input.role ?? "user"}, ${input.text}, ${input.streaming ? 1 : 0},
      ${input.attachments === undefined ? null : canonicalSourceJson(input.attachments)},
      ${input.historyOrigin === undefined ? null : canonicalSourceJson(input.historyOrigin)}, ${at}, ${at})
  `;
});

function remoteFixture(name: string, texts: ReadonlyArray<string>) {
  const origin = {
    environmentId: EnvironmentId.make("remote-source-environment"),
    projectId: ProjectId.make("remote-source-project"),
    threadId: ThreadId.make(name),
  };
  const records = texts.map((text, index): DeepPlanSourceRecord => {
    const record: DeepPlanSourceRecord = {
      kind: "message",
      recordId: "",
      contentHash: "",
      origin: { ...origin, recordId: `message-${index}` },
      message: {
        id: MessageId.make(`message-${index}`),
        role: "user",
        text,
        streaming: false,
        turnId: null,
        createdAt: at,
        updatedAt: at,
      },
    };
    const contentHash = sourceRecordContentHash(record);
    return { ...record, contentHash, recordId: sourceRecordId(record.origin, contentHash) };
  });
  const manifest = sourceManifestHasher();
  records.forEach(manifest.add);
  const contentHash = manifest.finish();
  const snapshot: DeepPlanSourceSnapshot = {
    sourceId: DeepPlanSourceId.make(`remote-${name}`),
    origin,
    projectTitle: "Remote",
    threadTitle: name,
    archived: false,
    capturedAt: at,
    contentVersion: contentHash,
    contentHash,
    messageCount: records.length,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: records.length,
    forkOrigin: null,
  };
  return { snapshot, records };
}

function identifyRecord(record: DeepPlanSourceRecord): DeepPlanSourceRecord {
  const contentHash = sourceRecordContentHash(record);
  return { ...record, contentHash, recordId: sourceRecordId(record.origin, contentHash) };
}

function fixtureWithRecords(
  snapshot: DeepPlanSourceSnapshot,
  records: ReadonlyArray<DeepPlanSourceRecord>,
) {
  const manifest = sourceManifestHasher();
  records.forEach(manifest.add);
  const contentHash = manifest.finish();
  return { ...snapshot, contentHash, contentVersion: contentHash, recordCount: records.length };
}

function summary(citedRecordIds: ReadonlyArray<string> = []) {
  return {
    requirements: ["Preserve the requirements"],
    decisions: [],
    openIssues: [],
    rejectedApproaches: [],
    conflicts: [],
    citedRecordIds,
  };
}

const initializeRemoteCollection = Effect.fnUntraced(function* (
  runId: DeepPlanRunId,
  snapshots: ReadonlyArray<DeepPlanSourceSnapshot>,
) {
  const sources = yield* DeepPlanSources;
  const projectId = yield* seedProject();
  const threadId = yield* seedThread(projectId, `target-${runId}`);
  const local = yield* sources.exportSources({ projectId, includeArchived: true });
  yield* sources.initializeSources({
    threadId,
    runId,
    localExportId: local.exportId,
    snapshots: [...snapshots, ...local.sources],
  });
  for (const snapshot of local.sources)
    yield* sources.summarizeSource({
      threadId,
      runId,
      sourceId: snapshot.sourceId,
      expectedContentHash: snapshot.contentHash,
      summary: summary(),
    });
  return threadId;
});

it.layer(TestLayer)("DeepPlanSources", (it) => {
  it.effect(
    "lists archived chats without freezing, excludes deleted chats, and freezes a consistent paged catalog",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const sql = yield* SqlClient.SqlClient;
        const projectId = yield* seedProject();
        const first = yield* seedThread(projectId, "active");
        const archived = yield* seedThread(projectId, "archived", true);
        yield* seedThread(projectId, "deleted", false, true);
        yield* seedMessage({ threadId: first, id: `${first}-message`, text: "Frozen requirement" });
        yield* seedMessage({
          threadId: first,
          id: `${first}-partial`,
          text: "Not finished",
          role: "assistant",
          streaming: true,
        });
        const catalog = yield* sources.catalogSources({
          projectId,
          includeArchived: true,
          limit: 1,
        });
        assert.equal(catalog.sources[0]?.origin.threadId, first);
        assert.isNotNull(catalog.nextCursor);
        const secondCatalog = yield* sources.catalogSources({
          projectId,
          includeArchived: true,
          cursor: catalog.nextCursor!,
          limit: 1,
        });
        assert.equal(secondCatalog.sources[0]?.origin.threadId, archived);
        assert.equal(
          (yield* sql`SELECT 1 FROM deep_plan_source_exports WHERE project_id = ${projectId}`)
            .length,
          0,
        );
        const exported = yield* sources.exportSources({
          projectId,
          includeArchived: true,
          limit: 1,
        });
        assert.equal(exported.sources[0]?.messageCount, 1);
        yield* sql`UPDATE projection_thread_messages SET text = 'Edited later' WHERE thread_id = ${first}`;
        yield* sql`UPDATE projection_threads SET deleted_at = ${at} WHERE thread_id = ${archived}`;
        const next = yield* sources.exportSources({
          projectId,
          includeArchived: true,
          exportId: exported.exportId,
          cursor: exported.nextCursor!,
          limit: 1,
        });
        assert.equal(next.sources[0]?.origin.threadId, archived);
        assert.isTrue(next.sources[0]!.archived);
        assert.equal(next.capturedAt, exported.capturedAt);
        const chunk = yield* sources.readExportChunk({
          exportId: exported.exportId,
          sourceId: exported.sources[0]!.sourceId,
        });
        assert.equal(
          chunk.records[0]?.kind === "message" ? chunk.records[0].message.text : "",
          "Frozen requirement",
        );
        assert.equal(chunk.records.length, 1);
      }),
  );

  it.effect(
    "deduplicates inherited content by original project and row while retaining edited fork versions",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const sql = yield* SqlClient.SqlClient;
        const projectId = yield* seedProject();
        const sourceProjectId = yield* seedProject();
        const original = yield* seedThread(sourceProjectId, "original");
        const fork = yield* seedThread(projectId, "fork");
        const edited = yield* seedThread(projectId, "edited");
        const originalId = `${original}-message`;
        yield* seedMessage({ threadId: original, id: originalId, text: "Original content" });
        yield* seedMessage({
          threadId: fork,
          id: `${fork}-copy`,
          text: "Original content",
          historyOrigin: { sourceThreadId: original, sourceId: originalId, ordinal: 0 },
        });
        yield* seedMessage({
          threadId: edited,
          id: `${edited}-copy`,
          text: "Edited content",
          historyOrigin: { sourceThreadId: original, sourceId: originalId, ordinal: 0 },
        });
        const parentExport = yield* sources.exportSources({
          projectId: sourceProjectId,
          includeArchived: true,
        });
        const forkExport = yield* sources.exportSources({ projectId, includeArchived: true });
        const originalChunk = yield* sources.readExportChunk({
          exportId: parentExport.exportId,
          sourceId: parentExport.sources[0]!.sourceId,
        });
        const inherited = forkExport.sources.find((source) => source.origin.threadId === fork)!;
        const editedSource = forkExport.sources.find(
          (source) => source.origin.threadId === edited,
        )!;
        const inheritedChunk = yield* sources.readExportChunk({
          exportId: forkExport.exportId,
          sourceId: inherited.sourceId,
        });
        const editedChunk = yield* sources.readExportChunk({
          exportId: forkExport.exportId,
          sourceId: editedSource.sourceId,
        });
        assert.equal(inheritedChunk.records[0]?.origin.projectId, sourceProjectId);
        assert.equal(inheritedChunk.records[0]?.recordId, originalChunk.records[0]?.recordId);
        assert.notEqual(editedChunk.records[0]?.recordId, originalChunk.records[0]?.recordId);
        const distinct = yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM deep_plan_source_contents WHERE origin_key = ${canonicalSourceJson(originalChunk.records[0]!.origin)}`;
        assert.equal(distinct[0]?.count, 2);
      }),
  );

  it.effect(
    "paginates every message of a large history with tied timestamps without duplicates or silent limits",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const projectId = yield* seedProject();
        const threadId = yield* seedThread(projectId, "large");
        for (let index = 0; index < 365; index += 1)
          yield* seedMessage({
            threadId,
            id: `${threadId}-${index.toString().padStart(4, "0")}`,
            text: `Requirement ${index}`,
          });
        const exported = yield* sources.exportSources({ projectId, includeArchived: true });
        const snapshot = exported.sources[0]!;
        assert.equal(snapshot.messageCount, 365);
        let cursor: string | undefined;
        const records: string[] = [];
        do {
          const chunk = yield* sources.readExportChunk({
            exportId: exported.exportId,
            sourceId: snapshot.sourceId,
            cursor,
            limit: 37,
          });
          records.push(...chunk.records.map((record) => record.recordId));
          cursor = chunk.nextCursor ?? undefined;
        } while (cursor !== undefined);
        assert.equal(records.length, 365);
        assert.equal(new Set(records).size, 365);
      }),
  );

  it.effect(
    "imports idempotent ordered chunks durably and refuses incomplete histories and coverage",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const remote = remoteFixture("import-retry", ["One", "Two"]);
        const runId = DeepPlanRunId.make("run-import-retry");
        const threadId = yield* initializeRemoteCollection(runId, [remote.snapshot]);
        const input = {
          threadId,
          runId,
          snapshot: remote.snapshot,
          chunkIndex: 0,
          records: remote.records.slice(0, 1),
          chunkHash: sourceChunkHash(remote.records.slice(0, 1)),
          finalChunk: false,
        };
        const first = yield* sources.importSourceChunk(input);
        assert.equal(first.importedRecordCount, 1);
        assert.deepStrictEqual(yield* sources.importSourceChunk(input), first);
        assert.equal(
          (yield* sources.importSourceChunk({ ...input, chunkIndex: 2 }).pipe(Effect.flip)).code,
          "invalid-chunk",
        );
        assert.equal(
          (yield* sources
            .importSourceChunk({
              ...input,
              chunkIndex: 1,
              finalChunk: true,
              records: [],
              chunkHash: sourceChunkHash([]),
            })
            .pipe(Effect.flip)).code,
          "incomplete-source",
        );
        assert.equal(
          (yield* sources.assertCompleteCoverage(runId).pipe(Effect.flip)).code,
          "incomplete-source",
        );
        yield* sources.importSourceChunk({
          ...input,
          chunkIndex: 1,
          records: remote.records.slice(1),
          chunkHash: sourceChunkHash(remote.records.slice(1)),
          finalChunk: true,
        });
        const restarted = yield* makeDeepPlanSources;
        const page = yield* restarted.readSourceChunk({
          threadId,
          runId,
          sourceId: remote.snapshot.sourceId,
          limit: 1,
          includeBodies: false,
        });
        assert.equal(
          page.records[0]?.kind === "message" ? page.records[0].message.text : "",
          "One",
        );
        const summarize = {
          threadId,
          runId,
          sourceId: remote.snapshot.sourceId,
          expectedContentHash: remote.snapshot.contentHash,
          summary: summary([remote.records[0]!.recordId]),
        };
        assert.equal(
          (yield* restarted.summarizeSource(summarize).pipe(Effect.flip)).code,
          "incomplete-source",
        );
        yield* restarted.readSourceChunk({
          threadId,
          runId,
          sourceId: remote.snapshot.sourceId,
          cursor: page.nextCursor!,
          includeBodies: false,
        });
        assert.equal((yield* restarted.summarizeSource(summarize)).status, "summarized");
        const plan: DeepPlanDocument = {
          schemaVersion: 1,
          version: 1,
          goal: "Use frozen requirements",
          scope: ["Tests"],
          decisions: [],
          affectedAreas: [],
          steps: [
            {
              id: "step",
              title: "Implement",
              description: "Use the source",
              dependencies: [],
              acceptanceCriteria: [
                {
                  id: "criterion",
                  description: "Requirement is met",
                  checkMethod: "Inspection",
                  sources: [
                    {
                      sourceId: remote.snapshot.sourceId,
                      recordIds: [remote.records[0]!.recordId],
                    },
                  ],
                },
              ],
            },
          ],
          finalValidation: { description: "Validate", checkMethod: "Tests" },
        };
        yield* restarted.validatePlanCitations(runId, plan);
        const invalid = {
          ...plan,
          decisions: [
            {
              id: "invalid",
              text: "Unknown citation",
              sources: [{ sourceId: remote.snapshot.sourceId, recordIds: ["foreign-record"] }],
            },
          ],
        };
        assert.equal(
          (yield* restarted.validatePlanCitations(runId, invalid).pipe(Effect.flip)).code,
          "content-mismatch",
        );
        assert.equal(
          (yield* restarted.assertCompleteCoverage(runId)).coverage[0]?.readRecordCount,
          2,
        );
        assert.equal(
          (yield* restarted
            .summarizeSource({ ...summarize, summary: summary([]) })
            .pipe(Effect.flip)).code,
          "content-mismatch",
        );
        assert.equal(
          (yield* restarted
            .listSources({ threadId: ThreadId.make("foreign"), runId })
            .pipe(Effect.flip)).code,
          "run-not-found",
        );
      }),
  );

  it.effect(
    "keeps missing selected sources visible and blocks approval after other sources finish",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const ready = remoteFixture("selected-ready", []);
        const missing = remoteFixture("selected-missing", ["Unavailable"]);
        const runId = DeepPlanRunId.make("run-missing");
        const threadId = yield* initializeRemoteCollection(runId, [
          ready.snapshot,
          missing.snapshot,
        ]);
        yield* sources.importSourceChunk({
          threadId,
          runId,
          snapshot: ready.snapshot,
          chunkIndex: 0,
          chunkHash: sourceChunkHash([]),
          records: [],
          finalChunk: true,
        });
        yield* sources.summarizeSource({
          threadId,
          runId,
          sourceId: ready.snapshot.sourceId,
          expectedContentHash: ready.snapshot.contentHash,
          summary: summary(),
        });
        const state = yield* sources.listSources({ threadId, runId });
        assert.equal(
          state.coverage.filter((coverage) => coverage.status === "summarized").length,
          2,
        );
        assert.equal(state.coverage.length, 3);
        assert.equal(
          (yield* sources.assertCompleteCoverage(runId).pipe(Effect.flip)).sourceId,
          missing.snapshot.sourceId,
        );
      }),
  );

  it.effect(
    "freezes attachment bytes once and lets analysis read one reference before an optional body read",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectId = yield* seedProject();
        const threadId = yield* seedThread(projectId, "attachment");
        const bytes = Buffer.alloc(120_000, 7);
        const attachment: ChatAttachment = {
          type: "file",
          id: `${threadId}-file`,
          name: "notes.bin",
          mimeType: "application/octet-stream",
          sizeBytes: bytes.length,
        };
        const path = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment })!;
        yield* fs.writeFile(path, bytes);
        yield* seedMessage({
          threadId,
          id: `${threadId}-message`,
          text: "Review the attachment if needed",
          attachments: [attachment],
        });
        const exported = yield* sources.exportSources({ projectId, includeArchived: true });
        const snapshot = exported.sources[0]!;
        const runId = DeepPlanRunId.make(`${threadId}-run`);
        yield* sources.initializeSources({ threadId, runId, snapshots: [snapshot] });
        yield* fs.remove(path);
        const page = yield* sources.readSourceChunk({
          threadId,
          runId,
          sourceId: snapshot.sourceId,
          includeBodies: false,
        });
        assert.isNull(page.nextCursor);
        assert.equal(page.records.length, 2);
        const reference = page.records.find((record) => record.kind === "content-reference");
        assert.isDefined(reference);
        if (reference?.kind !== "content-reference") return;
        assert.equal(reference.byteLength, bytes.length);
        assert.isDefined(reference.cursor);
        yield* sources.summarizeSource({
          threadId,
          runId,
          sourceId: snapshot.sourceId,
          expectedContentHash: snapshot.contentHash,
          summary: summary([page.records[0]!.recordId]),
        });
        assert.equal(
          (yield* sources.assertCompleteCoverage(runId)).coverage[0]?.readRecordCount,
          snapshot.recordCount,
        );
        const body = yield* sources.readSourceChunk({
          threadId,
          runId,
          sourceId: snapshot.sourceId,
          cursor: reference.cursor!,
          includeBodies: true,
        });
        const restored = Buffer.concat(
          body.records
            .filter((record) => record.kind === "attachment")
            .map((record) => Buffer.from(record.dataBase64, "base64")),
        );
        assert.deepStrictEqual(restored, bytes);
      }),
  );

  it.effect(
    "keeps all giant message text required while exposing a giant tool payload through a bounded reference",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const sql = yield* SqlClient.SqlClient;
        const projectId = yield* seedProject();
        const threadId = yield* seedThread(projectId, "giant");
        const text = "Read every detail 🧠\n".repeat(12_000);
        yield* seedMessage({ threadId, id: `${threadId}-message`, text });
        yield* sql`
      INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES (${`${threadId}-tool`}, ${threadId}, 'tool', 'tool.completed', 'Large inspection output',
        ${canonicalSourceJson({ output: "tool data".repeat(30_000) })}, ${at})
    `;
        const exported = yield* sources.exportSources({ projectId, includeArchived: true });
        const snapshot = exported.sources[0]!;
        const runId = DeepPlanRunId.make(`${threadId}-run`);
        yield* sources.initializeSources({ threadId, runId, snapshots: [snapshot] });
        let cursor: string | undefined;
        const textChunks: string[] = [];
        let references = 0;
        do {
          const page = yield* sources.readSourceChunk({
            threadId,
            runId,
            sourceId: snapshot.sourceId,
            cursor,
            includeBodies: false,
            limit: 100,
          });
          assert.isAtMost(Buffer.byteLength(canonicalSourceJson(page)), 270_000);
          yield* decodeSourceChunk(page);
          for (const record of page.records) {
            if (record.kind === "content" && record.requiredForAnalysis)
              textChunks.push(record.data);
            if (record.kind === "content-reference") references += 1;
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        assert.equal(textChunks.join(""), text);
        assert.equal(references, 1);
        assert.equal(
          (yield* sources.listSources({ threadId, runId })).coverage[0]?.readRecordCount,
          snapshot.recordCount,
        );
      }),
  );

  it.effect(
    "requires every frozen current-project chat and rejects subset and empty manifests",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const projectId = yield* seedProject();
        const threadId = yield* seedThread(projectId, "owner");
        yield* seedThread(projectId, "archived", true);
        const exported = yield* sources.exportSources({ projectId, includeArchived: true });
        const runId = DeepPlanRunId.make(`${threadId}-mandatory-run`);
        const input = { threadId, runId, localExportId: exported.exportId };
        assert.equal(
          (yield* sources.initializeSources({ ...input, snapshots: [] }).pipe(Effect.flip)).code,
          "incomplete-source",
        );
        assert.equal(
          (yield* sources
            .initializeSources({
              ...input,
              snapshots: exported.sources.filter((source) => source.origin.threadId === threadId),
            })
            .pipe(Effect.flip)).code,
          "incomplete-source",
        );
        const subset = yield* sources.exportSources({
          projectId,
          includeArchived: true,
          threadIds: [threadId],
        });
        assert.equal(
          (yield* sources
            .initializeSources({
              ...input,
              localExportId: subset.exportId,
              snapshots: subset.sources,
            })
            .pipe(Effect.flip)).code,
          "incomplete-source",
        );
        assert.equal(
          (yield* sources.initializeSources({ ...input, snapshots: exported.sources })).sources
            .length,
          2,
        );
      }),
  );

  it.effect(
    "rejects optional body groups that interleave required messages even with a valid manifest hash",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const remote = remoteFixture("invalid-interleaved-content", ["Required text"]);
        const makeContent = (chunkIndex: number): DeepPlanSourceRecord =>
          identifyRecord({
            kind: "content",
            recordId: "",
            contentHash: "",
            origin: { ...remote.snapshot.origin, recordId: `content-${chunkIndex}` },
            contentId: "optional-content",
            mediaType: "application/json",
            chunkIndex,
            totalChunks: 2,
            data: "tool output",
            requiredForAnalysis: false,
          });
        const records = [makeContent(0), remote.records[0]!, makeContent(1)];
        const snapshot = fixtureWithRecords(remote.snapshot, records);
        const runId = DeepPlanRunId.make("run-interleaved-content");
        const threadId = yield* initializeRemoteCollection(runId, [snapshot]);
        const error = yield* sources
          .importSourceChunk({
            threadId,
            runId,
            snapshot,
            records,
            chunkIndex: 0,
            chunkHash: sourceChunkHash(records),
            finalChunk: true,
          })
          .pipe(Effect.flip);
        assert.equal(error.code, "invalid-chunk");
        assert.equal(
          (yield* sources.listSources({ threadId, runId })).coverage[0]?.importedRecordCount,
          0,
        );
      }),
  );

  it.effect("keeps an oversized worklog summary in required analysis pages", () =>
    Effect.gen(function* () {
      const sources = yield* DeepPlanSources;
      const sql = yield* SqlClient.SqlClient;
      const projectId = yield* seedProject();
      const threadId = yield* seedThread(projectId, "worklog");
      const worklog = "Meaningful worklog detail. ".repeat(4_000);
      yield* sql`
        INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
        VALUES (${`${threadId}-activity`}, ${threadId}, 'info', 'agent.worklog', ${worklog}, '{}', ${at})
      `;
      const exported = yield* sources.exportSources({ projectId, includeArchived: true });
      const snapshot = exported.sources[0]!;
      const runId = DeepPlanRunId.make(`${threadId}-run`);
      yield* sources.initializeSources({
        threadId,
        runId,
        localExportId: exported.exportId,
        snapshots: exported.sources,
      });
      const page = yield* sources.readSourceChunk({
        threadId,
        runId,
        sourceId: snapshot.sourceId,
        includeBodies: false,
        limit: 100,
      });
      const chunks = page.records.filter((record) => record.kind === "content");
      assert.isTrue(chunks.every((record) => record.requiredForAnalysis));
      assert.equal(
        chunks.map((record) => record.data).join(""),
        canonicalSourceJson({
          id: `${threadId}-activity`,
          tone: "info",
          kind: "agent.worklog",
          summary: worklog,
          payload: {},
          turnId: null,
          createdAt: at,
        }),
      );
    }),
  );

  it.effect(
    "rolls back an unavailable attachment and distinguishes empty initialized collections from missing runs",
    () =>
      Effect.gen(function* () {
        const sources = yield* DeepPlanSources;
        const sql = yield* SqlClient.SqlClient;
        const projectId = yield* seedProject();
        const threadId = yield* seedThread(projectId, "missing-attachment");
        yield* seedMessage({
          threadId,
          id: `${threadId}-message`,
          text: "Missing file",
          attachments: [
            {
              type: "file",
              id: `${threadId}-file`,
              name: "missing.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
            },
          ],
        });
        assert.equal(
          (yield* sources.exportSources({ projectId, includeArchived: true }).pipe(Effect.flip))
            .code,
          "source-unavailable",
        );
        assert.equal(
          (yield* sql`SELECT 1 FROM deep_plan_source_exports WHERE project_id = ${projectId}`)
            .length,
          0,
        );
        const runId = DeepPlanRunId.make(`${threadId}-empty-run`);
        assert.equal(
          (yield* sources.assertCompleteCoverage(runId).pipe(Effect.flip)).code,
          "run-not-found",
        );
        const emptyProjectId = yield* seedProject();
        const emptyExport = yield* sources.exportSources({
          projectId: emptyProjectId,
          includeArchived: true,
        });
        const emptyOwner = yield* seedThread(emptyProjectId, "new-owner-after-capture");
        yield* sources.initializeSources({
          threadId: emptyOwner,
          runId,
          snapshots: [],
          localExportId: emptyExport.exportId,
        });
        assert.deepStrictEqual((yield* sources.assertCompleteCoverage(runId)).sources, []);
      }),
  );
});
