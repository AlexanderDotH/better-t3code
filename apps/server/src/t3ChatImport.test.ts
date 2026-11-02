// @effect-diagnostics nodeBuiltinImport:off - Tests create fixture T3 databases with node:sqlite.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  discoverT3ChatImportSources,
  makeT3ChatImport,
  makeT3ChatImportId,
  readT3ChatImportSnapshot,
} from "./t3ChatImport.ts";
import { historyTestLayer } from "./harnessChatSync/historyTestLayer.ts";
import * as SqlClient from "effect/sql/SqlClient";

function createSourceDatabase(databasePath: string) {
  NodeFS.mkdirSync(NodePath.dirname(databasePath), { recursive: true });
  const database = new NodeSqlite.DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      default_model_selection_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function seedSourceDatabase(databasePath: string) {
  const database = createSourceDatabase(databasePath);
  const modelSelection = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
  database
    .prepare(`INSERT INTO projection_projects VALUES (?, ?, ?, ?, ?, ?, NULL)`)
    .run(
      "project-1",
      "Source project",
      "/workspace/source",
      modelSelection,
      "2026-07-10T10:00:00.000Z",
      "2026-07-12T10:00:00.000Z",
    );
  const insertThread = database.prepare(
    `INSERT INTO projection_threads VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  );
  insertThread.run(
    "thread-1",
    "project-1",
    "First chat",
    modelSelection,
    "full-access",
    "default",
    "2026-07-10T10:00:00.000Z",
    "2026-07-12T10:00:00.000Z",
    null,
    null,
  );
  insertThread.run(
    "thread-2",
    "project-1",
    "Archived chat",
    modelSelection,
    "approval-required",
    "plan",
    "2026-07-11T10:00:00.000Z",
    "2026-07-11T12:00:00.000Z",
    "2026-07-11T12:00:00.000Z",
    null,
  );
  insertThread.run(
    "thread-deleted",
    "project-1",
    "Deleted chat",
    modelSelection,
    "full-access",
    "default",
    "2026-07-09T10:00:00.000Z",
    "2026-07-09T11:00:00.000Z",
    null,
    "2026-07-09T12:00:00.000Z",
  );
  database
    .prepare(`INSERT INTO projection_thread_messages VALUES (?, ?, NULL, ?, ?, NULL, 0, ?, ?)`)
    .run(
      "message-1",
      "thread-1",
      "user",
      "Import me",
      "2026-07-10T10:01:00.000Z",
      "2026-07-10T10:01:00.000Z",
    );
  database.close();
}

describe("T3 chat import", () => {
  it.effect("discovers sibling T3 homes and excludes the active database", () =>
    Effect.gen(function* () {
      const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-chat-import-"));
      const currentDbPath = NodePath.join(homeDir, ".t3", "userdata", "state.sqlite");
      const sourceDbPath = NodePath.join(homeDir, ".t3-local", "userdata", "state.sqlite");
      seedSourceDatabase(currentDbPath);
      seedSourceDatabase(sourceDbPath);

      const result = yield* discoverT3ChatImportSources({ homeDir, currentDbPath }).pipe(
        Effect.provide(NodeServices.layer),
      );

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        id: makeT3ChatImportId(sourceDbPath),
        threadCount: 2,
        latestUpdatedAt: "2026-07-12T10:00:00.000Z",
      });
      const newerPath = NodePath.join(NodePath.dirname(sourceDbPath), "statev2.sqlite");
      NodeFS.copyFileSync(sourceDbPath, newerPath);
      const newer = yield* discoverT3ChatImportSources({ homeDir, currentDbPath }).pipe(
        Effect.provide(NodeServices.layer),
      );
      expect(newer.sources.map((source) => source.databasePath)).toEqual([newerPath]);
    }),
  );

  it.effect("reads active chats and their completed messages", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-chat-read-"));
      const sourceDbPath = NodePath.join(directory, "state.sqlite");
      seedSourceDatabase(sourceDbPath);

      const snapshot = yield* readT3ChatImportSnapshot(sourceDbPath);

      expect(snapshot.projects).toHaveLength(1);
      expect(snapshot.threads.map((thread) => thread.sourceId)).toEqual(["thread-1", "thread-2"]);
      expect(snapshot.threads[0]?.messages).toEqual([
        expect.objectContaining({ role: "user", text: "Import me" }),
      ]);
      const database = new NodeSqlite.DatabaseSync(sourceDbPath);
      database.exec(`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, project_id TEXT, title TEXT,
        payload_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
        CREATE TABLE orchestration_v2_projection_messages (message_id TEXT, thread_id TEXT, role TEXT, streaming INTEGER,
        payload_json TEXT, created_at TEXT, updated_at TEXT);`);
      database
        .prepare(`INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?, ?, ?, NULL)`)
        .run(
          "thread-1",
          "project-1",
          "Current title",
          JSON.stringify({
            modelSelection: { instanceId: "codex", model: "current-model" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            archivedAt: null,
          }),
          "2026-07-10T10:00:00.000Z",
          "2026-07-14T10:00:00.000Z",
        );
      database
        .prepare(`INSERT INTO orchestration_v2_projection_messages VALUES (?, ?, ?, 0, ?, ?, ?)`)
        .run(
          "v2-message",
          "thread-1",
          "assistant",
          JSON.stringify({ text: "Current V2 answer", attachments: [] }),
          "2026-07-14T10:00:00.000Z",
          "2026-07-14T10:00:00.000Z",
        );
      database.close();
      const current = yield* readT3ChatImportSnapshot(sourceDbPath);
      expect(current.threads.find((thread) => thread.sourceId === "thread-1")).toMatchObject({
        title: "Current title",
        modelSelection: { model: "current-model" },
      });
      expect(
        current.threads
          .find((thread) => thread.sourceId === "thread-1")
          ?.messages.map((message) => message.text),
      ).toEqual(["Import me", "Current V2 answer"]);
    }),
  );

  it("uses deterministic ids so retrying an import is idempotent", () => {
    const first = makeT3ChatImportId("/home/alex/.t3-local/userdata/state.sqlite", "thread-1");
    const second = makeT3ChatImportId("/home/alex/.t3-local/userdata/state.sqlite", "thread-1");
    const different = makeT3ChatImportId("/home/alex/.t3-local/userdata/state.sqlite", "thread-2");

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it.effect("dispatches imported history without starting provider turns", () => {
    const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-chat-service-"));
    const targetBaseDir = NodePath.join(homeDir, ".t3");
    const sourceDbPath = NodePath.join(homeDir, ".t3-local", "userdata", "state.sqlite");
    seedSourceDatabase(sourceDbPath);
    const copiedAttachment = {
      type: "image" as const,
      id: "thread-1-11111111-1111-1111-1111-111111111111",
      name: "available.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const missingAttachment = {
      type: "image" as const,
      id: "thread-1-22222222-2222-2222-2222-222222222222",
      name: "missing.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const sourceDatabase = new NodeSqlite.DatabaseSync(sourceDbPath);
    sourceDatabase
      .prepare(`UPDATE projection_thread_messages SET attachments_json = ? WHERE message_id = ?`)
      .run(JSON.stringify([copiedAttachment, missingAttachment]), "message-1");
    sourceDatabase.close();
    const sourceAttachmentsDir = NodePath.join(NodePath.dirname(sourceDbPath), "attachments");
    NodeFS.mkdirSync(sourceAttachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(sourceAttachmentsDir, `${copiedAttachment.id}.png`), "copy");
    const testLayer = historyTestLayer(targetBaseDir);

    return Effect.gen(function* () {
      const chatImport = yield* makeT3ChatImport({ homeDir });
      const sources = yield* chatImport.discover;
      const source = sources.sources[0];
      expect(source).toBeDefined();
      if (!source) return;

      const firstResult = yield* chatImport.importSource({ sourceId: source.id });
      const sql = yield* SqlClient.SqlClient;
      const firstEvents = yield* sql`SELECT event_id FROM orchestration_events`;
      const secondResult = yield* chatImport.importSource({ sourceId: source.id });
      expect(yield* sql`SELECT event_id FROM orchestration_events`).toEqual(firstEvents);

      expect(firstResult).toEqual({
        projectsImported: 1,
        threadsImported: 2,
        messagesImported: 1,
        attachmentsCopied: 1,
        attachmentsSkipped: 1,
      });
      expect(secondResult).toEqual(firstResult);
      const importedMessages = yield* sql<{
        readonly message_id: string;
        readonly payload_json: string;
      }>`SELECT message_id, payload_json FROM orchestration_v2_projection_messages`;
      expect(importedMessages).toHaveLength(1);
      expect(importedMessages[0]?.message_id).toMatch(/^import-message-/);
      expect(JSON.parse(importedMessages[0]!.payload_json)).toMatchObject({
        role: "user",
        text: "Import me",
        streaming: false,
        runId: null,
        attachments: [copiedAttachment],
      });
      expect(yield* sql`SELECT run_id FROM orchestration_v2_projection_runs`).toEqual([]);
      expect(yield* sql`SELECT effect_id FROM orchestration_v2_effect_outbox`).toEqual([]);
      expect(
        NodeFS.readFileSync(
          NodePath.join(targetBaseDir, "userdata", "attachments", `${copiedAttachment.id}.png`),
          "utf8",
        ),
      ).toBe("copy");
    }).pipe(Effect.provide(testLayer));
  });
});
