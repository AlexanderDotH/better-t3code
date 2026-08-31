/// <reference lib="webworker" />

import { computeKnowledgeGraphLayout } from "@t3tools/client-runtime/knowledge-graph";

import type {
  KnowledgeGraphLayoutRequest,
  KnowledgeGraphLayoutResponse,
} from "./knowledgeGraphLayout";

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener("message", (event: MessageEvent<KnowledgeGraphLayoutRequest>) => {
  const request = event.data;
  const positions = computeKnowledgeGraphLayout({
    nodes: request.nodes,
    edges: request.edges,
    width: request.width,
    height: request.height,
    pinned: new Map(request.pinned),
    iterations: request.iterations,
  });
  worker.postMessage({
    requestId: request.requestId,
    positions: [...positions],
  } satisfies KnowledgeGraphLayoutResponse); // oxlint-disable-line unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target-origin overload.
});
