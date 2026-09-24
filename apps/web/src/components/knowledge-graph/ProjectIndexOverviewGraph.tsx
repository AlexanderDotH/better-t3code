import type { ProjectIndexController } from "@t3tools/client-runtime/project-indexing";
import { PROJECT_INDEX_MAX_QUERY_TOKENS, type ProjectIndexQueryResultV1 } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProjectIndexGraph } from "./ProjectIndexGraph";
import {
  buildProjectIndexMap,
  PROJECT_MAP_NODE_LIMIT,
  PROJECT_MAP_ROOT,
  type ProjectMapNode,
} from "./projectIndexOverviewLayout";

export function ProjectIndexOverviewGraph({
  snapshot,
  query,
  includeStale,
  selectedEntityId,
  onSelectEntity,
}: {
  readonly snapshot: ProjectIndexQueryResultV1;
  readonly query: ProjectIndexController["query"];
  readonly includeStale: boolean;
  readonly selectedEntityId: string | null;
  readonly onSelectEntity: (id: string) => void;
}) {
  const { message } = useInterfaceTranslator();
  const [branches, setBranches] = useState<ReadonlyMap<string, ProjectIndexQueryResultV1>>(
    () => new Map(),
  );
  const [expandedSymbols, setExpandedSymbols] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestVersion = useRef(0);
  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );
  const overview = snapshot.graph!;
  const map = useMemo(
    () => buildProjectIndexMap(overview, branches, expandedSymbols),
    [overview, branches, expandedSymbols],
  );

  const select = async (node: ProjectMapNode) => {
    setNotice(null);
    if (node.id === PROJECT_MAP_ROOT) {
      requestVersion.current++;
      setLoadingPath(null);
      setBranches(new Map());
      setExpandedSymbols(new Set());
      return;
    }
    if (node.entityId !== null) {
      onSelectEntity(node.entityId);
      if (node.expandable)
        setExpandedSymbols((current) => {
          const next = new Set(current);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      return;
    }
    if (node.expanded) {
      requestVersion.current++;
      setLoadingPath(null);
      const collapsedSymbols = new Set(
        [...branches]
          .filter(([path]) => path === node.filePath || path.startsWith(`${node.filePath}/`))
          .flatMap(([, branch]) => branch.entities.map((entity) => entity.id)),
      );
      setExpandedSymbols(
        (current) => new Set([...current].filter((id) => !collapsedSymbols.has(id))),
      );
      setBranches(
        (current) =>
          new Map(
            [...current].filter(
              ([path]) => path !== node.filePath && !path.startsWith(`${node.filePath}/`),
            ),
          ),
      );
      return;
    }
    if (loadingPath !== null) return;
    if (map.nodes.length >= PROJECT_MAP_NODE_LIMIT) {
      setNotice(message("projectIndexing.graphExpandLimit"));
      return;
    }
    const version = ++requestVersion.current;
    setLoadingPath(node.filePath);
    try {
      const result = await query({
        operation: "overview",
        scopes: [node.filePath],
        maxTokens: PROJECT_INDEX_MAX_QUERY_TOKENS,
        limit: 128,
        includeStale,
      });
      if (version !== requestVersion.current) return;
      if (
        result.scope.projectId !== snapshot.scope.projectId ||
        result.scope.scopeId !== snapshot.scope.scopeId ||
        result.scope.workspaceFingerprint !== snapshot.scope.workspaceFingerprint ||
        result.revision !== snapshot.revision
      ) {
        setNotice(message("projectIndexing.scopeChanged"));
        return;
      }
      if (node.kind === "directory" && result.graph?.rootPath !== node.filePath) {
        setNotice(message("projectIndexing.graphBranchUnavailable"));
        return;
      }
      if (
        node.kind === "file" &&
        !result.entities.some(
          (entity) =>
            entity.filePath === node.filePath &&
            entity.kind !== "file" &&
            entity.provenance !== "llm",
        )
      )
        setNotice(message("projectIndexing.graphNoSymbols"));
      setBranches((current) => new Map(current).set(node.filePath, result));
    } catch (error) {
      if (version === requestVersion.current)
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === requestVersion.current) setLoadingPath(null);
    }
  };

  return (
    <div className="space-y-2">
      <ProjectIndexGraph
        entities={[]}
        callsites={[]}
        overview={overview}
        map={map}
        loadingPath={loadingPath}
        onSelectMapNode={(node) => void select(node)}
        selectedEntityId={selectedEntityId}
        onSelectEntity={onSelectEntity}
      />
      {loadingPath !== null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message("projectIndexing.graphLoadingBranch", { path: loadingPath })}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {map.truncated ? (
        <p className="text-xs text-muted-foreground">
          {message("projectIndexing.graphExpandLimit")}
        </p>
      ) : null}
    </div>
  );
}
