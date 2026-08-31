import { useAtomValue } from "@effect/atom-react";
import {
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphEdgeV1,
  type EnvironmentId,
  type ProjectId,
  resolveBetterT3FeatureFlag,
  type ThreadId,
} from "@t3tools/contracts";
import type { KnowledgeGraphPosition } from "@t3tools/client-runtime/knowledge-graph";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ensureLocalApi } from "../../localApi";
import { knowledgeGraphEnvironment } from "../../state/knowledgeGraph";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { KnowledgeGraphPanelView, type KnowledgeGraphTranslate } from "./KnowledgeGraphPanel";
import {
  confirmAndClearKnowledgeGraph,
  isKnowledgeGraphDragGesture,
  resolveKnowledgeGraphDraggedPosition,
} from "./knowledgeGraphActions";
import { resolveKnowledgeGraphLoadState } from "./knowledgeGraphPanelState";
import { useKnowledgeGraphLayout } from "./useKnowledgeGraphLayout";

interface KnowledgeGraphPanelControllerProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly knowledgeGraphVersion?: number;
  readonly onOpenSource: (path: string, line: number | null) => void;
}

export type KnowledgeGraphPanelMode = "unsupported" | "disabled-owner" | "connected";

export function resolveKnowledgeGraphPanelMode(input: {
  readonly knowledgeGraphVersion: number | undefined;
  readonly enabled: boolean;
}): KnowledgeGraphPanelMode {
  if ((input.knowledgeGraphVersion ?? 0) < 1) return "unsupported";
  return input.enabled ? "connected" : "disabled-owner";
}

const EMPTY_NODES: ReadonlyArray<KnowledgeGraphNodeV1> = [];
const EMPTY_EDGES: ReadonlyArray<KnowledgeGraphEdgeV1> = [];

function KnowledgeGraphNodeContent(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: { readonly projectId: ProjectId; readonly threadId?: ThreadId };
  readonly nodeId: KnowledgeGraphNodeId;
  readonly translate: KnowledgeGraphTranslate;
}) {
  const result = useAtomValue(
    knowledgeGraphEnvironment.nodeContent({
      environmentId: props.environmentId,
      input: { scope: props.scope, nodeId: props.nodeId },
    }),
  );
  const content = Option.getOrNull(AsyncResult.value(result));
  if (!content) return null;
  if (content.excerpts.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {props.translate("knowledgeGraph.sourceUnavailable")}
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {content.excerpts.map((excerpt) => (
        <pre
          key={`${excerpt.source.path}:${excerpt.source.startLine ?? 0}`}
          className="max-h-40 overflow-auto rounded-md bg-muted/55 p-2 text-[11px] whitespace-pre-wrap"
        >
          {excerpt.excerpt}
        </pre>
      ))}
    </div>
  );
}

function KnowledgeGraphUnavailable(props: {
  readonly messageKey:
    | "knowledgeGraph.unsupported"
    | "knowledgeGraph.disabled"
    | "knowledgeGraph.error";
}) {
  const translator = useInterfaceTranslator();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {translator.message(props.messageKey)}
    </div>
  );
}

export function KnowledgeGraphDisabledOwnerView(props: {
  readonly translate: KnowledgeGraphTranslate;
  readonly onClear: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <p>{props.translate("knowledgeGraph.disabled")}</p>
      <Button size="xs" variant="outline" onClick={props.onClear}>
        {props.translate("knowledgeGraph.clear")}
      </Button>
    </div>
  );
}

function KnowledgeGraphDisabledOwner(props: KnowledgeGraphPanelControllerProps) {
  const clear = useAtomCommand(knowledgeGraphEnvironment.clear, { reportFailure: false });
  const translator = useInterfaceTranslator();
  const scope = {
    projectId: props.projectId,
    ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
  };
  return (
    <KnowledgeGraphDisabledOwnerView
      translate={translator.message}
      onClear={() => {
        void confirmAndClearKnowledgeGraph({
          environmentId: props.environmentId,
          scope,
          confirm: () =>
            ensureLocalApi().dialogs.confirm(
              translator.message("knowledgeGraph.clearConfirm.description"),
              { variant: "destructive" },
            ),
          clear,
        });
      }}
    />
  );
}

