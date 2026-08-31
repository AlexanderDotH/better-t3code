import type {
  EnvironmentId,
  KnowledgeGraphClearInput,
  KnowledgeGraphScopeInput,
} from "@t3tools/contracts";

interface KnowledgeGraphClearRequest {
  readonly environmentId: EnvironmentId;
  readonly input: KnowledgeGraphClearInput;
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

interface PointerBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function isKnowledgeGraphDragGesture(
  start: PointerPosition,
  current: PointerPosition,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= 4;
}

export function resolveKnowledgeGraphDraggedPosition(
  pointer: PointerPosition,
  bounds: PointerBounds,
  zoom: number,
): PointerPosition {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: Math.min(Math.max(pointer.x - bounds.left, 0), Math.max(0, bounds.width)) / scale,
    y: Math.min(Math.max(pointer.y - bounds.top, 0), Math.max(0, bounds.height)) / scale,
  };
}

export async function confirmAndClearKnowledgeGraph(input: {
  readonly environmentId: EnvironmentId;
  readonly scope: KnowledgeGraphScopeInput;
  readonly confirm: () => Promise<boolean>;
  readonly clear: (request: KnowledgeGraphClearRequest) => unknown;
}): Promise<boolean> {
  if (!(await input.confirm())) return false;
  await input.clear({
    environmentId: input.environmentId,
    input: { target: "scope", scope: input.scope },
  });
  return true;
}
