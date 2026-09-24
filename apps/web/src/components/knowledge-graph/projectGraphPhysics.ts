export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface GraphBody extends GraphPoint {
  readonly id: string;
  readonly vx: number;
  readonly vy: number;
}

export interface GraphLink {
  readonly sourceId: string;
  readonly targetId: string;
}

const GRAVITY = 0.018;
const SPRING = 0.025;
const DAMPING = 0.78;
const SEPARATION = 88;
const REPULSION = 0.08;
const MAX_SPEED = 24;

/** One fixed 60 Hz step; anchors preserve the map's shape while links pull nearby nodes along. */
export function stepProjectGraphPhysics(
  bodies: ReadonlyArray<GraphBody>,
  anchors: ReadonlyMap<string, GraphPoint>,
  links: ReadonlyArray<GraphLink>,
  pinned: ReadonlyMap<string, GraphPoint>,
) {
  const byId = new Map(bodies.map((body, index) => [body.id, index]));
  const forces = bodies.map((body) => {
    const anchor = anchors.get(body.id) ?? body;
    return { x: (anchor.x - body.x) * GRAVITY, y: (anchor.y - body.y) * GRAVITY };
  });
  for (const link of links) {
    const sourceIndex = byId.get(link.sourceId);
    const targetIndex = byId.get(link.targetId);
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex)
      continue;
    const source = bodies[sourceIndex]!;
    const target = bodies[targetIndex]!;
    const sourceAnchor = anchors.get(source.id) ?? source;
    const targetAnchor = anchors.get(target.id) ?? target;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const restLength = Math.max(
      SEPARATION,
      Math.hypot(targetAnchor.x - sourceAnchor.x, targetAnchor.y - sourceAnchor.y),
    );
    const pull = ((distance - restLength) * SPRING) / distance;
    forces[sourceIndex]!.x += dx * pull;
    forces[sourceIndex]!.y += dy * pull;
    forces[targetIndex]!.x -= dx * pull;
    forces[targetIndex]!.y -= dy * pull;
  }
  for (let left = 0; left < bodies.length; left++) {
    for (let right = left + 1; right < bodies.length; right++) {
      const dx = bodies[right]!.x - bodies[left]!.x;
      const dy = bodies[right]!.y - bodies[left]!.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= SEPARATION) continue;
      const push = (SEPARATION - distance) * REPULSION;
      const x = distance < 0.01 ? push : (dx / distance) * push;
      const y = distance < 0.01 ? 0 : (dy / distance) * push;
      forces[left]!.x -= x;
      forces[left]!.y -= y;
      forces[right]!.x += x;
      forces[right]!.y += y;
    }
  }
  return bodies.map((body, index) => {
    const pin = pinned.get(body.id);
    if (pin) return { ...body, ...pin, vx: 0, vy: 0 };
    const vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (body.vx + forces[index]!.x) * DAMPING));
    const vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (body.vy + forces[index]!.y) * DAMPING));
    return { ...body, x: body.x + vx, y: body.y + vy, vx, vy };
  });
}