function ConnectedKnowledgeGraphPanel(props: KnowledgeGraphPanelControllerProps) {
  const scope = useMemo(
    () => ({
      projectId: props.projectId,
      ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
    }),
    [props.projectId, props.threadId],
  );
  const graphStateResult = useAtomValue(
    knowledgeGraphEnvironment.state({
      environmentId: props.environmentId,
      input: { scope },
    }),
  );
  const graphState = Option.getOrNull(AsyncResult.value(graphStateResult));
  const snapshot = graphState?.snapshot ?? null;
  const loadState = resolveKnowledgeGraphLoadState(graphStateResult._tag, snapshot !== null);
  const rebuild = useAtomCommand(knowledgeGraphEnvironment.rebuild, { reportFailure: false });
  const cancel = useAtomCommand(knowledgeGraphEnvironment.cancel, { reportFailure: false });
  const pause = useAtomCommand(knowledgeGraphEnvironment.pause, { reportFailure: false });
  const clear = useAtomCommand(knowledgeGraphEnvironment.clear, { reportFailure: false });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [kinds, setKinds] = useState<ReadonlySet<KnowledgeGraphNodeKind>>(() => new Set());
  const [expandedNodeId, setExpandedNodeId] = useState<KnowledgeGraphNodeId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pinned, setPinned] = useState<ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>>(
    () => new Map(),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressNodeClickRef = useRef(false);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const translator = useInterfaceTranslator();
  const translate = useCallback<KnowledgeGraphTranslate>(
    (key, values) => translator.message(key, values),
    [translator],
  );

  const remoteQueryResult = useAtomValue(
    knowledgeGraphEnvironment.query({
      environmentId: props.environmentId,
      input: {
        scope,
        queries:
          deferredQuery.length > 0
            ? [{ id: "web-search", type: "search", text: deferredQuery, limit: 300 }]
            : [{ id: "web-overview", type: "overview" }],
      },
    }),
  );
  const remoteQuery = Option.getOrNull(AsyncResult.value(remoteQueryResult));
  const remoteSearchResult = deferredQuery.length > 0 ? remoteQuery?.results[0] : null;
  const displayedSnapshot = useMemo(() => {
    if (!snapshot || !remoteSearchResult) return snapshot;
    return {
      ...snapshot,
      revision: remoteQuery?.revision ?? snapshot.revision,
      nodes: [...remoteSearchResult.nodes],
      edges: [...remoteSearchResult.edges],
      evidence: [...remoteSearchResult.evidence],
      status: {
        ...snapshot.status,
        truncated: {
          ...snapshot.status.truncated,
          visibleNodes: snapshot.status.truncated.visibleNodes || remoteSearchResult.truncated,
        },
      },
    };
  }, [remoteQuery?.revision, remoteSearchResult, snapshot]);

  const positions = useKnowledgeGraphLayout({
    nodes: displayedSnapshot?.nodes ?? EMPTY_NODES,
    edges: displayedSnapshot?.edges ?? EMPTY_EDGES,
    width: size.width,
    height: size.height,
    pinned,
    prefersReducedMotion,
  });

  const panelNode = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toggleKind = useCallback((kind: KnowledgeGraphNodeKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const startNodeDrag = useCallback(
    (nodeId: KnowledgeGraphNodeId, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      dragCleanupRef.current?.();
      suppressNodeClickRef.current = false;
      const start = { x: event.clientX, y: event.clientY };
      const canvas = event.currentTarget.offsetParent;
      event.currentTarget.setPointerCapture(event.pointerId);
      const move = (pointerEvent: PointerEvent) => {
        if (
          !suppressNodeClickRef.current &&
          isKnowledgeGraphDragGesture(start, {
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
          })
        ) {
          suppressNodeClickRef.current = true;
        }
        const bounds = canvas?.getBoundingClientRect() ?? panelRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const position = resolveKnowledgeGraphDraggedPosition(
          { x: pointerEvent.clientX, y: pointerEvent.clientY },
          bounds,
          zoom,
        );
        setPinned((current) => new Map(current).set(nodeId, position));
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (dragCleanupRef.current === finish) dragCleanupRef.current = null;
      };
      dragCleanupRef.current = finish;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [zoom],
  );
  const expandNode = useCallback((nodeId: KnowledgeGraphNodeId | null) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    setExpandedNodeId(nodeId);
  }, []);

  if (loadState === "error") {
    return <KnowledgeGraphUnavailable messageKey="knowledgeGraph.error" />;
  }
  if (!displayedSnapshot) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {translate("knowledgeGraph.loading")}
      </div>
    );
  }

  const paused = displayedSnapshot.status.state === "paused";
  const active = ["indexing", "semantic", "cancelling"].includes(displayedSnapshot.status.state);
  return (
    <div ref={panelNode} className="flex min-h-0 flex-1">
      <KnowledgeGraphPanelView
        snapshot={displayedSnapshot}
        positions={positions}
        width={size.width}
        height={size.height}
        query={query}
        kinds={kinds}
        expandedNodeId={expandedNodeId}
        zoom={zoom}
        prefersReducedMotion={prefersReducedMotion}
        translate={translate}
        formatConfidence={(confidence) =>
          translator.number(confidence, { style: "percent", maximumFractionDigits: 0 })
        }
        onQueryChange={setQuery}
        onToggleKind={toggleKind}
        onZoomChange={setZoom}
        onResetView={() => {
          setPinned(new Map());
          setZoom(1);
        }}
        onExpandNode={expandNode}
        onOpenSource={props.onOpenSource}
        onNodePointerDown={startNodeDrag}
        expandedDetails={
          expandedNodeId ? (
            <KnowledgeGraphNodeContent
              environmentId={props.environmentId}
              scope={scope}
              nodeId={expandedNodeId}
              translate={translate}
            />
          ) : null
        }
        headerActions={
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void rebuild({
                  environmentId: props.environmentId,
                  input: { scope, mode: "incremental" },
                })
              }
            >
              {translate("knowledgeGraph.rebuild")}
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() =>
                void pause({
                  environmentId: props.environmentId,
                  input: { scope, paused: !paused },
                })
              }
            >
              {translate(paused ? "knowledgeGraph.resume" : "knowledgeGraph.pause")}
            </Button>
            {active ? (
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() =>
                  void cancel({ environmentId: props.environmentId, input: { scope } })
                }
              >
                {translate("knowledgeGraph.cancel")}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => {
                void confirmAndClearKnowledgeGraph({
                  environmentId: props.environmentId,
                  scope,
                  confirm: () =>
                    ensureLocalApi().dialogs.confirm(
                      translate("knowledgeGraph.clearConfirm.description"),
                      { variant: "destructive" },
                    ),
                  clear,
                });
              }}
            >
              {translate("knowledgeGraph.clear")}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function KnowledgeGraphPanelController(props: KnowledgeGraphPanelControllerProps) {
  const settings = useEnvironmentSettings(props.environmentId);
  const enabled = resolveBetterT3FeatureFlag(settings.betterT3Environment, "knowledge.graph");
  const mode = resolveKnowledgeGraphPanelMode({
    knowledgeGraphVersion: props.knowledgeGraphVersion,
    enabled,
  });
  if (mode === "unsupported") {
    return <KnowledgeGraphUnavailable messageKey="knowledgeGraph.unsupported" />;
  }
  if (mode === "disabled-owner") {
    return <KnowledgeGraphDisabledOwner {...props} />;
  }
  return <ConnectedKnowledgeGraphPanel {...props} />;
}
