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

const appearance = {
  fontFamily: "T3FixtureSans",
  background: "#101c2c",
  foreground: "#e8edf5",
  mutedForeground: "#a0b3ca",
  surface: "#26374d",
  border: "#657a96",
};

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
  const canvasContext = {
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D;
  const canvasPrototype = HTMLCanvasElement.prototype as {
    getContext: (contextId: "2d") => CanvasRenderingContext2D | null;
  };
  vi.spyOn(canvasPrototype, "getContext").mockReturnValue(canvasContext);
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
  return document;
}

function assertAppearance(svg: string) {
  const document = assertSvg(sanitizeVisualizationSvg(svg));
  const output = document.documentElement.outerHTML.toLowerCase();
  expect(output).toContain(appearance.background);
  expect(output).toContain(appearance.foreground);
  expect(output).toContain(appearance.fontFamily.toLowerCase());
  expect(output).toMatch(/font-size\s*[:=]\s*["']?14(?:\.0+)?(?:px)?\b/);
  if (document.documentElement.id.startsWith("t3-diagram-")) {
    expect(document.documentElement.style.backgroundColor).toBe("");
  } else if (document.documentElement.style.backgroundColor) {
    expect(document.documentElement.style.backgroundColor).toBe("rgb(16, 28, 44)");
  } else {
    const canvasColors = [
      ...document.querySelectorAll("svg > rect, rect.background, .graph > polygon"),
    ].map((element) => element.getAttribute("fill")?.toLowerCase());
    expect(canvasColors).toContain(appearance.background);
  }
  return document;
}

describe("shipped diagram family acceptance", () => {
  for (const example of VISUALIZATION_EXAMPLES) {
    test(
      example.id,
      async () => {
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
      },
      15_000,
    );
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
    "mermaid-flowchart",
    "plantuml-component",
    "dot-directed",
    "vega-lite-selection",
    "vega-custom-analysis",
  ])("keeps %s appearance in previews and SVG exports", async (id) => {
    const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === id)!;
    const source =
      example.format === "vega"
        ? JSON.stringify({
            ...parseVisualization(example.format, example.source).spec,
            title: "Current appearance",
          })
        : example.source;
    const container = document.createElement("div");
    document.body.append(container);
    const result = await render(
      {
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: id,
        format: example.format,
        source,
        theme: "dark",
        appearance,
      },
      container,
    );
    try {
      const svg = assertAppearance(result.svg);
      assertAppearance(result.exportSvg ? await result.exportSvg() : result.svg);
      if (example.format === "mermaid") {
        expect(
          svg.querySelector('linearGradient, radialGradient, [filter]:not([filter="none"])'),
        ).toBeNull();
        expect(svg.documentElement.outerHTML).not.toMatch(/filter\s*:\s*(?:drop-shadow|url\()/);
      }
    } finally {
      result.dispose?.();
      container.remove();
    }
  });

  test("keeps Mermaid's authored canvas and connection styling", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    try {
      const result = await render(
        {
          channel: VISUALIZATION_CHANNEL,
          type: "render",
          requestId: "authored-canvas",
          format: "mermaid",
          source:
            '%%{init: {"themeVariables": {"background": "#f7ead5"}}}%%\nflowchart LR\nStart[Start] --> End[End]\nlinkStyle 0 stroke:#b419e7,stroke-width:4px',
          theme: "dark",
          appearance,
        },
        container,
      );
      const svg = assertSvg(sanitizeVisualizationSvg(result.svg));
      expect(svg.documentElement.style.backgroundColor).toBe("rgb(247, 234, 213)");
      const edge = svg.querySelector<SVGElement>(".flowchart-link");
      expect(edge?.style.getPropertyValue("stroke-width")).toBe("4px");
      expect(edge?.getAttribute("style")).toContain("#b419e7");
      for (const shape of svg.querySelectorAll(".node > rect.basic.label-container")) {
        expect(shape.getAttribute("rx")).toBe("8");
        expect(shape.getAttribute("ry")).toBe("8");
      }
    } finally {
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

  test.each([
    [
      "mermaid",
      "flowchart LR\nAuthored-->Default\nclassDef authored fill:#b419e7,stroke:#3ec694,color:#072a11,font-family:AuthoredFixtureSerif\nclass Authored authored",
    ],
    [
      "plantuml",
      "@startuml\nskinparam componentBackgroundColor #b419e7\nskinparam componentBorderColor #3ec694\nskinparam defaultFontColor #072a11\nskinparam defaultFontName AuthoredFixtureSerif\n[Authored] --> [Default]\n@enduml",
    ],
    [
      "dot",
      'digraph { node [style=filled,fillcolor="#b419e7",color="#3ec694",fontcolor="#072a11",fontname="AuthoredFixtureSerif"]; Authored -> Default; }',
    ],
  ] as const)("preserves authored %s node colors and fonts", async (format, source) => {
    const container = document.createElement("div");
    document.body.append(container);
    const result = await render(
      {
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: `authored-${format}`,
        format,
        source,
        theme: "dark",
        appearance,
      },
      container,
    );
    try {
      for (const svg of [result.svg, result.exportSvg ? await result.exportSvg() : result.svg]) {
        const output = assertSvg(
          sanitizeVisualizationSvg(svg),
        ).documentElement.outerHTML.toLowerCase();
        expect(output).toContain("authored");
        expect(output).toContain("#b419e7");
        expect(output).toContain("#3ec694");
        expect(output).toContain("#072a11");
        expect(output).toContain("authoredfixtureserif");
      }
    } finally {
      result.dispose?.();
      container.remove();
    }
  });

  test.each(["vega", "vega-lite"] as const)(
    "keeps authored %s guide styles, color scales and plotted values",
    async (format) => {
      const values = [
        { category: "Alpha", amount: 3 },
        { category: "Beta", amount: 7 },
      ];
      const colors = ["#b419e7", "#3ec694"];
      const spec =
        format === "vega-lite"
          ? {
              width: 160,
              height: 100,
              background: "#f5ebdc",
              data: { values },
              mark: "bar",
              config: {
                font: "AuthoredFixtureSerif",
                axis: { labelColor: "#072a11" },
              },
              encoding: {
                x: { field: "category", type: "nominal" },
                y: { field: "amount", type: "quantitative" },
                color: { field: "category", type: "nominal", scale: { range: colors } },
              },
            }
          : {
              width: 160,
              height: 100,
              background: "#f5ebdc",
              data: [{ name: "rows", values }],
              config: {
                style: { "guide-label": { font: "AuthoredFixtureSerif" } },
                axis: { labelColor: "#072a11" },
              },
              scales: [
                {
                  name: "x",
                  type: "band",
                  domain: { data: "rows", field: "category" },
                  range: "width",
                },
                {
                  name: "y",
                  type: "linear",
                  domain: { data: "rows", field: "amount" },
                  range: "height",
                  zero: true,
                },
                {
                  name: "color",
                  type: "ordinal",
                  domain: { data: "rows", field: "category" },
                  range: colors,
                },
              ],
              axes: [
                { orient: "bottom", scale: "x" },
                { orient: "left", scale: "y" },
              ],
              marks: [
                {
                  type: "rect",
                  from: { data: "rows" },
                  encode: {
                    enter: {
                      x: { scale: "x", field: "category" },
                      width: { scale: "x", band: 1 },
                      y: { scale: "y", field: "amount" },
                      y2: { scale: "y", value: 0 },
                      fill: { scale: "color", field: "category" },
                      description: { signal: "datum.category + ': ' + datum.amount" },
                    },
                  },
                },
              ],
            };
      const source = JSON.stringify(spec);
      const markSnapshots: Array<
        {
          label: string | null;
          path: string | null;
          fill: string | null;
        }[]
      > = [];
      for (const currentAppearance of [undefined, appearance]) {
        const container = document.createElement("div");
        document.body.append(container);
        const result = await render(
          {
            channel: VISUALIZATION_CHANNEL,
            type: "render",
            requestId: `authored-${format}`,
            format,
            source,
            theme: "dark",
            ...(currentAppearance ? { appearance: currentAppearance } : {}),
          },
          container,
        );
        try {
          const svg = assertSvg(
            sanitizeVisualizationSvg(result.exportSvg ? await result.exportSvg() : result.svg),
          );
          expect(svg.querySelector("svg > rect")?.getAttribute("fill")).toBe("#f5ebdc");
          expect(svg.querySelector(".role-axis-label text")?.getAttribute("fill")).toBe("#072a11");
          expect(svg.querySelector(".role-axis-label text")?.getAttribute("font-family")).toBe(
            "AuthoredFixtureSerif",
          );
          const marks = [...svg.querySelectorAll(".role-mark > path")].map((mark) => ({
            label: mark.getAttribute("aria-label"),
            path: mark.getAttribute("d"),
            fill: mark.getAttribute("fill"),
          }));
          expect(marks).toHaveLength(2);
          expect(marks.map((mark) => mark.fill)).toEqual(colors);
          expect(marks[0]?.label).toContain("Alpha");
          expect(marks[0]?.label).toContain("3");
          expect(marks[1]?.label).toContain("Beta");
          expect(marks[1]?.label).toContain("7");
          markSnapshots.push(marks);
        } finally {
          result.dispose?.();
          container.remove();
        }
      }
      expect(markSnapshots[1]).toEqual(markSnapshots[0]);
    },
  );

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
        theme: "dark",
        appearance,
        interactive: true,
      },
      container,
    );
    try {
      expect(container.querySelector("svg")).not.toBeNull();
      expect(result.exportSvg).toBeTypeOf("function");
      const initial = await result.exportSvg!();
      assertAppearance(initial);
      const legendSymbol = container.querySelector(".role-legend-symbol path");
      expect(legendSymbol).not.toBeNull();
      legendSymbol!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const selected = await result.exportSvg!();
      assertAppearance(selected);
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
