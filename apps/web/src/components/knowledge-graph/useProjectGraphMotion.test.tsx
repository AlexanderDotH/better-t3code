import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useProjectGraphMotion } from "./useProjectGraphMotion";

type Node = { id: string; parentId: string | null; x: number; y: number };
const initial: Node[] = [{ id: "parent", parentId: null, x: 100, y: 100 }];
const expanded: Node[] = [initial[0]!, { id: "child", parentId: "parent", x: 300, y: 300 }];
let rendered: ReadonlyArray<Node> = [];
let motion: ReturnType<typeof useProjectGraphMotion<Node>>;
let renderer: ReactTestRenderer | undefined;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let reduced = false;

function Harness({ nodes }: { nodes: ReadonlyArray<Node> }) {
  const latest = useProjectGraphMotion(nodes, [{ sourceId: "parent", targetId: "child" }]);
  useEffect(() => {
    motion = latest;
    rendered = latest.nodes;
  }, [latest]);
  return null;
}

beforeEach(() => {
  frames.clear();
  reduced = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    matchMedia: () => ({ matches: reduced }),
  });
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function frame(time: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  await act(() => callbacks.forEach((callback) => callback(time)));
}

it("reveals children from their parent and stops requesting frames when settled", async () => {
  await act(() => {
    renderer = create(<Harness nodes={initial} />);
  });
  expect(frames.size).toBe(0);
  await act(() => renderer!.update(<Harness nodes={expanded} />));
  await frame(0);
  expect(rendered[1]).toMatchObject({ x: 100, y: 100 });
  await frame(100);
  expect(rendered[1]!.x).toBeGreaterThan(100);
  expect(rendered[1]!.x).toBeLessThan(300);
  await frame(500);
  expect(rendered).toEqual(expanded);
  expect(frames.size).toBe(0);
});

it("skips motion when reduced motion is requested and cancels work on unmount", async () => {
  reduced = true;
  await act(() => {
    renderer = create(<Harness nodes={initial} />);
  });
  await act(() => renderer!.update(<Harness nodes={expanded} />));
  expect(rendered).toEqual(expanded);
  expect(frames.size).toBe(0);
  reduced = false;
  await act(() => renderer!.update(<Harness nodes={initial} />));
  expect(frames.size).toBe(1);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(frames.size).toBe(0);
});

it("holds a dragged node, displaces its neighbor, and stops after release", async () => {
  const nearby = [initial[0]!, { id: "child", parentId: "parent", x: 200, y: 100 }];
  await act(() => {
    renderer = create(<Harness nodes={nearby} />);
  });
  await act(() => motion.moveNode("parent", { x: 200, y: 100 }));
  expect(rendered[0]).toMatchObject({ x: 200, y: 100 });
  await frame(100);
  expect(rendered[1]!.x).toBeGreaterThan(200);
  await act(() => motion.releaseNode());
  await frame(200);
  await frame(1500);
  expect(frames.size).toBe(0);
  expect(rendered[0]).toMatchObject({ x: 200, y: 100 });
  expect(rendered.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  await act(() => motion.reset());
  await frame(500);
  expect(rendered).toEqual(nearby);
});

it("moves directly with reduced motion and leaves no work after a drag unmounts", async () => {
  reduced = true;
  await act(() => {
    renderer = create(<Harness nodes={expanded} />);
  });
  await act(() => motion.moveNode("parent", { x: 150, y: 170 }));
  expect(rendered[0]).toMatchObject({ x: 150, y: 170 });
  expect(frames.size).toBe(0);
  reduced = false;
  await act(() => motion.moveNode("parent", { x: 180, y: 170 }));
  expect(frames.size).toBe(1);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(frames.size).toBe(0);
});

it("drops removed nodes and their pins when a branch collapses during settling", async () => {
  await act(() => {
    renderer = create(<Harness nodes={expanded} />);
  });
  await act(() => motion.moveNode("child", { x: 900, y: 600 }));
  await act(() => renderer!.update(<Harness nodes={initial} />));
  await frame(500);
  expect(rendered).toEqual(initial);
  expect(frames.size).toBe(0);
});

it("keeps spring forces running during frequent pointer movement", async () => {
  const linked = [initial[0]!, { id: "child", parentId: "parent", x: 500, y: 100 }];
  await act(() => {
    renderer = create(<Harness nodes={linked} />);
  });
  for (let time = 8; time <= 80; time += 8) {
    vi.mocked(performance.now).mockReturnValue(time);
    await act(() => motion.moveNode("parent", { x: 100 - time, y: 100 }));
    await frame(time + 1);
  }
  // These nodes are too far apart for collision forces; their link must pull the child along.
  expect(rendered[1]!.x).toBeLessThan(500);
  expect(frames.size).toBe(1);
  await act(() => motion.releaseNode());
  await frame(1600);
  expect(frames.size).toBe(0);
});
