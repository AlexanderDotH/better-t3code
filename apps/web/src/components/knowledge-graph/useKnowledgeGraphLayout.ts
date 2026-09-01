import {
  computeKnowledgeGraphLayout,
  type KnowledgeGraphPosition,
} from "@t3tools/client-runtime/knowledge-graph";
import type {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphNodeId,
  KnowledgeGraphNodeV1,
} from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  makeKnowledgeGraphLayoutRequest,
  mergeKnowledgeGraphPinnedPositions,
  type KnowledgeGraphLayoutResponse,
} from "./knowledgeGraphLayout";

export function useKnowledgeGraphLayout(input: {
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly prefersReducedMotion: boolean;
}): ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition> {
  const requestId = useRef(0);
  const [positions, setPositions] = useState<
    ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>
  >(() => new Map());

  useEffect(() => {
    requestId.current += 1;
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: requestId.current,
      nodes: input.nodes,
      edges: input.edges,
      width: input.width,
      height: input.height,
      pinned: new Map(),
      prefersReducedMotion: input.prefersReducedMotion,
    });
    if (typeof Worker === "undefined") {
      setPositions(
        computeKnowledgeGraphLayout({
          ...request,
          pinned: new Map(request.pinned),
        }),
      );
      return;
    }
    const worker = new Worker(new URL("./knowledgeGraphLayout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<KnowledgeGraphLayoutResponse>) => {
      if (event.data.requestId === requestId.current) {
        setPositions(new Map(event.data.positions));
      }
    });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept a target origin.
    worker.postMessage(request);
    return () => worker.terminate();
  }, [input.edges, input.height, input.nodes, input.prefersReducedMotion, input.width]);

  return useMemo(
    () => mergeKnowledgeGraphPinnedPositions(positions, input.pinned),
    [input.pinned, positions],
  );
}
