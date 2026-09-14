// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import * as Viz from "@viz-js/viz";
import { VISUALIZATION_EXAMPLES } from "./examples.ts";
import {
  buildVisualizationActionPrompt,
  parseVisualization,
  visualizationDataToCsv,
  VISUALIZATION_CHANNEL,
  type VisualizationRenderRequest,
} from "./model.ts";
import { sanitizeVisualizationSvg } from "./renderer/runtime.ts";

beforeAll(() => {
  vi.stubGlobal("Viz", Viz);
  // jsdom has no layout engine; these tests verify actual renderer output, not visual geometry.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value() {
      return { x: 0, y: 0, width: Math.max(40, (this.textContent?.length ?? 0) * 8), height: 24 };
    },
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value() {
      return (this.textContent?.length ?? 0) * 8;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Acceptance fixtures must not fetch network resources.");
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(request: VisualizationRenderRequest, container: HTMLElement) {
  switch (request.format) {
    case "mermaid":
      return (await import("./renderer/mermaid.ts")).renderDiagram(request, container);
    case "plantuml":
      return (await import("./renderer/plantuml.ts")).renderDiagram(request);
    case "dot":
      return (await import("./renderer/dot.ts")).renderDiagram(request);
    case "vega":
      return (await import("./renderer/vega.ts")).renderDiagram(request, container);
    case "vega-lite":
      return (await import("./renderer/vega.ts")).renderDiagram(request, container);
  }
}

function assertSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  expect(document.documentElement.localName).toBe("svg");
  expect(document.querySelector("path, rect, circle, text, polygon, ellipse, line")).not.toBeNull();
  const geometry = [...document.querySelectorAll("*")].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) =>
        /^(?:d|x|y|x1|y1|x2|y2|cx|cy|r|width|height|viewBox|transform|points)$/.test(
          attribute.name,
        ),
      )
      .map((attribute) => `${element.localName}.${attribute.name}=${attribute.value}`),
  );
  expect(geometry.filter((value) => /NaN|undefined/.test(value))).toEqual([]);
  expect(document.querySelector("script, foreignObject, image")).toBeNull();
}

