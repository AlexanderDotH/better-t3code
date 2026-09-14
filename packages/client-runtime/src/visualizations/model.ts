export const VISUALIZATION_SOURCE_MAX_BYTES = 64 * 1024;
const VISUALIZATION_DATA_MAX_ROWS = 5_000;
export const VISUALIZATION_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const VISUALIZATION_CHANNEL = "t3-visualization";

export type VisualizationFormat = "mermaid" | "plantuml" | "dot" | "vega-lite" | "vega";
export type VisualizationMetadata = {
  purpose?: "learning" | "analysis";
  summary?: string;
  sources: string[];
  asOf?: string;
  kind?: "measurement" | "example" | "forecast";
  limitations: string[];
};
export type VisualizationDataset = {
  name: string;
  rows: Record<string, unknown>[];
  columns: string[];
};
export type VisualizationDocument = {
  format: VisualizationFormat;
  source: string;
  spec?: Record<string, unknown>;
  metadata: VisualizationMetadata;
  datasets: VisualizationDataset[];
};
export type VisualizationRenderRequest = {
  channel: typeof VISUALIZATION_CHANNEL;
  type: "render";
  requestId: string;
  format: VisualizationFormat;
  source: string;
  theme: "light" | "dark";
  interactive?: boolean;
};
export type VisualizationRequest =
  | VisualizationRenderRequest
  | {
      channel: typeof VISUALIZATION_CHANNEL;
      type: "view";
      requestId: string;
      action: "zoom-in" | "zoom-out" | "fit" | "pan" | "select";
    }
  | {
      channel: typeof VISUALIZATION_CHANNEL;
      type: "export-svg" | "export-png";
      requestId: string;
    };
export type VisualizationResponse =
  | { channel: typeof VISUALIZATION_CHANNEL; type: "ready" }
  | { channel: typeof VISUALIZATION_CHANNEL; type: "result"; requestId: string; svg: string }
  | { channel: typeof VISUALIZATION_CHANNEL; type: "error"; requestId: string; error: string }
  | { channel: typeof VISUALIZATION_CHANNEL; type: "png"; requestId: string; dataUrl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeVisualizationFormat(
  language: string | undefined | null,
): VisualizationFormat | null {
  switch (language?.trim().toLowerCase()) {
    case "graphviz":
    case "dot":
      return "dot";
    case "mermaid":
      return "mermaid";
    case "plantuml":
      return "plantuml";
    case "vega-lite":
      return "vega-lite";
    case "vega":
      return "vega";
    default:
      return null;
  }
}

export function isExperimentalVisualization(format: VisualizationFormat, source: string): boolean {
  if (format !== "mermaid") return false;
  const header =
    source
      .split(/\r?\n/)
      .find((line) => line.trim() && !line.trimStart().startsWith("%%"))
      ?.trim() ?? "";
  // Mermaid 12 retains stable -beta aliases for block, packet and XY charts.
  return /^(?:C4(?:Context|Container|Component|Dynamic|Deployment)|sankey(?:-beta)?|swimlane-beta|architecture-beta|usecase-beta)\b/i.test(
    header,
  );
}

export function isVisualizationRequest(value: unknown): value is VisualizationRequest {
  if (
    !isRecord(value) ||
    value.channel !== VISUALIZATION_CHANNEL ||
    typeof value.requestId !== "string"
  )
    return false;
  if (value.type === "export-svg" || value.type === "export-png") return true;
  if (value.type === "view")
    return ["zoom-in", "zoom-out", "fit", "pan", "select"].includes(String(value.action));
  return (
    value.type === "render" &&
    typeof value.format === "string" &&
    normalizeVisualizationFormat(value.format) === value.format &&
    typeof value.source === "string" &&
    (value.theme === "light" || value.theme === "dark") &&
    (value.interactive === undefined || typeof value.interactive === "boolean")
  );
}

export function isVisualizationResponse(value: unknown): value is VisualizationResponse {
  if (!isRecord(value) || value.channel !== VISUALIZATION_CHANNEL) return false;
  if (value.type === "ready") return true;
  if (typeof value.requestId !== "string") return false;
  switch (value.type) {
    case "result":
      return typeof value.svg === "string";
    case "error":
      return typeof value.error === "string";
    case "png":
      return (
        typeof value.dataUrl === "string" &&
        /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.dataUrl)
      );
    default:
      return false;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readMetadata(spec: Record<string, unknown>): VisualizationMetadata {
  const metadata = isRecord(spec.usermeta) && isRecord(spec.usermeta.t3) ? spec.usermeta.t3 : {};
  return {
    sources: stringList(metadata.sources),
    limitations: stringList(metadata.limitations),
    ...(metadata.purpose === "learning" || metadata.purpose === "analysis"
      ? { purpose: metadata.purpose }
      : {}),
    ...(typeof metadata.summary === "string" ? { summary: metadata.summary } : {}),
    ...(typeof metadata.asOf === "string" ? { asOf: metadata.asOf } : {}),
    ...(metadata.kind === "measurement" ||
    metadata.kind === "example" ||
    metadata.kind === "forecast"
      ? { kind: metadata.kind }
      : {}),
  };
}

function readDatasets(spec: Record<string, unknown>): VisualizationDataset[] {
  const datasets: VisualizationDataset[] = [];
  let rowCount = 0;
  const add = (name: string, values: unknown) => {
    const entries = Array.isArray(values) ? values : isRecord(values) ? [values] : null;
    if (!entries)
      throw new Error(
        "Embed diagram data as JSON rows; external files and encoded data are not supported.",
      );
    rowCount += entries.reduce(
      (count, entry) =>
        count +
        (isRecord(entry) && entry.type === "FeatureCollection" && Array.isArray(entry.features)
          ? entry.features.length
          : 1),
      0,
    );
    if (rowCount > VISUALIZATION_DATA_MAX_ROWS)
      throw new Error(
        "This diagram exceeds 5,000 embedded data rows. Aggregate the data before rendering; the source remains available.",
      );
    const rows = entries.map((value) => (isRecord(value) ? value : { value }));
    datasets.push({ name, rows, columns: [...new Set(rows.flatMap((row) => Object.keys(row)))] });
  };
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "usermeta" || key === "$schema") continue;
      if (key === "url" || key === "href")
        throw new Error(
          "Diagrams cannot load external URLs or files. Embed the data in the diagram instead.",
        );
      if (key === "datasets" && isRecord(child)) {
        for (const [name, rows] of Object.entries(child)) add(name, rows);
      } else if (key === "values" && /(?:\.data(?:\[\d+\])?)$/.test(path)) {
        // Data rows are opaque: a column called "url" is still legitimate source data.
        add(typeof value.name === "string" ? value.name : path, child);
      } else visit(child, `${path}.${key}`);
    }
  };
  visit(spec, "data");
  return datasets;
}

