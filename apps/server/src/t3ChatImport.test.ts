// @effect-diagnostics nodeBuiltinImport:off - Tests create fixture T3 databases with node:sqlite.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OrchestrationCommand } from "@t3tools/contracts";

import {
  discoverT3ChatImportSources,
  makeT3ChatImport,
  makeT3ChatImportId,
  readT3ChatImportSnapshot,
} from "./t3ChatImport.ts";
import { ServerConfig } from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";

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
    const commands: OrchestrationCommand[] = [];
    const orchestrationLayer = Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
      streamDomainEvents: Stream.empty,
    });
    const configLayer = ServerConfig.layerTest(homeDir, targetBaseDir).pipe(
      Layer.provide(NodeServices.layer),
    );
    const testLayer = Layer.mergeAll(NodeServices.layer, configLayer, orchestrationLayer);

    return Effect.gen(function* () {
      const chatImport = yield* makeT3ChatImport({ homeDir });
      const sources = yield* chatImport.discover;
      const source = sources.sources[0];
      expect(source).toBeDefined();
      if (!source) return;

      const firstResult = yield* chatImport.importSource({ sourceId: source.id });
      const firstCommands = commands.slice();
      const secondResult = yield* chatImport.importSource({ sourceId: source.id });
      const secondCommands = commands.slice(firstCommands.length);

      expect(firstResult).toEqual({
        projectsImported: 1,
        threadsImported: 2,
        messagesImported: 1,
        attachmentsCopied: 1,
        attachmentsSkipped: 1,
      });
      expect(secondResult).toEqual(firstResult);
      expect(firstCommands.map((command) => command.type)).toEqual([
        "project.create",
        "thread.create",
        "thread.message.import",
        "thread.create",
        "thread.archive",
      ]);
      expect(secondCommands.map((command) => command.commandId)).toEqual(
        firstCommands.map((command) => command.commandId),
      );
      expect(commands.some((command) => command.type === "thread.turn.start")).toBe(false);

      const projectCommand = firstCommands.find((command) => command.type === "project.create");
      const threadCommand = firstCommands.find((command) => command.type === "thread.create");
      const messageCommand = firstCommands.find(
        (command) => command.type === "thread.message.import",
      );
      expect(projectCommand?.projectId).toMatch(/^import-project-/);
      expect(threadCommand?.threadId).toMatch(/^import-thread-/);
      expect(messageCommand?.message.id).toMatch(/^import-message-/);
      expect(messageCommand?.message.id).not.toBe("message-1");
      expect(messageCommand?.message).toMatchObject({
        role: "user",
        text: "Import me",
        streaming: false,
        turnId: null,
        attachments: [copiedAttachment],
      });
      expect(
        NodeFS.readFileSync(
          NodePath.join(targetBaseDir, "userdata", "attachments", `${copiedAttachment.id}.png`),
          "utf8",
        ),
      ).toBe("copy");
    }).pipe(Effect.provide(testLayer));
  });
});
