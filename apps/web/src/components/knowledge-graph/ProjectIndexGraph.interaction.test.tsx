import type { ProjectEntityV1 } from "@t3tools/contracts";
import { act, cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));

import { ProjectIndexGraph } from "./ProjectIndexGraph";

const entity: ProjectEntityV1 = {
  id: "widget",
  name: "Widget",
  qualifiedName: "Widget",
  filePath: "src/Widget.ts",
  kind: "class",
  language: "typescript",
  provenance: "compiler",
  freshness: "current",
  range: { startLine: 1, startColumn: 0, endLine: 20, endColumn: 0 },
  sourceHash: "hash",
  evidenceIds: [],
};
let renderer: ReactTestRenderer | undefined;
let captured = false;
const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
const capture = {
  setPointerCapture: () => {
    captured = true;
  },
  hasPointerCapture: () => captured,
  releasePointerCapture: () => {
    captured = false;
  },
};
const svg = {
  ...capture,
  getScreenCTM: () => ({ inverse: () => 0.5 }),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

beforeEach(() => {
  captured = false;
  windowListeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: true }),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      windowListeners.get(type)?.delete(listener);
    },
  });
  vi.stubGlobal(
    "DOMPoint",
    class {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
      matrixTransform(factor: number) {
        return { x: this.x * factor, y: this.y * factor };
      }
    },
  );
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

const nodeButton = () => renderer!.root.findByProps({ className: "project-index-graph-node" });
const position = () => {
  const node = renderer!.root.findByType("foreignObject");
  return { x: node.props.x as number, y: node.props.y as number };
};
const pointer = (x: number, y: number) => ({
  button: 0,
  pointerId: 7,
  clientX: x,
  clientY: y,
  currentTarget: capture,
  stopPropagation: vi.fn(),
});
async function dispatchWindowPointer(type: string, x: number, y: number) {
  const event = {
    type,
    pointerId: 7,
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
  await act(() => {
    for (const listener of windowListeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  });
  return event;
}

async function renderGraph() {
  const select = vi.fn();
  await act(() => {
    renderer = create(
      <ProjectIndexGraph
        entities={[entity]}
        callsites={[]}
        selectedEntityId={null}
        onSelectEntity={select}
      />,
      {
        createNodeMock: (element) => (element.type === "svg" ? svg : null),
      },
    );
  });
  return select;
}

it("moves on the first window pointer movement after press and resets positions", async () => {
  const select = await renderGraph();
  await act(() => renderer!.root.findByProps({ "aria-label": "Zoom in" }).props.onClick());
  const start = position();
  await act(() => nodeButton().props.onPointerDown(pointer(100, 100)));
  const move = await dispatchWindowPointer("pointermove", 200, 160);
  expect(position().x - start.x).toBeCloseTo((100 * 0.5) / 1.25);
  expect(position().y - start.y).toBeCloseTo((60 * 0.5) / 1.25);
  expect(move.preventDefault).toHaveBeenCalledOnce();
  await dispatchWindowPointer("pointerup", 200, 160);
  expect(captured).toBe(false);
  await act(() => nodeButton().props.onClick({ detail: 1 }));
  expect(select).not.toHaveBeenCalled();
  await act(() => renderer!.root.findByProps({ "aria-label": "Reset layout" }).props.onClick());
  expect(position()).toEqual(start);
});

it("treats small pointer jitter as a click and supports keyboard positioning", async () => {
  const select = await renderGraph();
  const start = position();
  await act(() => nodeButton().props.onPointerDown(pointer(100, 100)));
  await dispatchWindowPointer("pointermove", 102, 101);
  await dispatchWindowPointer("pointerup", 102, 101);
  await act(() => nodeButton().props.onClick({ detail: 1 }));
  expect(select).toHaveBeenCalledWith("widget");
  expect(position()).toEqual(start);
  await act(() =>
    nodeButton().props.onKeyDown({
      key: "ArrowRight",
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }),
  );
  expect(position().x).toBe(start.x + 40);
});

it("ends a cancelled drag without leaving pointer capture or selecting the node", async () => {
  const select = await renderGraph();
  await act(() => nodeButton().props.onPointerDown(pointer(100, 100)));
  await dispatchWindowPointer("pointermove", 150, 150);
  await dispatchWindowPointer("pointercancel", 150, 150);
  expect(captured).toBe(false);
  const cancelled = position();
  await dispatchWindowPointer("pointermove", 300, 300);
  expect(position()).toEqual(cancelled);
  expect(select).not.toHaveBeenCalled();
});
