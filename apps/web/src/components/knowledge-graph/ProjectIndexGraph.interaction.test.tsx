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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
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
const canvas = () => renderer!.root.findByProps({ className: "project-index-graph-canvas" });
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

it("drags in graph coordinates after zoom, suppresses exploration, and resets positions", async () => {
  const select = await renderGraph();
  await act(() => renderer!.root.findByProps({ "aria-label": "Zoom in" }).props.onClick());
  const start = position();
  await act(() => nodeButton().props.onPointerDown(pointer(100, 100)));
  await act(() => canvas().props.onPointerMove({ ...pointer(200, 160), currentTarget: svg }));
  expect(position().x - start.x).toBeCloseTo((100 * 0.5) / 1.25);
  expect(position().y - start.y).toBeCloseTo((60 * 0.5) / 1.25);
  await act(() => canvas().props.onPointerUp(pointer(200, 160)));
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
  await act(() => canvas().props.onPointerMove({ ...pointer(102, 101), currentTarget: svg }));
  await act(() => canvas().props.onPointerUp(pointer(102, 101)));
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
  await act(() => canvas().props.onPointerMove({ ...pointer(150, 150), currentTarget: svg }));
  await act(() => canvas().props.onPointerCancel());
  expect(captured).toBe(false);
  const cancelled = position();
  await act(() => canvas().props.onPointerMove({ ...pointer(300, 300), currentTarget: svg }));
  expect(position()).toEqual(cancelled);
  expect(select).not.toHaveBeenCalled();
});
