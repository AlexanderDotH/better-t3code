import {
  VISUALIZATION_CHANNEL,
  VisualizationPreviewCache,
  isVisualizationResponse,
  type VisualizationFormat,
  type VisualizationRenderRequest,
  type VisualizationRequest,
  type VisualizationResponse,
} from "@t3tools/client-runtime/visualizations/model";

const RENDER_TIMEOUT_MS = 30_000;
const previews = new VisualizationPreviewCache();
let queue: Promise<unknown> = Promise.resolve();
let previewFrame: { engine: string; frame: HTMLIFrameElement } | undefined;
const previewConsumers = new Set<AbortSignal>();
let requestSequence = 0;

export function nextVisualizationRequestId() {
  return `web-visualization-${++requestSequence}`;
}

export function visualizationEngine(format: VisualizationFormat) {
  return format === "vega-lite" ? "vega" : format;
}

export function createRenderRequest(
  format: VisualizationFormat,
  source: string,
  theme: "light" | "dark",
  interactive = false,
): VisualizationRenderRequest {
  return {
    channel: VISUALIZATION_CHANNEL,
    type: "render",
    requestId: nextVisualizationRequestId(),
    format,
    source,
    theme,
    interactive,
  };
}

function frameMessage(
  frame: HTMLIFrameElement,
  signal: AbortSignal,
  matches: (response: VisualizationResponse) => boolean,
): Promise<VisualizationResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Rendering cancelled", "AbortError"));
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || !isVisualizationResponse(event.data)) return;
      if (!matches(event.data)) return;
      cleanup();
      if (event.data.type === "error") reject(new Error(event.data.error));
      else resolve(event.data);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The diagram took too long to render. Try a smaller diagram."));
    }, RENDER_TIMEOUT_MS);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function loadVisualizationFrame(
  frame: HTMLIFrameElement,
  format: VisualizationFormat,
  signal: AbortSignal,
) {
  const url = new URL(`/visualizations/${visualizationEngine(format)}.html`, document.baseURI);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Diagram renderer unavailable (HTTP ${response.status}).`);
  const html = await response.text();
  signal.throwIfAborted();
  const ready = frameMessage(frame, signal, (message) => message.type === "ready");
  frame.srcdoc = html;
  await ready;
}

export async function renderInFrame(
  frame: HTMLIFrameElement,
  request: VisualizationRenderRequest,
  signal: AbortSignal,
) {
  const response = await requestVisualizationFrame(frame, request, signal);
  if (response.type !== "result") throw new Error("The renderer returned no diagram.");
  return response.svg;
}

export function requestVisualizationFrame(
  frame: HTMLIFrameElement,
  request: VisualizationRequest,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const pending = frameMessage(
    frame,
    signal,
    (message) => message.type !== "ready" && message.requestId === request.requestId,
  );
  frame.contentWindow?.postMessage(request, "*");
  return pending;
}

export function renderVisualizationPreview(
  request: VisualizationRenderRequest,
  signal: AbortSignal,
): Promise<string> {
  if (!signal.aborted && !previewConsumers.has(signal)) {
    previewConsumers.add(signal);
    signal.addEventListener(
      "abort",
      () => {
        previewConsumers.delete(signal);
        if (previewConsumers.size === 0) {
          previewFrame?.frame.remove();
          previewFrame = undefined;
        }
      },
      { once: true },
    );
  }
  const key = JSON.stringify([request.format, request.source, request.theme]);
  const work = queue
    .catch(() => undefined)
    .then(async () => {
      signal.throwIfAborted();
      const cached = previews.get(key);
      if (cached !== undefined) return cached;
      try {
        const engine = visualizationEngine(request.format);
        if (previewFrame?.engine !== engine) {
          previewFrame?.frame.remove();
          const frame = document.createElement("iframe");
          frame.title = "Diagram renderer";
          frame.sandbox.add("allow-scripts");
          frame.setAttribute("aria-hidden", "true");
          frame.tabIndex = -1;
          frame.style.cssText =
            "position:fixed;left:-10000px;top:0;width:1000px;height:720px;visibility:hidden;pointer-events:none";
          document.body.append(frame);
          previewFrame = { engine, frame };
          await loadVisualizationFrame(frame, request.format, signal);
        }
        const svg = await renderInFrame(previewFrame.frame, request, signal);
        signal.throwIfAborted();
        previews.set(key, svg);
        return svg;
      } catch (error) {
        previewFrame?.frame.remove();
        previewFrame = undefined;
        throw error;
      }
    });
  queue = work.catch(() => undefined);
  return work;
}
