import { useCallback, useEffect, useRef, useState } from "react";

import {
  stepProjectGraphPhysics,
  type GraphBody,
  type GraphLink,
  type GraphPoint,
} from "./projectGraphPhysics";

const TRANSITION_MS = 280;
const PHYSICS_STEP_MS = 1000 / 60;
const MAX_SETTLE_MS = 1400;
const SETTLED_SPEED = 0.03;
const EMPTY_LINKS: ReadonlyArray<GraphLink> = [];
interface PositionedNode extends GraphPoint {
  readonly id: string;
  readonly parentId: string | null;
}

function reducedMotion() {
  return (
    typeof window === "undefined" ||
    !window.requestAnimationFrame ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Layout changes and direct manipulation share one finite animation; idle graphs request no frames. */
export function useProjectGraphMotion<Node extends PositionedNode>(
  target: ReadonlyArray<Node>,
  links: ReadonlyArray<GraphLink> = EMPTY_LINKS,
) {
  const [positions, setPositions] = useState(target);
  const current = useRef(target);
  const frame = useRef<number | null>(null);
  const physicsActive = useRef(false);
  const lastInteractionAt = useRef(0);
  const bodies = useRef<ReadonlyArray<GraphBody>>([]);
  const pinned = useRef(new Map<string, GraphPoint>());
  const commit = useCallback((nodes: ReadonlyArray<Node>) => {
    current.current = nodes;
    setPositions(nodes);
  }, []);
  const stop = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    physicsActive.current = false;
  }, []);

  const animateLayout = useCallback(() => {
    stop();
    pinned.current.clear();
    bodies.current = [];
    if (target === current.current) return stop;
    if (reducedMotion()) {
      // Publish the destination without scheduling animation frames for reduced motion.
      // oxlint-disable-next-line react/set-state-in-effect
      commit(target);
      return stop;
    }
    const previous = new Map(current.current.map((node) => [node.id, node]));
    const starts = target.map(
      (node) => previous.get(node.id) ?? previous.get(node.parentId ?? "") ?? node,
    );
    const startedAt = performance.now();
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
      frame.current = progress < 1 ? window.requestAnimationFrame(step) : null;
    };
    frame.current = window.requestAnimationFrame(step);
    return stop;
  }, [target, commit, stop]);
  useEffect(animateLayout, [animateLayout]);

  const settle = useCallback(() => {
    lastInteractionAt.current = performance.now();
    if (physicsActive.current) return;
    stop();
    if (reducedMotion() || bodies.current.length !== current.current.length) return;
    physicsActive.current = true;
    const anchors = new Map(target.map((node) => [node.id, node]));
    let lastStepAt = performance.now();
    const step = (now: number) => {
      const steps = Math.min(6, Math.floor((now - lastStepAt) / PHYSICS_STEP_MS));
      for (let index = 0; index < steps; index++)
        bodies.current = stepProjectGraphPhysics(bodies.current, anchors, links, pinned.current);
      if (steps > 0) {
        lastStepAt = now - ((now - lastStepAt) % PHYSICS_STEP_MS);
        commit(
          current.current.map((node, index) => ({
            ...node,
            x: bodies.current[index]!.x,
            y: bodies.current[index]!.y,
          })),
        );
      }
      const moving = bodies.current.some((body) => Math.hypot(body.vx, body.vy) > SETTLED_SPEED);
      frame.current =
        now - lastInteractionAt.current < MAX_SETTLE_MS && (steps === 0 || moving)
          ? window.requestAnimationFrame(step)
          : null;
      physicsActive.current = frame.current !== null;
    };
    frame.current = window.requestAnimationFrame(step);
  }, [target, links, stop, commit]);

  const moveNode = useCallback(
    (id: string, point: GraphPoint) => {
      if (!current.current.some((node) => node.id === id)) return;
      if (!physicsActive.current) stop();
      pinned.current.set(id, point);
      commit(current.current.map((node) => (node.id === id ? { ...node, ...point } : node)));
      const previous = new Map(bodies.current.map((body) => [body.id, body]));
      bodies.current = current.current.map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        vx: previous.get(node.id)?.vx ?? 0,
        vy: previous.get(node.id)?.vy ?? 0,
      }));
      settle();
    },
    [commit, settle, stop],
  );

  return {
    nodes: positions,
    moveNode,
    releaseNode: settle,
    reset: () => {
      animateLayout();
    },
  };
}
