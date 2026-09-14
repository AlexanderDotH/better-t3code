import { describe, expect, it } from "vite-plus/test";
import {
  buildVisualizationActionPrompt,
  isClosedVisualizationFence,
  isExperimentalVisualization,
  isVisualizationRequest,
  isVisualizationResponse,
  normalizeVisualizationFormat,
  parseVisualization,
  VISUALIZATION_CACHE_MAX_BYTES,
  VISUALIZATION_CHANNEL,
  VISUALIZATION_SOURCE_MAX_BYTES,
  visualizationDataToCsv,
  VisualizationPreviewCache,
} from "./model.ts";

describe("visualization source model", () => {
  it("labels experimental Mermaid families without treating stable beta aliases as experimental", () => {
    for (const header of [
      "C4Context",
      "C4Deployment",
      "swimlane-beta LR",
      "architecture-beta",
      "usecase-beta",
      "sankey",
      "sankey-beta",
    ]) {
      expect(isExperimentalVisualization("mermaid", `%% comment\n\n${header}\n`)).toBe(true);
    }
    for (const header of [
      "flowchart LR",
      "kanban",
      "packet-beta",
      "block-beta",
      "xychart-beta",
      "erDiagram",
    ]) {
      expect(isExperimentalVisualization("mermaid", header)).toBe(false);
    }
    expect(isExperimentalVisualization("plantuml", "C4Context")).toBe(false);
    expect(isExperimentalVisualization("mermaid", "flowchart LR\nA[C4Context]")).toBe(false);
  });
  it("recognizes all five formats and the Graphviz alias, preserving source", () => {
    for (const format of ["mermaid", "plantuml", "dot", "vega", "vega-lite"])
      expect(normalizeVisualizationFormat(format)).toBe(format);
    expect(normalizeVisualizationFormat(" GRAPHVIZ ")).toBe("dot");
    expect(normalizeVisualizationFormat("javascript")).toBeNull();
    const source = "digraph {a -> b}\n";
    expect(parseVisualization("graphviz", source).source).toBe(source);
  });

  it("bounds UTF-8 source bytes without truncation and rejects empty or incomplete data", () => {
    expect(
      parseVisualization("dot", "a".repeat(VISUALIZATION_SOURCE_MAX_BYTES)).source.length,
    ).toBe(VISUALIZATION_SOURCE_MAX_BYTES);
    expect(() =>
      parseVisualization("dot", "é".repeat(VISUALIZATION_SOURCE_MAX_BYTES / 2 + 1)),
    ).toThrow("64 KiB");
    expect(() => parseVisualization("mermaid", " ")).toThrow("empty");
    expect(() => parseVisualization("vega-lite", '{"data":')).toThrow("incomplete JSON");
    expect(() => parseVisualization("vega", "[]")).toThrow("JSON object");
  });

  it("keeps provenance optional while distinguishing examples, forecasts and measurements", () => {
    for (const kind of ["example", "forecast", "measurement"]) {
      const metadata = {
        purpose: "analysis",
        summary: "Revenue grew",
        sources: ["input.csv"],
        asOf: "2026-09-14",
        kind,
        limitations: ["One period"],
      };
      expect(
        parseVisualization("vega", JSON.stringify({ usermeta: { t3: metadata } })).metadata,
      ).toEqual(metadata);
    }
    expect(parseVisualization("vega-lite", "{}").metadata).toEqual({
      sources: [],
      limitations: [],
    });
    expect(
      parseVisualization(
        "vega-lite",
        JSON.stringify({ usermeta: { t3: { sources: [null, ""], kind: "unknown" } } }),
      ).metadata,
    ).toEqual({ sources: [], limitations: [] });
  });

  it("collects named and nested input datasets before transforms, retaining nulls and source URLs", () => {
    const parsed = parseVisualization(
      "vega-lite",
      JSON.stringify({
        datasets: { sales: [{ amount: 20 }, { amount: null, url: "https://source.test" }] },
        layer: [
          {
            data: { values: [{ amount: 5 }] },
            transform: [{ aggregate: [{ op: "sum", field: "amount" }] }],
          },
        ],
        scales: [{ domain: { values: [1, 2, 3] } }],
      }),
    );
    expect(parsed.datasets).toHaveLength(2);
    expect(parsed.datasets[0]).toEqual({
      name: "sales",
      rows: [{ amount: 20 }, { amount: null, url: "https://source.test" }],
      columns: ["amount", "url"],
    });
    expect(parsed.datasets[1]?.rows).toEqual([{ amount: 5 }]);
  });

  it("counts the combined data rows and rejects external loads without forbidding provenance links", () => {
    expect(() =>
      parseVisualization(
        "vega",
        JSON.stringify({
          data: [
            { name: "map", values: { type: "FeatureCollection", features: Array(5001).fill({}) } },
          ],
        }),
      ),
    ).toThrow("5,000");
    expect(() =>
      parseVisualization(
        "vega",
        JSON.stringify({
          data: [
            { name: "a", values: Array(2500).fill(1) },
            { name: "b", values: Array(2501).fill(2) },
          ],
        }),
      ),
    ).toThrow("5,000");
    expect(
      parseVisualization("vega", JSON.stringify({ data: [{ values: Array(5000).fill(1) }] }))
        .datasets[0]?.rows,
    ).toHaveLength(5000);
    expect(() =>
      parseVisualization("vega-lite", '{"data":{"url":"https://external.test/data.csv"}}'),
    ).toThrow("external URLs");
    expect(() => parseVisualization("vega-lite", '{"data":{"values":"a,b\\n1,2"}}')).toThrow(
      "JSON rows",
    );
    expect(
      parseVisualization("vega-lite", '{"usermeta":{"t3":{"sources":["https://source.test"]}}}')
        .metadata.sources,
    ).toEqual(["https://source.test"]);
    expect(() =>
      parseVisualization("plantuml", "@startuml\n!include <C4/C4_Context>\n@enduml"),
    ).toThrow("includes");
    expect(() =>
      parseVisualization("mermaid", '%%{init:{"securityLevel":"loose"}}%%\ngraph TD;A-->B'),
    ).toThrow("configuration");
  });

  it("renders only completed fences, including longer fences and quoted markdown", () => {
    expect(isClosedVisualizationFence("```mermaid\ngraph TD;A-->B\n```\n")).toBe(true);
    expect(isClosedVisualizationFence("~~~~dot\ndigraph {}\n~~~~~")).toBe(true);
    expect(isClosedVisualizationFence("```dot\n> digraph {}\n> ```")).toBe(true);
    expect(isClosedVisualizationFence("```dot\n    digraph {}\n    ```")).toBe(true);
    expect(isClosedVisualizationFence("````dot\ndigraph {}\n```")).toBe(false);
    expect(isClosedVisualizationFence("```dot\ndigraph {}\n~~~")).toBe(false);
    expect(isClosedVisualizationFence("```dot\ndigraph {}\n")).toBe(false);
  });

  it("builds contextual drafts with safe fences and waits for learner answers", () => {
    const source = 'graph TD; A["```"]-->B';
    const prompt = buildVisualizationActionPrompt({
      action: "check-understanding",
      source,
      format: "mermaid",
      locale: "de",
    });
    expect(prompt).toContain("warte auf meine Antwort");
    expect(prompt).toContain(`\n\n\`\`\`\`mermaid\n${source}\n\`\`\`\``);
    expect(
      buildVisualizationActionPrompt({ action: "compare-periods", format: "vega", source: "{}" }),
    ).toContain("instead of inventing values");
    expect(
      buildVisualizationActionPrompt({
        action: "fix",
        format: "dot",
        source: "broken",
        error: "Invalid token",
      }),
    ).toContain("Rendering error: Invalid token");
  });

  it("exports source rows with valid CSV escaping, missing values and inert spreadsheet formulas", () => {
    expect(
      visualizationDataToCsv({
        name: "source",
        columns: ["name", "amount"],
        rows: [{ name: 'A, "B"', amount: null }, { name: "=1+1", amount: -3 }, { name: "missing" }],
      }),
    ).toBe('"name","amount"\r\n"A, ""B""",""\r\n"\'=1+1","-3"\r\n"missing",""');
  });

  it("validates structured messages before renderer or host dispatch", () => {
    const request = {
      channel: VISUALIZATION_CHANNEL,
      type: "render",
      requestId: "1",
      format: "dot",
      source: "digraph{}",
      theme: "light",
    };
    expect(isVisualizationRequest(request)).toBe(true);
    expect(isVisualizationRequest({ ...request, interactive: "yes" })).toBe(false);
    expect(isVisualizationRequest({ ...request, format: "html" })).toBe(false);
    expect(
      isVisualizationRequest({
        channel: VISUALIZATION_CHANNEL,
        type: "view",
        requestId: "2",
        action: "fit",
      }),
    ).toBe(true);
    expect(
      isVisualizationResponse({
        channel: VISUALIZATION_CHANNEL,
        type: "result",
        requestId: "1",
        svg: "<svg/>",
      }),
    ).toBe(true);
    expect(
      isVisualizationResponse({
        channel: VISUALIZATION_CHANNEL,
        type: "png",
        requestId: "2",
        dataUrl: "https://external.test",
      }),
    ).toBe(false);
    expect(isVisualizationResponse({ channel: "other", type: "ready" })).toBe(false);
  });

  it("evicts least-recently-used previews within 8 MiB and refuses an oversized replacement", () => {
    const cache = new VisualizationPreviewCache();
    const svg = "x".repeat(VISUALIZATION_CACHE_MAX_BYTES / 6 - 10);
    cache.set("a", svg);
    cache.set("b", svg);
    cache.set("c", svg);
    expect(cache.get("a")).toBe(svg);
    cache.set("d", svg);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(svg);
    cache.set("a", "x".repeat(VISUALIZATION_CACHE_MAX_BYTES));
    expect(cache.get("a")).toBeUndefined();
    cache.clear();
    expect(cache.get("d")).toBeUndefined();
  });
});
