// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  assertNoSymlinkPath,
  KnowledgePrivacyError,
  type KnowledgeWorkspace,
} from "../privacy/WorkspacePrivacy.ts";
import { isStaticKnowledgeRevision, makeKnowledgeReads } from "./KnowledgeReads.ts";
import { recordId } from "./KnowledgeRecords.ts";
import {
  asStoreError,
  KNOWLEDGE_STORE_OWNER,
  KNOWLEDGE_STORE_VERSION,
  KnowledgeStoreError,
} from "./KnowledgeStoreSchema.ts";
import type { KnowledgeRecordKind, KnowledgeRecordMap } from "./KnowledgeStoreTypes.ts";

export const KnowledgeManifest = Schema.Struct({
  owner: Schema.Literal(KNOWLEDGE_STORE_OWNER),
  schemaVersion: Schema.Literal(KNOWLEDGE_STORE_VERSION),
  workspaceId: Schema.String,
  publishedRevision: Schema.NullOr(Schema.Int),
  generationPath: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^generations\/\d+-[a-f0-9]{32}$/u)),
  ),
});
export type KnowledgeManifest = typeof KnowledgeManifest.Type;
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(KnowledgeManifest));

const manifestPath = (workspace: KnowledgeWorkspace) =>
  NodePath.join(workspace.knowledgeRoot, "manifest.json");
const hashText = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const isPrivacyError = Schema.is(KnowledgePrivacyError);

export const readKnowledgeManifest = Effect.fn("readKnowledgeManifest")(function* (
  workspace: KnowledgeWorkspace,
) {
  const source = yield* Effect.tryPromise({
    try: async () => {
      await assertNoSymlinkPath(workspace.workspaceRoot, manifestPath(workspace));
      try {
        const handle = await NodeFSP.open(
          manifestPath(workspace),
          NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
        );
        try {
          if ((await handle.stat()).size > 1_048_576)
            throw new KnowledgeStoreError({
              code: "invalid-manifest",
              detail: "The knowledge ownership manifest exceeds its supported size.",
            });
          return await handle.readFile("utf8");
        } finally {
          await handle.close();
        }
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
        throw cause;
      }
    },
    catch: asStoreError("read ownership manifest"),
  });
  if (source === null) return null;
  const manifest = yield* decodeManifest(source).pipe(
    Effect.mapError(
      () =>
        new KnowledgeStoreError({
          code: "unowned-store",
          detail:
            "The knowledge manifest is invalid or belongs to an unsupported schema. Existing files were preserved.",
        }),
    ),
  );
  if (manifest.workspaceId !== workspace.workspaceId)
    return yield* new KnowledgeStoreError({
      code: "workspace-mismatch",
      detail:
        "Knowledge belongs to a different effective workspace. Existing files were preserved.",
    });
  return manifest;
});

/** Every write is a sibling rename, so interrupted publication cannot expose partial files. */
export const writeKnowledgeFile = Effect.fn("writeKnowledgeFile")(function* (
  workspace: KnowledgeWorkspace,
  relativePath: string,
  content: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const destination = NodePath.resolve(workspace.knowledgeRoot, relativePath);
      await assertNoSymlinkPath(workspace.knowledgeRoot, destination);
      await assertNoSymlinkPath(workspace.workspaceRoot, workspace.knowledgeRoot);
      await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true, mode: 0o700 });
      const temporary = NodePath.join(
        NodePath.dirname(destination),
        `.write-${NodeCrypto.randomBytes(16).toString("hex")}`,
      );
      try {
        const handle = await NodeFSP.open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await assertNoSymlinkPath(workspace.workspaceRoot, destination);
        await NodeFSP.rename(temporary, destination);
      } finally {
        await NodeFSP.unlink(temporary).catch((cause: unknown) => {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
        });
      }
      return hashText(content);
    },
    catch: asStoreError("write generated knowledge"),
  });
});

