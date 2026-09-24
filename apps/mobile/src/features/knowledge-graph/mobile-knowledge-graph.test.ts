import {
  EnvironmentId,
  KnowledgeGraphEdgeId,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeId,
  ProjectId,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphStatusV1,
  type ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  knowledgeGraphDirectionMessageKey,
  knowledgeGraphEdgeKindMessageKey,
  knowledgeGraphNodeKindMessageKey,
  knowledgeGraphProvenanceMessageKey,
  knowledgeGraphSourceNavigationTarget,
  knowledgeGraphStatusMessageKey,
  mobileStaticKnowledgeGraphSnapshot,
  mobileKnowledgeGraphClearConfirmationActions,
  mobileKnowledgeGraphThreadEntryTarget,
  resolveMobileKnowledgeGraphDragPosition,
  resolveMobileKnowledgeGraphAccess,
  resolveMobileKnowledgeGraphActions,
  resolveMobileKnowledgeGraphRoutePolicy,
  resolveMobileKnowledgeGraphIndexRoute,
  supportsMobileStaticKnowledgeGraph,
  toggleKnowledgeGraphKind,
} from "./mobile-knowledge-graph";

const status = (
  state: KnowledgeGraphStatusV1["state"],
  progress?: KnowledgeGraphStatusV1["progress"],
): KnowledgeGraphStatusV1 => ({
  version: 1,
  scopeId: "scope-1" as KnowledgeGraphStatusV1["scopeId"],
  state,
  revision: 1,
  indexedFileCount: 1,
  nodeCount: 1,
  edgeCount: 0,
  evidenceCount: 0,
  semanticQueueDepth: 0,
  ...(progress === undefined ? {} : { progress }),
  truncated: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
});

