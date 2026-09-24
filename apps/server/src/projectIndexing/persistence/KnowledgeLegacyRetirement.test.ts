// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "vite-plus/test";

import type { KnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import { retireLegacyKnowledgeSqlite } from "./KnowledgeLegacyRetirement.ts";
import { KNOWLEDGE_STORE_APPLICATION_ID } from "./KnowledgeStoreSchema.ts";

it("removes only an owned standalone knowledge SQLite file", async () => {
  const workspaceRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-retire-knowledge-"));
  const knowledgeRoot = NodePath.join(workspaceRoot, ".t3", "knowledge");
  NodeFS.mkdirSync(knowledgeRoot, { recursive: true });
  const workspace: KnowledgeWorkspace = {
    workspaceRoot,
    knowledgeRoot,
    workspaceId: "the-workspace",
    databasePath: NodePath.join(knowledgeRoot, "knowledge.sqlite"),
  };
  const mainDatabasePath = NodePath.join(workspaceRoot, "state.sqlite");
  try {
    const main = new NodeSqlite.DatabaseSync(mainDatabasePath);
    main.exec("CREATE TABLE threads(id TEXT PRIMARY KEY)");
    main.close();
    const unrelated = new NodeSqlite.DatabaseSync(workspace.databasePath);
    unrelated.exec(
      "CREATE TABLE knowledge_state(singleton INTEGER PRIMARY KEY, workspace_id TEXT)",
    );
    unrelated.prepare("INSERT INTO knowledge_state VALUES (1, ?)").run("other-workspace");
    unrelated.exec(`PRAGMA application_id = ${KNOWLEDGE_STORE_APPLICATION_ID}`);
    unrelated.close();
    expect(await retireLegacyKnowledgeSqlite(workspace)).toBe(false);
    expect(NodeFS.existsSync(workspace.databasePath)).toBe(true);
    const owned = new NodeSqlite.DatabaseSync(workspace.databasePath);
    owned.prepare("UPDATE knowledge_state SET workspace_id = ?").run(workspace.workspaceId);
    owned.close();
    expect(await retireLegacyKnowledgeSqlite(workspace)).toBe(true);
    expect(NodeFS.existsSync(workspace.databasePath)).toBe(false);
    expect(NodeFS.existsSync(mainDatabasePath)).toBe(true);
  } finally {
    NodeFS.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
