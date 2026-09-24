// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assertNoSymlinkPath, type KnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import { KNOWLEDGE_STORE_APPLICATION_ID } from "./KnowledgeStoreSchema.ts";

/** Remove only the former, independently owned project index after KV ownership is established. */
export async function retireLegacyKnowledgeSqlite(workspace: KnowledgeWorkspace) {
  const path = workspace.databasePath;
  if (path !== NodePath.join(workspace.knowledgeRoot, "knowledge.sqlite"))
    throw new Error("Unexpected legacy knowledge database path.");
  await assertNoSymlinkPath(workspace.workspaceRoot, path);
  const stat = await NodeFSP.lstat(path).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  });
  if (!stat) return false;
  if (!stat.isFile()) return false;
  const database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  let owned = false;
  try {
    const applicationId = database.prepare("PRAGMA application_id").get() as
      | { application_id?: number }
      | undefined;
    if (applicationId?.application_id === KNOWLEDGE_STORE_APPLICATION_ID) {
      const row = database
        .prepare("SELECT workspace_id FROM knowledge_state WHERE singleton = 1")
        .get() as { workspace_id?: string } | undefined;
      owned = row?.workspace_id === workspace.workspaceId;
    }
  } catch {
    return false;
  } finally {
    database.close();
  }
  if (!owned) return false;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const target = `${path}${suffix}`;
    await assertNoSymlinkPath(workspace.workspaceRoot, target);
    const sibling = await NodeFSP.lstat(target).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
      throw cause;
    });
    if (sibling?.isFile()) await NodeFSP.unlink(target);
  }
  return true;
}
