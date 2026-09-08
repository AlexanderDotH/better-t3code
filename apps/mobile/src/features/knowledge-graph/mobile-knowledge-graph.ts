import type {
  EnvironmentId,
  KnowledgeGraphEdgeKind,
  KnowledgeGraphNodeKind,
  KnowledgeGraphNodeV1,
  KnowledgeGraphProvenance,
  KnowledgeGraphScopeInput,
  KnowledgeGraphState,
  KnowledgeGraphStatusV1,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

const KNOWLEDGE_GRAPH_NODE_KIND_MESSAGE_KEYS = {
  repository: "knowledgeGraph.nodeKind.repository",
  package: "knowledgeGraph.nodeKind.package",
  directory: "knowledgeGraph.nodeKind.directory",
  file: "knowledgeGraph.nodeKind.file",
  symbol: "knowledgeGraph.nodeKind.symbol",
  dependency: "knowledgeGraph.nodeKind.dependency",
  technology: "knowledgeGraph.nodeKind.technology",
  documentation: "knowledgeGraph.nodeKind.documentation",
  architecture: "knowledgeGraph.nodeKind.architecture",
} as const satisfies Readonly<Record<KnowledgeGraphNodeKind, InterfaceMessageKey>>;

const KNOWLEDGE_GRAPH_EDGE_KIND_MESSAGE_KEYS = {
  contains: "knowledgeGraph.edgeKind.contains",
  declares: "knowledgeGraph.edgeKind.declares",
  imports: "knowledgeGraph.edgeKind.imports",
  "depends-on": "knowledgeGraph.edgeKind.depends-on",
  uses: "knowledgeGraph.edgeKind.uses",
  implements: "knowledgeGraph.edgeKind.implements",
  extends: "knowledgeGraph.edgeKind.extends",
  documents: "knowledgeGraph.edgeKind.documents",
  configures: "knowledgeGraph.edgeKind.configures",
  "co-changes-with": "knowledgeGraph.edgeKind.co-changes-with",
  "relates-to": "knowledgeGraph.edgeKind.relates-to",
} as const satisfies Readonly<Record<KnowledgeGraphEdgeKind, InterfaceMessageKey>>;

const KNOWLEDGE_GRAPH_PROVENANCE_MESSAGE_KEYS = {
  deterministic: "knowledgeGraph.provenance.deterministic",
  semantic: "knowledgeGraph.provenance.semantic",
} as const satisfies Readonly<Record<KnowledgeGraphProvenance, InterfaceMessageKey>>;

export type MobileKnowledgeGraphDirection = "incoming" | "outgoing";

const KNOWLEDGE_GRAPH_DIRECTION_MESSAGE_KEYS = {
  incoming: "knowledgeGraph.direction.incoming",
  outgoing: "knowledgeGraph.direction.outgoing",
} as const satisfies Readonly<Record<MobileKnowledgeGraphDirection, InterfaceMessageKey>>;

const KNOWLEDGE_GRAPH_STATUS_MESSAGE_KEYS = {
  disabled: "knowledgeGraph.status.disabled",
  idle: "knowledgeGraph.status.idle",
  indexing: "knowledgeGraph.status.indexing",
  semantic: "knowledgeGraph.status.semantic",
  ready: "knowledgeGraph.status.ready",
  paused: "knowledgeGraph.status.paused",
  "rate-limited": "knowledgeGraph.status.rate-limited",
  cancelling: "knowledgeGraph.status.cancelling",
  error: "knowledgeGraph.status.error",
} as const satisfies Readonly<Record<KnowledgeGraphState, InterfaceMessageKey>>;

export function knowledgeGraphNodeKindMessageKey(
  kind: KnowledgeGraphNodeKind,
): InterfaceMessageKey {
  return KNOWLEDGE_GRAPH_NODE_KIND_MESSAGE_KEYS[kind];
}

export function knowledgeGraphEdgeKindMessageKey(
  kind: KnowledgeGraphEdgeKind,
): InterfaceMessageKey {
  return KNOWLEDGE_GRAPH_EDGE_KIND_MESSAGE_KEYS[kind];
}

export function knowledgeGraphProvenanceMessageKey(
  provenance: KnowledgeGraphProvenance,
): InterfaceMessageKey {
  return KNOWLEDGE_GRAPH_PROVENANCE_MESSAGE_KEYS[provenance];
}

export function knowledgeGraphDirectionMessageKey(
  direction: MobileKnowledgeGraphDirection,
): InterfaceMessageKey {
  return KNOWLEDGE_GRAPH_DIRECTION_MESSAGE_KEYS[direction];
}

export function knowledgeGraphStatusMessageKey(state: KnowledgeGraphState): InterfaceMessageKey {
  return KNOWLEDGE_GRAPH_STATUS_MESSAGE_KEYS[state];
}

export type MobileKnowledgeGraphAccess = "available" | "disabled" | "unsupported";

export function resolveMobileKnowledgeGraphAccess(input: {
  readonly knowledgeGraphVersion: number | undefined;
  readonly enabled: boolean;
}): MobileKnowledgeGraphAccess {
  if ((input.knowledgeGraphVersion ?? 0) < 1) return "unsupported";
  return input.enabled ? "available" : "disabled";
}

export interface MobileKnowledgeGraphRoutePolicy {
  readonly canOpenOwnerRoute: boolean;
  readonly canSubscribe: boolean;
  readonly canQuery: boolean;
  readonly canReadNodeContent: boolean;
  readonly canRebuild: boolean;
  readonly canPause: boolean;
  readonly canCancel: boolean;
  readonly canClearRetainedData: boolean;
}

export function resolveMobileKnowledgeGraphRoutePolicy(
  access: MobileKnowledgeGraphAccess,
): MobileKnowledgeGraphRoutePolicy {
  const supported = access !== "unsupported";
  const active = access === "available";
  return {
    canOpenOwnerRoute: supported,
    canSubscribe: active,
    canQuery: active,
    canReadNodeContent: active,
    canRebuild: active,
    canPause: active,
    canCancel: active,
    canClearRetainedData: supported,
  };
}

export interface MobileKnowledgeGraphClearCommandTarget {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly target: "scope";
    readonly scope: KnowledgeGraphScopeInput;
  };
}

