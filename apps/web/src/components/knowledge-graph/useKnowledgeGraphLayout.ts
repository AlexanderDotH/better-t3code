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
  type KnowledgeGraphLayoutWorkerRequest,
} from "./knowledgeGraphLayout";

export interface KnowledgeGraphLayoutState {
  readonly positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly isAnimating: boolean;
}

export function useKnowledgeGraphLayout(input: {
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly prefersReducedMotion: boolean;
  readonly restartToken: number;
}): KnowledgeGraphLayoutState {
  const requestId = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>>(new Map());
  const pinnedRef = useRef(input.pinned);
  const postedPinnedRef = useRef(input.pinned);
  const restartTokenRef = useRef(input.restartToken);
  const [positions, setPositions] = useState<
    ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>
  >(() => new Map());
  const [isAnimating, setIsAnimating] = useState(false);

  pinnedRef.current = input.pinned;

  useEffect(() => {
    requestId.current += 1;
    const restarted = restartTokenRef.current !== input.restartToken;
    restartTokenRef.current = input.restartToken;
    postedPinnedRef.current = pinnedRef.current;
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: requestId.current,
      nodes: input.nodes,
      edges: input.edges,
      width: input.width,
      height: input.height,
      pinned: pinnedRef.current,
      initialPositions: restarted ? new Map() : positionsRef.current,
      prefersReducedMotion: input.prefersReducedMotion,
    });
    if (typeof Worker === "undefined") {
      const next = computeKnowledgeGraphLayout({
        ...request,
        pinned: new Map(request.pinned),
        initialPositions: new Map(request.initialPositions),
      });
      positionsRef.current = next;
      setPositions(next);
      setIsAnimating(false);
      return;
    }
    const worker = new Worker(new URL("./knowledgeGraphLayout.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setIsAnimating(request.iterations > 0);
    worker.addEventListener("message", (event: MessageEvent<KnowledgeGraphLayoutResponse>) => {
      if (event.data.requestId !== requestId.current) return;
      const next = new Map(event.data.positions);
      positionsRef.current = next;
      setPositions(next);
      setIsAnimating(!event.data.settled);
    });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept a target origin.
    worker.postMessage(request);
    if (typeof document !== "undefined" && document.hidden) {
      worker.postMessage({
        type: "visibility",
        requestId: request.requestId,
        active: false,
      } satisfies KnowledgeGraphLayoutWorkerRequest); // oxlint-disable-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept a target origin.
    }
    return () => {
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
    };
  }, [
    input.edges,
    input.height,
    input.nodes,
    input.prefersReducedMotion,
    input.restartToken,
    input.width,
  ]);

  useEffect(() => {
    if (postedPinnedRef.current === input.pinned) return;
    postedPinnedRef.current = input.pinned;
    const merged = mergeKnowledgeGraphPinnedPositions(positionsRef.current, input.pinned);
    positionsRef.current = merged;
    setPositions(merged);
    const worker = workerRef.current;
    if (!worker) return;
    setIsAnimating(!input.prefersReducedMotion);
    worker.postMessage({
      type: "pin",
      requestId: requestId.current,
      pinned: [...input.pinned],
    } satisfies KnowledgeGraphLayoutWorkerRequest); // oxlint-disable-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept a target origin.
  }, [input.pinned, input.prefersReducedMotion]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const updateVisibility = () => {
      const worker = workerRef.current;
      if (!worker) return;
      worker.postMessage({
        type: "visibility",
        requestId: requestId.current,
        active: !document.hidden,
      } satisfies KnowledgeGraphLayoutWorkerRequest); // oxlint-disable-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept a target origin.
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  return useMemo(
    () => ({
      positions: mergeKnowledgeGraphPinnedPositions(positions, input.pinned),
      isAnimating,
    }),
    [input.pinned, isAnimating, positions],
  );
}
