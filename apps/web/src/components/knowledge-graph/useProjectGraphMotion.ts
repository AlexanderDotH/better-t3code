import { useEffect, useRef, useState } from "react";

const TRANSITION_MS = 280;
interface PositionedNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly x: number;
  readonly y: number;
}

/** A finite transition keeps links attached while expanding; no frames run once it settles. */
export function useProjectGraphMotion<Node extends PositionedNode>(target: ReadonlyArray<Node>) {
  const [positions, setPositions] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (target === current.current) return;
    const commit = (nodes: ReadonlyArray<Node>) => {
      current.current = nodes;
      setPositions(nodes);
    };
    if (
      typeof window === "undefined" ||
      !window.requestAnimationFrame ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      commit(target);
      return;
    }
    const previous = new Map(current.current.map((node) => [node.id, node]));
    const starts = target.map(
      (node) => previous.get(node.id) ?? previous.get(node.parentId ?? "") ?? node,
    );
    const startedAt = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / TRANSITION_MS);
      const eased = 1 - (1 - progress) ** 3;
      commit(
        progress === 1
          ? target
          : target.map((node, index) => ({
              ...node,
              x: starts[index]!.x + (node.x - starts[index]!.x) * eased,
              y: starts[index]!.y + (node.y - starts[index]!.y) * eased,
            })),
      );
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);
  return positions;
}
