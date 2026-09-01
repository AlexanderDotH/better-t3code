/// <reference lib="webworker" />

import {
  computeKnowledgeGraphLayout,
  type KnowledgeGraphPosition,
} from "@t3tools/client-runtime/knowledge-graph";
import type { KnowledgeGraphNodeId } from "@t3tools/contracts";

import {
  advanceKnowledgeGraphLayoutFrame,
  KNOWLEDGE_GRAPH_LAYOUT_FRAME_DELAY_MS,
  type KnowledgeGraphLayoutPinRequest,
  type KnowledgeGraphLayoutResponse,
  type KnowledgeGraphLayoutRequest,
  type KnowledgeGraphLayoutVisibilityRequest,
  type KnowledgeGraphLayoutWorkerRequest,
} from "./knowledgeGraphLayout";

const worker = self as DedicatedWorkerGlobalScope;

interface ActiveLayout {
  readonly request: KnowledgeGraphLayoutRequest;
  positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  remainingIterations: number;
  stableFrames: number;
  settled: boolean;
}

let activeLayout: ActiveLayout | null = null;
let frameTimer: number | null = null;
let visible = true;

const clearFrameTimer = () => {
  if (frameTimer === null) return;
  worker.clearTimeout(frameTimer);
  frameTimer = null;
};

const publishFrame = (layout: ActiveLayout) => {
  worker.postMessage({
    type: "frame",
    requestId: layout.request.requestId,
    positions: [...layout.positions],
    settled: layout.settled,
  } satisfies KnowledgeGraphLayoutResponse); // oxlint-disable-line unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target-origin overload.
};

const runFrame = () => {
  frameTimer = null;
  const layout = activeLayout;
  if (!layout || !visible || layout.settled) return;
  const frame = advanceKnowledgeGraphLayoutFrame({
    request: layout.request,
    positions: layout.positions,
    pinned: layout.pinned,
    remainingIterations: layout.remainingIterations,
  });
  layout.positions = frame.positions;
  layout.remainingIterations = frame.remainingIterations;
  layout.stableFrames = frame.stable ? layout.stableFrames + 1 : 0;
  layout.settled = layout.remainingIterations === 0 || layout.stableFrames >= 4;
  publishFrame(layout);
  if (!layout.settled) scheduleFrame();
};

function scheduleFrame() {
  if (frameTimer !== null || !visible || !activeLayout || activeLayout.settled) return;
  frameTimer = worker.setTimeout(runFrame, KNOWLEDGE_GRAPH_LAYOUT_FRAME_DELAY_MS);
}

const startLayout = (request: KnowledgeGraphLayoutRequest) => {
  clearFrameTimer();
  const pinned = new Map(request.pinned);
  const positions = computeKnowledgeGraphLayout({
    nodes: request.nodes,
    edges: request.edges,
    width: request.width,
    height: request.height,
    pinned,
    initialPositions: new Map(request.initialPositions),
    iterations: 0,
  });
  activeLayout = {
    request,
    positions,
    pinned,
    remainingIterations: request.iterations,
    stableFrames: 0,
    settled: request.iterations === 0,
  };
  publishFrame(activeLayout);
  scheduleFrame();
};

const updatePins = (request: KnowledgeGraphLayoutPinRequest) => {
  const layout = activeLayout;
  if (!layout || layout.request.requestId !== request.requestId) return;
  layout.pinned = new Map(request.pinned);
  layout.positions = new Map([...layout.positions, ...layout.pinned]);
  layout.remainingIterations = layout.request.iterations;
  layout.stableFrames = 0;
  layout.settled = layout.request.iterations === 0;
  publishFrame(layout);
  scheduleFrame();
};

const updateVisibility = (request: KnowledgeGraphLayoutVisibilityRequest) => {
  const layout = activeLayout;
  if (!layout || layout.request.requestId !== request.requestId) return;
  visible = request.active;
  if (visible) scheduleFrame();
  else clearFrameTimer();
};

worker.addEventListener("message", (event: MessageEvent<KnowledgeGraphLayoutWorkerRequest>) => {
  const request = event.data;
  if (request.type === "start") startLayout(request);
  else if (request.type === "pin") updatePins(request);
  else updateVisibility(request);
});