export function parseVisualization(language: string, source: string): VisualizationDocument {
  const format = normalizeVisualizationFormat(language);
  if (!format) throw new Error("This code block is not a supported diagram format.");
  if (new TextEncoder().encode(source).byteLength > VISUALIZATION_SOURCE_MAX_BYTES)
    throw new Error(
      "This diagram exceeds 64 KiB of source. Simplify it before rendering; the source remains available.",
    );
  if (!source.trim()) throw new Error("The diagram source is empty.");
  if (format === "mermaid" && /%%\{\s*(?:init|config)\s*:|^---\s*\r?\n/i.test(source.trimStart()))
    throw new Error(
      "Mermaid configuration directives are not supported. Put only the diagram definition in this block.",
    );
  if (
    format === "plantuml" &&
    /!\s*(?:include\w*|import)\b|%\s*(?:load_json|load_yaml|load_csv|file_exists|getenv)\s*\(/i.test(
      source,
    )
  )
    throw new Error(
      "External PlantUML includes and file access are not supported. Use a self-contained diagram.",
    );
  if (format !== "vega" && format !== "vega-lite")
    return { format, source, metadata: { sources: [], limitations: [] }, datasets: [] };
  let spec: unknown;
  try {
    spec = JSON.parse(source);
  } catch {
    throw new Error(
      "The diagram contains invalid or incomplete JSON. Check the source before rendering.",
    );
  }
  if (!isRecord(spec)) throw new Error("A Vega diagram must be a JSON object.");
  return { format, source, spec, metadata: readMetadata(spec), datasets: readDatasets(spec) };
}

/** Receives the markdown slice for one AST code block, including its fences. */
export function isClosedVisualizationFence(markdownBlock: string): boolean {
  const lines = markdownBlock.trimEnd().split(/\r?\n/);
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[0] ?? "");
  if (!opening || lines.length < 2) return false;
  const fence = opening[1]!;
  if (fence[0] === "`" && opening[2]?.includes("`")) return false;
  const closing = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines.at(-1) ?? "");
  return Boolean(closing && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length);
}

