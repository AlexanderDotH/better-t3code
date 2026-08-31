import type {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphNodeV1,
  KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { KnowledgeGraphPanelView } from "./KnowledgeGraphPanel";

const scopeId = "scope-1" as KnowledgeGraphNodeV1["scopeId"];
const packageNode: KnowledgeGraphNodeV1 = {
  version: 1,
  nodeId: "package" as KnowledgeGraphNodeV1["nodeId"],
  scopeId,
  kind: "package",
  label: "Client runtime",
  summary: "Shared client behavior",
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  nodeRevision: 1,
};
const fileNode: KnowledgeGraphNodeV1 = {
  version: 1,
  nodeId: "file" as KnowledgeGraphNodeV1["nodeId"],
  scopeId,
  kind: "file",
  label: "knowledgeGraphState.ts",
  summary: "Applies revisioned graph patches",
  source: { path: "packages/client-runtime/src/knowledgeGraphState.ts", startLine: 12 },
  provenance: "semantic",
  confidence: 0.82,
  evidenceIds: [],
  nodeRevision: 1,
};
const relationship: KnowledgeGraphEdgeV1 = {
  version: 1,
  edgeId: "edge" as KnowledgeGraphEdgeV1["edgeId"],
  scopeId,
  kind: "contains",
  sourceNodeId: packageNode.nodeId,
  targetNodeId: fileNode.nodeId,
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  edgeRevision: 1,
};
const snapshot: KnowledgeGraphSnapshotV1 = {
  version: 1,
  type: "snapshot",
  scope: {
    version: 1,
    scopeId,
    environmentId: "env" as KnowledgeGraphSnapshotV1["scope"]["environmentId"],
    projectId: "project" as KnowledgeGraphSnapshotV1["scope"]["projectId"],
    effectiveWorkspaceRoot: "/workspace",
    isWorktree: false,
  },
  revision: 1,
  nodes: [packageNode, fileNode],
  edges: [relationship],
  evidence: [],
  status: {
    version: 1,
    scopeId,
    state: "ready",
    revision: 1,
    indexedFileCount: 1,
    nodeCount: 2,
    edgeCount: 1,
    evidenceCount: 0,
    semanticQueueDepth: 0,
    truncated: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: false,
      omittedFileCount: 0,
      omittedNodeCount: 0,
    },
  },
  generatedAt: "2026-08-29T00:00:00.000Z",
};

const translate = (key: string, values: Readonly<Record<string, string | number>> = {}) =>
  Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)),
    (
      {
        "knowledgeGraph.title": "Knowledge Graph",
        "knowledgeGraph.search.label": "Search graph",
        "knowledgeGraph.search.placeholder": "Search nodes",
        "knowledgeGraph.filters.label": "Node filters",
        "knowledgeGraph.zoomIn": "Zoom in",
        "knowledgeGraph.zoomOut": "Zoom out",
        "knowledgeGraph.resetView": "Reset view",
        "knowledgeGraph.provenance": "Provenance",
        "knowledgeGraph.provenance.semantic": "Semantic provenance",
        "knowledgeGraph.confidence": "Confidence",
        "knowledgeGraph.relationships": "Relationships",
        "knowledgeGraph.openSource": "Open source",
        "knowledgeGraph.resultCount": "{{count}} results",
        "knowledgeGraph.empty": "No indexed knowledge is available yet.",
        "knowledgeGraph.truncated": "Some graph results are omitted by safety bounds.",
        "knowledgeGraph.omittedNodes": "{{count}} nodes omitted",
        "knowledgeGraph.direction.incoming": "Incoming",
        "knowledgeGraph.direction.outgoing": "Outgoing",
      } as Record<string, string>
    )[key] ?? key,
  );

describe("KnowledgeGraphPanelView", () => {
  it("renders searchable, filterable graph controls and one expanded accessible relationship list", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeGraphPanelView
        snapshot={snapshot}
        positions={
          new Map([
            [packageNode.nodeId, { x: 80, y: 80 }],
            [fileNode.nodeId, { x: 220, y: 160 }],
          ])
        }
        width={480}
        height={360}
        query=""
        kinds={new Set()}
        expandedNodeId={fileNode.nodeId}
        zoom={1}
        prefersReducedMotion
        translate={translate}
        formatConfidence={(confidence) => `${Math.round(confidence * 100)} localized percent`}
        onQueryChange={() => undefined}
        onToggleKind={() => undefined}
        onZoomChange={() => undefined}
        onResetView={() => undefined}
        onExpandNode={() => undefined}
        onOpenSource={() => undefined}
        onNodePointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Search graph"');
    expect(markup).toContain('aria-label="Node filters"');
    expect(markup).toContain('data-motion="reduced"');
    expect(markup.match(/data-expanded-node=/g)).toHaveLength(1);
    expect(markup).toContain("knowledgeGraphState.ts");
    expect(markup).toContain("Semantic provenance");
    expect(markup).toContain("82 localized percent");
    expect(markup).toContain('aria-label="Relationships"');
    expect(markup).toContain("Client runtime");
    expect(markup).toContain("Open source");
  });

  it("makes empty and explicitly truncated graph states visible", () => {
    const emptyMarkup = renderToStaticMarkup(
      <KnowledgeGraphPanelView
        snapshot={{ ...snapshot, nodes: [], edges: [], evidence: [] }}
        positions={new Map()}
        width={480}
        height={360}
        query=""
        kinds={new Set()}
        expandedNodeId={null}
        zoom={1}
        prefersReducedMotion={false}
        translate={translate}
        formatConfidence={(confidence) => `${Math.round(confidence * 100)}%`}
        onQueryChange={() => undefined}
        onToggleKind={() => undefined}
        onZoomChange={() => undefined}
        onResetView={() => undefined}
        onExpandNode={() => undefined}
        onOpenSource={() => undefined}
        onNodePointerDown={() => undefined}
      />,
    );
    const truncatedMarkup = renderToStaticMarkup(
      <KnowledgeGraphPanelView
        snapshot={{
          ...snapshot,
          status: {
            ...snapshot.status,
            truncated: {
              ...snapshot.status.truncated,
              visibleNodes: true,
              omittedNodeCount: 7,
            },
          },
        }}
        positions={
          new Map([
            [packageNode.nodeId, { x: 80, y: 80 }],
            [fileNode.nodeId, { x: 220, y: 160 }],
          ])
        }
        width={480}
        height={360}
        query=""
        kinds={new Set()}
        expandedNodeId={null}
        zoom={1}
        prefersReducedMotion={false}
        translate={translate}
        formatConfidence={(confidence) => `${Math.round(confidence * 100)}%`}
        onQueryChange={() => undefined}
        onToggleKind={() => undefined}
        onZoomChange={() => undefined}
        onResetView={() => undefined}
        onExpandNode={() => undefined}
        onOpenSource={() => undefined}
        onNodePointerDown={() => undefined}
      />,
    );

    expect(emptyMarkup).toContain("No indexed knowledge is available yet.");
    expect(truncatedMarkup).toContain("Some graph results are omitted by safety bounds.");
    expect(truncatedMarkup).toContain("7 nodes omitted");
  });
});