describe("mobile Knowledge Graph behavior", () => {
  it("uses project indexing only after a supported selected scope is enabled", () => {
    const base = { canRead: true, indexEnabled: true, loadFailed: false };
    expect(resolveMobileKnowledgeGraphIndexRoute(base)).toBe("legacy");
    expect(resolveMobileKnowledgeGraphIndexRoute({ ...base, projectIndexingVersion: 3 })).toBe(
      "index",
    );
    expect(
      resolveMobileKnowledgeGraphIndexRoute({
        ...base,
        projectIndexingVersion: 3,
        indexEnabled: false,
      }),
    ).toBe("legacy");
    expect(
      resolveMobileKnowledgeGraphIndexRoute({
        ...base,
        projectIndexingVersion: 3,
        indexEnabled: null,
      }),
    ).toBe("loading");
    expect(
      resolveMobileKnowledgeGraphIndexRoute({
        ...base,
        projectIndexingVersion: 3,
        indexEnabled: null,
        loadFailed: true,
      }),
    ).toBe("legacy");
  });
  it("maps every contract-owned graph variant to a typed localized message", () => {
    expect(
      (
        [
          "repository",
          "package",
          "directory",
          "file",
          "symbol",
          "dependency",
          "technology",
          "documentation",
          "architecture",
        ] as const
      ).map(knowledgeGraphNodeKindMessageKey),
    ).toEqual([
      "knowledgeGraph.nodeKind.repository",
      "knowledgeGraph.nodeKind.package",
      "knowledgeGraph.nodeKind.directory",
      "knowledgeGraph.nodeKind.file",
      "knowledgeGraph.nodeKind.symbol",
      "knowledgeGraph.nodeKind.dependency",
      "knowledgeGraph.nodeKind.technology",
      "knowledgeGraph.nodeKind.documentation",
      "knowledgeGraph.nodeKind.architecture",
    ]);
    expect(
      (
        [
          "contains",
          "declares",
          "imports",
          "depends-on",
          "uses",
          "implements",
          "extends",
          "documents",
          "configures",
          "co-changes-with",
          "relates-to",
        ] as const
      ).map(knowledgeGraphEdgeKindMessageKey),
    ).toEqual([
      "knowledgeGraph.edgeKind.contains",
      "knowledgeGraph.edgeKind.declares",
      "knowledgeGraph.edgeKind.imports",
      "knowledgeGraph.edgeKind.depends-on",
      "knowledgeGraph.edgeKind.uses",
      "knowledgeGraph.edgeKind.implements",
      "knowledgeGraph.edgeKind.extends",
      "knowledgeGraph.edgeKind.documents",
      "knowledgeGraph.edgeKind.configures",
      "knowledgeGraph.edgeKind.co-changes-with",
      "knowledgeGraph.edgeKind.relates-to",
    ]);
    expect(
      (["deterministic", "semantic"] as const).map(knowledgeGraphProvenanceMessageKey),
    ).toEqual(["knowledgeGraph.provenance.deterministic", "knowledgeGraph.provenance.semantic"]);
    expect((["incoming", "outgoing"] as const).map(knowledgeGraphDirectionMessageKey)).toEqual([
      "knowledgeGraph.direction.incoming",
      "knowledgeGraph.direction.outgoing",
    ]);
    expect(
      (
        [
          "disabled",
          "idle",
          "indexing",
          "semantic",
          "ready",
          "paused",
          "rate-limited",
          "cancelling",
          "error",
        ] as const
      ).map(knowledgeGraphStatusMessageKey),
    ).toEqual([
      "knowledgeGraph.status.disabled",
      "knowledgeGraph.status.idle",
      "knowledgeGraph.status.indexing",
      "knowledgeGraph.status.semantic",
      "knowledgeGraph.status.ready",
      "knowledgeGraph.status.paused",
      "knowledgeGraph.status.rate-limited",
      "knowledgeGraph.status.cancelling",
      "knowledgeGraph.status.error",
    ]);
  });

  it("never probes old environments or disabled graphs", () => {
    expect(
      resolveMobileKnowledgeGraphAccess({ knowledgeGraphVersion: undefined, enabled: true }),
    ).toBe("unsupported");
    expect(resolveMobileKnowledgeGraphAccess({ knowledgeGraphVersion: 1, enabled: false })).toBe(
      "disabled",
    );
    expect(resolveMobileKnowledgeGraphAccess({ knowledgeGraphVersion: 1, enabled: true })).toBe(
      "available",
    );
  });

  it("requires capability v2 before graph changes can run", () => {
    expect(supportsMobileStaticKnowledgeGraph(1)).toBe(false);
    expect(supportsMobileStaticKnowledgeGraph(2)).toBe(true);
    expect(resolveMobileKnowledgeGraphRoutePolicy("available").canRebuild).toBe(false);
    expect(resolveMobileKnowledgeGraphActions(status("ready")).canRebuild).toBe(false);
  });

  it("removes stored semantic nodes and relationships from a legacy snapshot", () => {
    const scopeId = KnowledgeGraphScopeId.make("scope-1");
    const deterministic: KnowledgeGraphNodeV1 = {
      version: 1,
      nodeId: KnowledgeGraphNodeId.make("source"),
      scopeId,
      kind: "file",
      label: "source.ts",
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: [],
      nodeRevision: 1,
    };
    const semantic: KnowledgeGraphNodeV1 = {
      ...deterministic,
      nodeId: KnowledgeGraphNodeId.make("generated"),
      label: "Generated claim",
      provenance: "semantic",
    };
    const snapshot: KnowledgeGraphSnapshotV1 = {
      version: 1,
      type: "snapshot",
      scope: {
        version: 1,
        scopeId,
        environmentId: EnvironmentId.make("environment-1"),
        projectId: ProjectId.make("project-1"),
        effectiveWorkspaceRoot: "/project",
        isWorktree: false,
      },
      revision: 1,
      nodes: [deterministic, semantic],
      edges: [
        {
          version: 1,
          edgeId: KnowledgeGraphEdgeId.make("generated-link"),
          scopeId,
          kind: "relates-to",
          sourceNodeId: deterministic.nodeId,
          targetNodeId: semantic.nodeId,
          provenance: "semantic",
          confidence: 0.5,
          evidenceIds: [],
          edgeRevision: 1,
        },
      ],
      evidence: [],
      status: status("ready"),
      generatedAt: "2026-09-23T00:00:00.000Z",
    };

    expect(mobileStaticKnowledgeGraphSnapshot(snapshot).nodes).toEqual([deterministic]);
    expect(mobileStaticKnowledgeGraphSnapshot(snapshot).edges).toEqual([]);
  });

  it("keeps retained-data cleanup reachable while disabled without activating graph work", () => {
    expect(resolveMobileKnowledgeGraphRoutePolicy("unsupported")).toEqual({
      canOpenOwnerRoute: false,
      canSubscribe: false,
      canQuery: false,
      canReadNodeContent: false,
      canRebuild: false,
      canPause: false,
      canCancel: false,
      canClearRetainedData: false,
    });
    expect(resolveMobileKnowledgeGraphRoutePolicy("disabled", true)).toEqual({
      canOpenOwnerRoute: true,
      canSubscribe: false,
      canQuery: false,
      canReadNodeContent: false,
      canRebuild: false,
      canPause: false,
      canCancel: false,
      canClearRetainedData: true,
    });
    expect(resolveMobileKnowledgeGraphRoutePolicy("available", true)).toEqual({
      canOpenOwnerRoute: true,
      canSubscribe: true,
      canQuery: true,
      canReadNodeContent: true,
      canRebuild: true,
      canPause: true,
      canCancel: true,
      canClearRetainedData: true,
    });
  });

  it("sends no clear on cancel and exactly one scope clear on confirmation", () => {
    const environmentId = "env-clear" as EnvironmentId;
    const projectId = "project-clear" as ProjectId;
    const calls: unknown[] = [];
    const actions = mobileKnowledgeGraphClearConfirmationActions({
      environmentId,
      scope: { projectId },
      onConfirm: (target) => calls.push(target),
    });

    actions[0].onPress?.();
    expect(calls).toEqual([]);

    actions[1].onPress?.();
    expect(calls).toEqual([
      {
        environmentId,
        input: { target: "scope", scope: { projectId } },
      },
    ]);
  });

  it("derives reversible action states from the server status", () => {
    expect(resolveMobileKnowledgeGraphActions(status("indexing"), true)).toEqual({
      canCancel: true,
      canClear: true,
      canPause: true,
      canRebuild: false,
      pauseAction: "pause",
    });
    expect(resolveMobileKnowledgeGraphActions(status("paused"), true)).toEqual({
      canCancel: false,
      canClear: true,
      canPause: true,
      canRebuild: true,
      pauseAction: "resume",
    });
    expect(
      resolveMobileKnowledgeGraphActions(
        status("indexing", {
          version: 1,
          phase: "persisting",
          discoveredFileCount: 10,
          processedFileCount: 10,
          totalFileCount: 10,
          queuedSemanticNodeCount: 0,
        }),
        true,
      ),
    ).toEqual({
      canCancel: true,
      canClear: true,
      canPause: true,
      canRebuild: false,
      pauseAction: "pause",
    });
    expect(resolveMobileKnowledgeGraphActions(status("cancelling"), true)).toEqual({
      canCancel: false,
      canClear: false,
      canPause: false,
      canRebuild: false,
      pauseAction: "pause",
    });
  });

  it("toggles kind filters immutably without ES2023 array methods", () => {
    const kinds = new Set<KnowledgeGraphNodeKind>(["file"]);
    const added = toggleKnowledgeGraphKind(kinds, "symbol");
    const removed = toggleKnowledgeGraphKind(added, "file");

    expect([...kinds]).toEqual(["file"]);
    expect([...added]).toEqual(["file", "symbol"]);
    expect([...removed]).toEqual(["symbol"]);
  });

  it("opens bounded source locations only when a thread route exists", () => {
    const node = {
      source: { path: "src/graph.ts", startLine: 12 },
    } as KnowledgeGraphNodeV1;
    const environmentId = "env-1" as EnvironmentId;
    const threadId = "thread-1" as ThreadId;

    expect(knowledgeGraphSourceNavigationTarget({ environmentId, threadId, node })).toEqual({
      screen: "ThreadFile",
      params: {
        environmentId: "env-1",
        threadId: "thread-1",
        path: ["src", "graph.ts"],
        line: "12",
      },
    });
    expect(
      knowledgeGraphSourceNavigationTarget({ environmentId, threadId: undefined, node }),
    ).toBeNull();
  });

  it("opens the enabled graph from a thread with project and source context", () => {
    const environmentId = "env-1" as EnvironmentId;
    const projectId = "project-1" as ProjectId;
    const threadId = "thread-1" as ThreadId;

    expect(
      mobileKnowledgeGraphThreadEntryTarget({
        knowledgeGraphVersion: 1,
        enabled: true,
        environmentId,
        projectId,
        threadId,
      }),
    ).toEqual({
      screen: "KnowledgeGraph",
      params: {
        environmentId: "env-1",
        projectId: "project-1",
        threadId: "thread-1",
      },
    });
    expect(
      mobileKnowledgeGraphThreadEntryTarget({
        knowledgeGraphVersion: 1,
        enabled: false,
        environmentId,
        projectId,
        threadId,
      }),
    ).toBeNull();
    expect(
      mobileKnowledgeGraphThreadEntryTarget({
        knowledgeGraphVersion: undefined,
        enabled: true,
        environmentId,
        projectId,
        threadId,
      }),
    ).toBeNull();
  });

  it("keeps the project index entry independent of the legacy graph switch", () => {
    expect(
      mobileKnowledgeGraphThreadEntryTarget({
        knowledgeGraphVersion: undefined,
        projectIndexingVersion: 1,
        enabled: false,
        environmentId: "index-environment" as EnvironmentId,
        projectId: "index-project" as ProjectId,
        threadId: "index-thread" as ThreadId,
      }),
    ).toEqual({
      screen: "KnowledgeGraph",
      params: {
        environmentId: "index-environment",
        projectId: "index-project",
        threadId: "index-thread",
      },
    });
  });

  it("converts dragged screen distance into bounded graph coordinates", () => {
    expect(
      resolveMobileKnowledgeGraphDragPosition({
        start: { x: 100, y: 80 },
        translation: { x: 40, y: -20 },
        viewportScale: 2,
        canvas: { width: 240, height: 160 },
        node: { width: 116, height: 44 },
      }),
    ).toEqual({ x: 120, y: 70 });
    expect(
      resolveMobileKnowledgeGraphDragPosition({
        start: { x: 100, y: 80 },
        translation: { x: 10_000, y: -10_000 },
        viewportScale: 0,
        canvas: { width: 240, height: 160 },
        node: { width: 116, height: 44 },
      }),
    ).toEqual({ x: 182, y: 22 });
  });
});