export type VisualizationAction =
  | "simpler"
  | "step-by-step"
  | "check-understanding"
  | "break-down"
  | "compare-periods"
  | "explain-assumptions"
  | "fix";
const ACTION_PROMPTS = {
  en: {
    simpler:
      "Explain this diagram more simply, with one concrete example. Name any simplifications.",
    "step-by-step":
      "Walk me through this diagram step by step, starting with the main idea before adding details.",
    "check-understanding":
      "Help me check my understanding of this diagram. Ask one optional prediction or application question and wait for my answer before explaining the solution.",
    "break-down":
      "Break down what this chart shows. Explain the relevant groups, units, time range, sources, and uncertainty using only the available data.",
    "compare-periods":
      "Compare the time periods in this chart using the available data and a consistent baseline. If a period is missing, ask me for its data instead of inventing values.",
    "explain-assumptions":
      "Explain the assumptions, data provenance, missing values, and limitations of this chart. Distinguish measurements, examples, and forecasts.",
    fix: "Fix this diagram using the rendering error below. Preserve its intended meaning and explain the correction.",
  },
  de: {
    simpler:
      "Erkläre dieses Diagramm einfacher und mit einem konkreten Beispiel. Benenne Vereinfachungen.",
    "step-by-step":
      "Führe mich Schritt für Schritt durch dieses Diagramm. Beginne mit der Kernaussage und ergänze danach die Details.",
    "check-understanding":
      "Hilf mir, mein Verständnis dieses Diagramms zu prüfen. Stelle eine freiwillige Vorhersage- oder Anwendungsfrage und warte auf meine Antwort, bevor du die Lösung erklärst.",
    "break-down":
      "Schlüssele die Aussage dieses Datendiagramms auf. Erkläre Gruppen, Einheiten, Zeitraum, Quellen und Unsicherheit anhand der vorhandenen Daten.",
    "compare-periods":
      "Vergleiche die Zeiträume dieses Datendiagramms anhand der vorhandenen Daten und einer einheitlichen Vergleichsbasis. Frage nach fehlenden Daten, statt Werte zu erfinden.",
    "explain-assumptions":
      "Erkläre Annahmen, Datenherkunft, fehlende Werte und Einschränkungen dieses Datendiagramms. Unterscheide Messungen, Beispiele und Prognosen.",
    fix: "Behebe dieses Diagramm anhand des folgenden Renderfehlers. Erhalte die beabsichtigte Aussage und erkläre die Korrektur.",
  },
};

export function buildVisualizationActionPrompt(input: {
  action: VisualizationAction;
  format: VisualizationFormat;
  source: string;
  error?: string;
  locale?: "de" | "en";
}): string {
  const longestFence = Math.max(
    2,
    ...Array.from(input.source.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return `${ACTION_PROMPTS[input.locale ?? "en"][input.action]}\n\n${fence}${input.format}\n${input.source}\n${fence}${input.error ? `\n\n${input.locale === "de" ? "Renderfehler" : "Rendering error"}: ${input.error}` : ""}`;
}

export function visualizationDataToCsv(dataset: VisualizationDataset): string {
  const cell = (value: unknown) => {
    const text =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    // Spreadsheet apps execute formula-like strings even inside quoted CSV cells.
    const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    dataset.columns.map(cell).join(","),
    ...dataset.rows.map((row) => dataset.columns.map((column) => cell(row[column])).join(",")),
  ].join("\r\n");
}

/** Holds only preview strings, shared across diagrams; no renderer or view instances. */
export class VisualizationPreviewCache {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, svg: string): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.bytes -= 2 * (key.length + previous.length);
      this.entries.delete(key);
    }
    const bytes = 2 * (key.length + svg.length);
    if (bytes > VISUALIZATION_CACHE_MAX_BYTES) return;
    while (this.bytes + bytes > VISUALIZATION_CACHE_MAX_BYTES) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.bytes -= 2 * (oldest[0].length + oldest[1].length);
      this.entries.delete(oldest[0]);
    }
    this.entries.set(key, svg);
    this.bytes += bytes;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