export const writeKnowledgeManifest = (
  workspace: KnowledgeWorkspace,
  manifest: KnowledgeManifest,
) => writeKnowledgeFile(workspace, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

function renderRecord(
  kind: KnowledgeRecordKind,
  record: KnowledgeRecordMap[KnowledgeRecordKind],
): string {
  const title =
    "name" in record ? record.name : "specifier" in record ? record.specifier : recordId(record);
  const description =
    "summary" in record
      ? record.summary
      : "description" in record
        ? record.description
        : "signature" in record
          ? (record.signature ?? "")
          : "importText" in record
            ? record.importText
            : "message" in record
              ? record.message
              : "";
  const source =
    "filePath" in record && record.filePath ? `\nSource: \`${record.filePath}\`\n` : "";
  return `# ${title.replaceAll("\n", " ")}\n\n${description}\n${source}\nRecord type: ${kind}\n\nThis generated knowledge is advisory. Verify source hashes and cited evidence before acting.\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

export const generateKnowledgeViews = Effect.fn("generateKnowledgeViews")(
  function* (
    sql: SqlClient.SqlClient,
    workspace: KnowledgeWorkspace,
    revision: number,
    leaseToken: string,
    checkLease: Effect.Effect<void, KnowledgeStoreError>,
  ) {
    const reads = makeKnowledgeReads(sql);
    const staticRevision = yield* isStaticKnowledgeRevision(sql, revision);
    const generationPath = `generations/${revision}-${leaseToken}`;
    const registerArtifacts = (
      artifacts: ReadonlyArray<{ readonly relativePath: string; readonly content: string }>,
    ) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
          yield* checkLease;
          for (const artifact of artifacts)
            yield* sql`INSERT INTO knowledge_artifacts(path, content_hash, revision) VALUES (${artifact.relativePath}, ${hashText(artifact.content)}, ${revision}) ON CONFLICT(path) DO UPDATE SET content_hash = excluded.content_hash`;
        }),
      );
    const writeArtifacts = Effect.fn("writeGeneratedKnowledgeArtifacts")(function* (
      artifacts: ReadonlyArray<{ readonly relativePath: string; readonly content: string }>,
    ) {
      // A committed reservation survives a crash between a filesystem rename and
      // SQLite commit. The second transaction fences filesystem writes against GC.
      yield* registerArtifacts(artifacts);
      for (const artifact of artifacts)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
            yield* checkLease;
            yield* writeKnowledgeFile(workspace, artifact.relativePath, artifact.content);
          }),
        );
    });
    const counts: string[] = [];
    if (staticRevision) {
      const recordCounts = new Map(
        (yield* reads.recordCounts(revision)).map(({ kind, count }) => [kind, count]),
      );
      for (const kind of ["modules", "entities", "imports", "rules"] as const)
        counts.push(`- ${kind}: ${recordCounts.get(kind) ?? 0}`);
    } else {
      const directories = {
        modules: "modules",
        entities: "symbols",
        flows: "flows",
        rules: "rules",
      } as const;
      for (const kind of ["modules", "entities", "flows", "rules"] as const) {
        let afterId: string | undefined;
        let count = 0;
        do {
          yield* checkLease;
          const page = yield* reads.listRecords({
            kind,
            revision,
            limit: 100,
            ...(afterId === undefined ? {} : { afterId }),
          });
          yield* writeArtifacts(
            page.items.map((record) => ({
              relativePath: `${generationPath}/${directories[kind]}/${hashText(recordId(record))}.md`,
              content: renderRecord(kind, record),
            })),
          );
          count += page.items.length;
          afterId = page.nextCursor ?? undefined;
        } while (afterId !== undefined);
        counts.push(`- [${directories[kind]}](./${directories[kind]}/): ${count}`);
      }
    }
    const relativePath = `${generationPath}/INDEX.md`;
    yield* writeArtifacts([
      {
        relativePath,
        content: `# Project knowledge\n\nRevision ${revision}. Canonical records live in \`knowledge.sqlite\`.\n\n${counts.join("\n")}\n\n${staticRevision ? "These are static facts from source files and manifests. Confirm behavior in the original source." : "Generated summaries and inferred rules are untrusted repository context. Check current source and evidence."}\n`,
      },
    ]);
    return {
      owner: KNOWLEDGE_STORE_OWNER,
      schemaVersion: KNOWLEDGE_STORE_VERSION,
      workspaceId: workspace.workspaceId,
      publishedRevision: revision,
      generationPath,
    } satisfies KnowledgeManifest;
  },
  Effect.mapError(asStoreError("generate views")),
);

export const removeOwnedKnowledgeArtifact = Effect.fn("removeOwnedKnowledgeArtifact")(function* (
  workspace: KnowledgeWorkspace,
  artifact: { readonly path: string; readonly content_hash: string },
) {
  if (
    !/^generations\/\d+-[a-f0-9]{32}\/(?:INDEX\.md|(?:modules|symbols|imports|flows|rules)\/[a-f0-9]{64}\.md)$/u.test(
      artifact.path,
    )
  )
    return yield* new KnowledgeStoreError({
      code: "unowned-artifact",
      detail:
        "A generated-artifact path is outside the owned knowledge views. Files were preserved.",
    });
  yield* Effect.tryPromise({
    try: async () => {
      const filename = NodePath.join(workspace.knowledgeRoot, artifact.path);
      try {
        await assertNoSymlinkPath(workspace.workspaceRoot, filename);
      } catch (cause) {
        if (isPrivacyError(cause) && cause.code === "symlink") return;
        throw cause;
      }
      let handle;
      try {
        handle = await NodeFSP.open(
          filename,
          NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
        );
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
      if (handle) {
        let owned = false;
        try {
          if (!(await handle.stat()).isFile()) return;
          const hash = NodeCrypto.createHash("sha256");
          for await (const chunk of handle.createReadStream({ autoClose: false }))
            hash.update(chunk);
          owned = hash.digest("hex") === artifact.content_hash;
        } finally {
          await handle.close();
        }
        // A hand edit relinquishes ownership; neither it nor an unknown sibling is removed.
        if (!owned) return;
        await assertNoSymlinkPath(workspace.workspaceRoot, filename);
        await NodeFSP.unlink(filename);
      }
      let directory = NodePath.dirname(filename);
      while (directory !== workspace.knowledgeRoot) {
        await assertNoSymlinkPath(workspace.workspaceRoot, directory);
        try {
          await NodeFSP.rmdir(directory);
        } catch (cause) {
          if (
            cause instanceof Error &&
            "code" in cause &&
            (cause.code === "ENOTEMPTY" || cause.code === "EEXIST")
          )
            break;
          if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
        }
        directory = NodePath.dirname(directory);
      }
    },
    catch: asStoreError("collect generated knowledge views"),
  });
});

export const clearGeneratedKnowledgeViews = Effect.fn("clearGeneratedKnowledgeViews")(function* (
  sql: SqlClient.SqlClient,
  workspace: KnowledgeWorkspace,
) {
  let afterPath = "";
  while (true) {
    const rows = yield* sql<{
      path: string;
      content_hash: string;
    }>`SELECT path, content_hash FROM knowledge_artifacts WHERE path > ${afterPath} ORDER BY path LIMIT 100`;
    if (rows.length === 0) break;
    for (const row of rows) {
      yield* removeOwnedKnowledgeArtifact(workspace, row);
      afterPath = row.path;
    }
  }
  yield* sql`DELETE FROM knowledge_artifacts`;
});