describe("shipped diagram family acceptance", () => {
  for (const example of VISUALIZATION_EXAMPLES) {
    test(example.id, async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const request: VisualizationRenderRequest = {
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: example.id,
        format: example.format,
        source: example.source,
        theme: "light",
      };
      parseVisualization(request.format, request.source);
      const result = await render(request, container);
      try {
        assertSvg(sanitizeVisualizationSvg(result.svg));
        assertSvg(
          sanitizeVisualizationSvg(result.exportSvg ? await result.exportSvg() : result.svg),
        );
      } finally {
        result.dispose?.();
        container.remove();
      }
    });
  }

  test.each(["mermaid-flowchart", "plantuml-sequence", "dot-tree", "vega-lite-bar", "vega-map"])(
    "renders %s with a dark theme",
    async (id) => {
      const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === id)!;
      const container = document.createElement("div");
      document.body.append(container);
      const result = await render(
        {
          channel: VISUALIZATION_CHANNEL,
          type: "render",
          requestId: id,
          format: example.format,
          source: example.source,
          theme: "dark",
        },
        container,
      );
      try {
        assertSvg(sanitizeVisualizationSvg(result.svg));
      } finally {
        result.dispose?.();
        container.remove();
      }
    },
  );

  test.each([
    ["plantuml-component", "#262626"],
    ["vega-lite-selection", "#171717"],
  ])("keeps %s dark text and background readable", async (id, background) => {
    const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === id)!;
    const container = document.createElement("div");
    document.body.append(container);
    const result = await render(
      {
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: id,
        format: example.format,
        source: example.source,
        theme: "dark",
      },
      container,
    );
    try {
      const svg = new DOMParser().parseFromString(
        sanitizeVisualizationSvg(result.svg),
        "image/svg+xml",
      );
      expect(svg.querySelector("rect")?.getAttribute("fill")?.toLowerCase()).toBe(background);
      expect(svg.querySelector("text")?.getAttribute("fill")?.toLowerCase()).toBe("#eeeeee");
    } finally {
      result.dispose?.();
      container.remove();
    }
  });

  test.each([
    ["mermaid", "flowchart LR\nInvalid[[["],
    ["plantuml", "@startuml\nthis is not valid diagram syntax !!\n@enduml"],
    ["dot", "digraph { a ->"],
    ["vega-lite", '{"mark":"not-a-mark","data":{"values":[]}}'],
    ["vega", '{"marks":[{"type":"not-a-mark"}]}'],
  ] as const)("reports malformed %s source", async (format, source) => {
    const container = document.createElement("div");
    document.body.append(container);
    try {
      await expect(
        render(
          {
            channel: VISUALIZATION_CHANNEL,
            type: "render",
            requestId: "invalid",
            format,
            source,
            theme: "light",
          },
          container,
        ),
      ).rejects.toThrow();
    } finally {
      container.remove();
    }
  });

  test("Vega-Lite fullscreen keeps an interactive view and exports its current SVG", async () => {
    const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === "vega-lite-selection")!;
    const container = document.createElement("div");
    document.body.append(container);
    const result = await render(
      {
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: "selection",
        format: example.format,
        source: example.source,
        theme: "light",
        interactive: true,
      },
      container,
    );
    try {
      expect(container.querySelector("svg")).not.toBeNull();
      expect(result.exportSvg).toBeTypeOf("function");
      const initial = await result.exportSvg!();
      assertSvg(sanitizeVisualizationSvg(initial));
      const legendSymbol = container.querySelector(".role-legend-symbol path");
      expect(legendSymbol).not.toBeNull();
      legendSymbol!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const selected = await result.exportSvg!();
      assertSvg(sanitizeVisualizationSvg(selected));
      expect(selected).not.toEqual(initial);
      expect(selected).toContain('opacity="0.2"');
    } finally {
      result.dispose?.();
      container.remove();
    }
  });
});

describe("learning and analysis follow-up scenarios", () => {
  test.each([
    ["mermaid-flowchart", "simpler"],
    ["mermaid-sequence", "check-understanding"],
    ["vega-lite-target", "break-down"],
    ["vega-lite-line", "compare-periods"],
  ] as const)("preserves the diagram context for %s", (id, action) => {
    const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === id)!;
    const parsed = parseVisualization(example.format, example.source);
    const prompt = buildVisualizationActionPrompt({
      action,
      format: example.format,
      source: example.source,
    });
    expect(prompt).toContain(example.source);
    if (parsed.datasets.length) {
      expect(parsed.metadata.kind).toBe("example");
      expect(parsed.metadata.sources).toEqual(["Embedded fictional training dataset"]);
      expect(visualizationDataToCsv(parsed.datasets[0]!)).toContain('"revenue"');
    }
    if (action === "check-understanding") expect(prompt).toContain("wait for my answer");
    if (action === "compare-periods") expect(prompt).toContain("instead of inventing values");
  });

  test("SVG exports remove script and resource references", () => {
    const svg = sanitizeVisualizationSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script><foreignObject><div>HTML</div></foreignObject><image href="https://example.com/a.png"/><a href="javascript:alert(1)"><text onclick="alert(1)" fill="url(https://example.com/a.svg)">Safe</text></a></svg>',
    );
    expect(svg).toContain("Safe");
    expect(svg).not.toMatch(/https:|javascript:|onclick|<script|foreignObject|<image/);
  });

  test("SVG export preserves local marker references", () => {
    const svg = sanitizeVisualizationSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow"><path d="M0 0L5 5L0 10Z"/></marker></defs><path d="M0 0L10 10" marker-end="url(#arrow)"/><path d="M10 0L20 10" marker-end="url(\'#arrow\')"/></svg>',
    );
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(
      [...document.querySelectorAll("path[marker-end]")].map((path) =>
        path.getAttribute("marker-end"),
      ),
    ).toEqual(["url(#arrow)", "url('#arrow')"]);
  });
});
