import DOMPurify from "dompurify";
import {
  isVisualizationRequest,
  parseVisualization,
  VISUALIZATION_CHANNEL,
  type VisualizationRenderRequest,
  type VisualizationResponse,
} from "../model.ts";

export type RenderedDiagram = {
  svg: string;
  exportSvg?: () => Promise<string>;
  dispose?: () => void;
};

const svgSanitizerOptions = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["foreignObject", "image", "animate", "animateMotion", "animateTransform", "set"],
};

function hasExternalCssReference(value: string): boolean {
  if (/@import|\\|\/\*/i.test(value)) return true;
  return Array.from(value.matchAll(/url\(\s*([^)]*)\)/gi)).some(
    (match) =>
      !match[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, "")
        .startsWith("#"),
  );
}

export function sanitizeVisualizationSvg(source: string): string {
  const clean = DOMPurify.sanitize(source, svgSanitizerOptions);
  const document = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror")) {
    throw new Error("The renderer did not produce a valid SVG image.");
  }
  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        ((attribute.localName === "href" || attribute.localName === "src") &&
          !attribute.value.startsWith("#")) ||
        hasExternalCssReference(attribute.value)
      ) {
        element.removeAttributeNode(attribute);
      }
    }
    if (element.localName === "style" && hasExternalCssReference(element.textContent ?? "")) {
      element.remove();
    }
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!svg.hasAttribute("viewBox")) {
    const width = Number.parseFloat(svg.getAttribute("width") ?? "");
    const height = Number.parseFloat(svg.getAttribute("height") ?? "");
    if (width > 0 && height > 0) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  return new XMLSerializer().serializeToString(svg);
}

async function svgToPng(svg: string): Promise<string> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("The diagram could not be converted to PNG.")),
        { once: true },
      );
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(2, 4096 / Math.max(image.naturalWidth, image.naturalHeight, 1));
    canvas.width = Math.max(1, Math.ceil(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.ceil(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable on this device.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function installVisualizationRuntime(
  render: (request: VisualizationRenderRequest, container: HTMLElement) => Promise<RenderedDiagram>,
): () => void {
  const container = document.getElementById("diagram");
  if (!container) throw new Error("Missing diagram container.");
  const host = window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  };
  const post = (message: VisualizationResponse) => {
    // The native bridge accepts only a string; targetOrigin belongs to the browser branch below.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage(message, "*");
  };
  let current: RenderedDiagram | undefined;
  let scale = 1;
  let offset = { x: 0, y: 0 };
  let pan = false;
  let drag: { id: number; x: number; y: number } | undefined;
  const updateView = () => {
    container.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
    container.style.cursor = pan ? "grab" : "auto";
    container.style.touchAction = pan ? "none" : "auto";
  };
  const fit = () => {
    scale = 1;
    offset = { x: 0, y: 0 };
    updateView();
  };
  container.addEventListener("keydown", (event) => {
    const step = 32;
    if (event.key === "ArrowLeft") offset.x -= step;
    else if (event.key === "ArrowRight") offset.x += step;
    else if (event.key === "ArrowUp") offset.y -= step;
    else if (event.key === "ArrowDown") offset.y += step;
    else if (event.key === "+" || event.key === "=") scale = Math.min(8, scale * 1.25);
    else if (event.key === "-") scale = Math.max(0.1, scale * 0.8);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
    updateView();
  });
  container.addEventListener(
    "pointerdown",
    (event) => {
      if (!pan) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { id: event.pointerId, x: event.clientX - offset.x, y: event.clientY - offset.y };
      container.setPointerCapture(event.pointerId);
    },
    true,
  );
  container.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      offset = { x: event.clientX - drag.x, y: event.clientY - drag.y };
      updateView();
    },
    true,
  );
  const endDrag = () => {
    drag = undefined;
  };
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
  // ponytail: one queue protects PlantUML's shared TeaVM state; parallel engines need separate contexts.
  let queue = Promise.resolve();
  const receive = (event: MessageEvent<unknown>) => {
    if (!host.ReactNativeWebView && event.source !== window.parent) return;
    let data = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!isVisualizationRequest(data)) return;
    // Android dispatches bridge messages on document; do not handle the same event again on window.
    if (event.currentTarget === document) event.stopPropagation();
    const request = data;
    queue = queue.then(async () => {
      try {
        if (request.type === "view") {
          if (request.action === "fit") fit();
          else if (request.action === "pan" || request.action === "select")
            pan = request.action === "pan";
          else
            scale = Math.min(8, Math.max(0.1, scale * (request.action === "zoom-in" ? 1.25 : 0.8)));
          updateView();
          return;
        }
        if (request.type === "render") {
          const diagram = parseVisualization(request.format, request.source);
          current?.dispose?.();
          current = undefined;
          container.replaceChildren();
          document.documentElement.style.colorScheme = request.theme;
          document.body.style.background = request.theme === "dark" ? "#171717" : "#ffffff";
          fit();
          current = await render(request, container);
          current.svg = sanitizeVisualizationSvg(current.svg);
          if (!request.interactive || !current.exportSvg) container.innerHTML = current.svg;
          const svg = container.querySelector("svg");
          const description =
            diagram.metadata.summary ||
            svg?.getAttribute("aria-label") ||
            `${request.format} diagram`;
          container.setAttribute("role", "group");
          container.setAttribute(
            "aria-label",
            `${description}. Use arrow keys to pan, plus or minus to zoom, and zero to fit.`,
          );
          if (svg) {
            // Preserve Vega's event handlers while sanitizing the live interactive DOM.
            DOMPurify.sanitize(svg, { ...svgSanitizerOptions, IN_PLACE: true });
            svg.setAttribute("aria-label", description);
            if (!svg.hasAttribute("viewBox"))
              svg.setAttribute(
                "viewBox",
                `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`,
              );
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        }
        if (!current) throw new Error("Render a diagram before exporting it.");
        const svg = sanitizeVisualizationSvg(
          current.exportSvg ? await current.exportSvg() : current.svg,
        );
        if (request.type === "export-png") {
          post({
            channel: VISUALIZATION_CHANNEL,
            type: "png",
            requestId: request.requestId,
            dataUrl: await svgToPng(svg),
          });
        } else {
          post({
            channel: VISUALIZATION_CHANNEL,
            type: "result",
            requestId: request.requestId,
            svg,
          });
        }
      } catch (error) {
        post({
          channel: VISUALIZATION_CHANNEL,
          type: "error",
          requestId: request.requestId,
          error: error instanceof Error ? error.message : "The diagram could not be rendered.",
        });
      }
    });
  };
  window.addEventListener("message", receive);
  document.addEventListener("message", receive as EventListener);
  post({ channel: VISUALIZATION_CHANNEL, type: "ready" });
  return () => {
    window.removeEventListener("message", receive);
    document.removeEventListener("message", receive as EventListener);
    current?.dispose?.();
  };
}
