import { ProjectIndexGraphOverviewV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { KnowledgePage, KnowledgeRecordMap } from "../persistence/KnowledgeStoreTypes.ts";
import { isWithinWorkspaceContextScopes } from "../../workspace/WorkspaceContextPathPolicy.ts";
import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import type { ProjectContextReader } from "./ProjectContextSources.ts";

const encodeGraph = Schema.encodeSync(Schema.fromJsonString(ProjectIndexGraphOverviewV1));
const PAGE_SIZE = 200;
const MAX_FILES = 50_000;
const MAX_IMPORTS = 100_000;
const MAX_NODES = 64;
const MAX_EDGES = 128;

/** Aggregate the published file/import snapshot without expanding symbol context or source text. */
export const readProjectIndexGraphOverview = Effect.fn("readProjectIndexGraphOverview")(function* (
  reader: ProjectContextReader,
  revision: number,
  scopes: ReadonlyArray<string> | undefined,
  byteBudget: number,
) {
  const rootPath = scopes?.length === 1 ? scopes[0]!.replace(/\/+$/u, "") : "";
  const nodes = new Map<string, { path: string; kind: "directory" | "file"; fileCount: number }>();
  const files = new Map<string, { nodePath: string; hash: string }>();
  let cursor: string | null = null;
  let truncated = false;
  let scannedFiles = 0;
  do {
    const page: KnowledgePage<KnowledgeRecordMap["files"]> = yield* reader.listRecords({
      kind: "files",
      revision,
      limit: PAGE_SIZE,
      ...(scopes ? { filePathPrefixes: scopes } : {}),
      ...(cursor === null ? {} : { afterId: cursor }),
    });
    for (const file of page.items) {
      if (
        file.status !== "indexed" ||
        !isSafeProjectSourcePath(file.path) ||
        !isWithinWorkspaceContextScopes(file.path, scopes)
      )
        continue;
      const relative =
        rootPath && file.path.startsWith(`${rootPath}/`)
          ? file.path.slice(rootPath.length + 1)
          : file.path;
      const slash = file.path === rootPath ? -1 : relative.indexOf("/");
      const path =
        slash < 0 ? file.path : `${rootPath ? `${rootPath}/` : ""}${relative.slice(0, slash)}`;
      const node = nodes.get(path) ?? {
        path,
        kind: slash < 0 ? ("file" as const) : ("directory" as const),
        fileCount: 0,
      };
      node.fileCount++;
      nodes.set(path, node);
      files.set(file.path, { nodePath: path, hash: file.contentHash });
    }
    scannedFiles += page.items.length;
    cursor = page.nextCursor;
  } while (cursor !== null && scannedFiles < MAX_FILES);
  truncated ||= cursor !== null;

  const visible = [...nodes.values()]
    .sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path))
    .slice(0, MAX_NODES);
  const visiblePaths = new Set(visible.map((node) => node.path));
  const edges = new Map<string, { source: string; target: string; imports: number }>();
  let scannedImports = 0;
  cursor = null;
  do {
    const page: KnowledgePage<KnowledgeRecordMap["imports"]> = yield* reader.listRecords({
      kind: "imports",
      revision,
      limit: PAGE_SIZE,
      ...(scopes ? { filePathPrefixes: scopes } : {}),
      ...(cursor === null ? {} : { afterId: cursor }),
    });
    for (const imported of page.items) {
      if (
        imported.resolution !== "workspace" ||
        imported.freshness !== "current" ||
        !imported.targetPath
      )
        continue;
      const source = files.get(imported.filePath);
      const target = files.get(imported.targetPath);
      if (
        !source ||
        !target ||
        source.hash !== imported.sourceHash ||
        source.nodePath === target.nodePath ||
        !visiblePaths.has(source.nodePath) ||
        !visiblePaths.has(target.nodePath)
      )
        continue;
      const key = source.nodePath + "\0" + target.nodePath;
      const edge = edges.get(key) ?? {
        source: source.nodePath,
        target: target.nodePath,
        imports: 0,
      };
      edge.imports++;
      edges.set(key, edge);
    }
    scannedImports += page.items.length;
    cursor = page.nextCursor;
  } while (cursor !== null && scannedImports < MAX_IMPORTS);
  truncated ||= cursor !== null || nodes.size > MAX_NODES || edges.size > MAX_EDGES;
  const graph = {
    basis: "published-index",
    rootPath,
    indexedFiles: files.size,
    omittedFiles: files.size - visible.reduce((sum, node) => sum + node.fileCount, 0),
    truncated,
    nodes: visible,
    edges: [...edges.values()]
      .sort(
        (left, right) =>
          right.imports - left.imports ||
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      )
      .slice(0, MAX_EDGES),
  } satisfies ProjectIndexGraphOverviewV1;
  while (Buffer.byteLength(encodeGraph(graph), "utf8") > byteBudget) {
    if (graph.edges.length > 0) graph.edges.pop();
    else if (graph.nodes.length > 0) graph.omittedFiles += graph.nodes.pop()!.fileCount;
    else break;
    graph.truncated = true;
  }
  return graph;
});