export interface MobileKnowledgeGraphConfirmationAction {
  readonly style: "cancel" | "destructive";
  readonly onPress?: () => void;
}

export function mobileKnowledgeGraphClearConfirmationActions(input: {
  readonly environmentId: EnvironmentId;
  readonly scope: KnowledgeGraphScopeInput;
  readonly onConfirm: (target: MobileKnowledgeGraphClearCommandTarget) => void;
}): readonly [MobileKnowledgeGraphConfirmationAction, MobileKnowledgeGraphConfirmationAction] {
  return [
    { style: "cancel" },
    {
      style: "destructive",
      onPress: () =>
        input.onConfirm({
          environmentId: input.environmentId,
          input: { target: "scope", scope: input.scope },
        }),
    },
  ];
}

export interface MobileKnowledgeGraphActions {
  readonly canCancel: boolean;
  readonly canClear: boolean;
  readonly canPause: boolean;
  readonly canRebuild: boolean;
  readonly pauseAction: "pause" | "resume";
}

export function resolveMobileKnowledgeGraphActions(
  status: KnowledgeGraphStatusV1,
): MobileKnowledgeGraphActions {
  const busy =
    status.state === "indexing" || status.state === "semantic" || status.state === "cancelling";
  return {
    canCancel: status.state === "indexing" || status.state === "semantic",
    canClear: status.state !== "cancelling",
    canPause:
      status.state === "indexing" ||
      status.state === "semantic" ||
      status.state === "paused" ||
      status.state === "rate-limited",
    canRebuild: !busy,
    pauseAction: status.state === "paused" ? "resume" : "pause",
  };
}

export function toggleKnowledgeGraphKind(
  kinds: ReadonlySet<KnowledgeGraphNodeKind>,
  kind: KnowledgeGraphNodeKind,
): ReadonlySet<KnowledgeGraphNodeKind> {
  const next = new Set(kinds);
  if (!next.delete(kind)) next.add(kind);
  return next;
}

interface MobileKnowledgeGraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface MobileKnowledgeGraphDragGesture {
  readonly start: MobileKnowledgeGraphPoint;
  readonly translation: MobileKnowledgeGraphPoint;
  readonly viewportScale: number;
}

export function resolveMobileKnowledgeGraphDragPosition(
  input: MobileKnowledgeGraphDragGesture & {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly node: { readonly width: number; readonly height: number };
  },
): MobileKnowledgeGraphPoint {
  const scale =
    Number.isFinite(input.viewportScale) && input.viewportScale > 0 ? input.viewportScale : 1;
  const halfWidth = Math.max(0, input.node.width / 2);
  const halfHeight = Math.max(0, input.node.height / 2);
  const x = input.start.x + input.translation.x / scale;
  const y = input.start.y + input.translation.y / scale;
  return {
    x: Math.max(halfWidth, Math.min(input.canvas.width - halfWidth, x)),
    y: Math.max(halfHeight, Math.min(input.canvas.height - halfHeight, y)),
  };
}

export interface KnowledgeGraphSourceNavigationTarget {
  readonly screen: "ThreadFile";
  readonly params: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly path: string[];
    readonly line?: string;
  };
}

export function knowledgeGraphSourceNavigationTarget(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
  readonly node: KnowledgeGraphNodeV1;
}): KnowledgeGraphSourceNavigationTarget | null {
  const source = input.node.source;
  if (!source || input.threadId === undefined) return null;
  const path = source.path.split("/").filter((segment) => segment.length > 0);
  if (path.length === 0) return null;
  return {
    screen: "ThreadFile",
    params: {
      environmentId: String(input.environmentId),
      threadId: String(input.threadId),
      path,
      ...(source.startLine === undefined ? {} : { line: String(source.startLine) }),
    },
  };
}

export interface MobileKnowledgeGraphThreadEntryTarget {
  readonly screen: "KnowledgeGraph";
  readonly params: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId: string;
  };
}

export function mobileKnowledgeGraphThreadEntryTarget(input: {
  readonly knowledgeGraphVersion: number | undefined;
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}): MobileKnowledgeGraphThreadEntryTarget | null {
  if (resolveMobileKnowledgeGraphAccess(input) !== "available") return null;
  return {
    screen: "KnowledgeGraph",
    params: {
      environmentId: String(input.environmentId),
      projectId: String(input.projectId),
      threadId: String(input.threadId),
    },
  };
}
