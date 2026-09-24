import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useProjectGraphMotion } from "./useProjectGraphMotion";

type Node = { id: string; parentId: string | null; x: number; y: number };
const initial: Node[] = [{ id: "parent", parentId: null, x: 100, y: 100 }];
const expanded: Node[] = [initial[0]!, { id: "child", parentId: "parent", x: 300, y: 300 }];
let rendered: ReadonlyArray<Node> = [];
let renderer: ReactTestRenderer | undefined;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let reduced = false;

function Harness({ nodes }: { nodes: ReadonlyArray<Node> }) {
  rendered = useProjectGraphMotion(nodes);
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
