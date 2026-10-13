// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { prepareVisualizationSvgExport } from "../export.ts";
import {
  VISUALIZATION_CHANNEL,
  type VisualizationRequest,
  type VisualizationResponse,
} from "../model.ts";
import {
  installVisualizationRuntime,
  sanitizeVisualizationSvg,
  type RenderedDiagram,
} from "./runtime.ts";

test("adds a standalone export canvas while keeping the preview transparent", () => {
  const preview =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" style="font-family:Inter"><text fill="#eeeeee">Readable outside the app</text></svg>';
  const exported = prepareVisualizationSvgExport(preview, "#171717");
  const svg = new DOMParser().parseFromString(exported, "image/svg+xml").documentElement;
  expect(svg.style.backgroundColor).toBe("rgb(23, 23, 23)");
  expect(svg.style.fontFamily).toBe("Inter");
  expect(svg.querySelector("text")?.getAttribute("fill")).toBe("#eeeeee");
  expect(preview).not.toContain("background");
});

test("preserves an authored export canvas", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" style="background-color:#f7ead5"><text fill="#222222">Authored palette</text></svg>';
  const exported = prepareVisualizationSvgExport(source, "#171717");
  const svg = new DOMParser().parseFromString(exported, "image/svg+xml").documentElement;
  expect(svg.style.backgroundColor).toBe("rgb(247, 234, 213)");
  expect(svg.querySelector("text")?.getAttribute("fill")).toBe("#222222");
});

test("gives percentage-sized SVG exports intrinsic pixel dimensions for PNG rasterization", () => {
  const result = sanitizeVisualizationSvg(
    '<svg width="100%" viewBox="0 0 742 296" style="max-width:742px"><text>Readable label</text></svg>',
  );
  const svg = new DOMParser().parseFromString(result, "image/svg+xml").documentElement;
  expect(svg.getAttribute("width")).toBe("742");
  expect(svg.getAttribute("height")).toBe("296");
  expect(svg.getAttribute("viewBox")).toBe("0 0 742 296");
  expect(svg.querySelector("text")?.textContent).toBe("Readable label");
});

test("keeps explicit numeric SVG dimensions and its authored viewBox", () => {
  const result = sanitizeVisualizationSvg('<svg width="320" height="160" viewBox="0 0 640 320"/>');
  const svg = new DOMParser().parseFromString(result, "image/svg+xml").documentElement;
  expect(svg.getAttribute("width")).toBe("320");
  expect(svg.getAttribute("height")).toBe("160");
  expect(svg.getAttribute("viewBox")).toBe("0 0 640 320");
});

test("serializes rendering, rejects invalid source, exports sanitized SVG and supports keyboard navigation", async () => {
  document.body.innerHTML = '<div id="diagram" tabindex="0"></div>';
  const first = Promise.withResolvers<RenderedDiagram>();
  const started = Promise.withResolvers<void>();
  const receipts = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<VisualizationResponse>>
  >();
  const post = vi.spyOn(window, "postMessage").mockImplementation((message) => {
    const response = message as VisualizationResponse;
    if ("requestId" in response) receipts.get(response.requestId)?.resolve(response);
  });
  const render = vi.fn(async () => {
    if (render.mock.calls.length === 1) {
      started.resolve();
      return first.promise;
    }
    return { svg: '<svg width="40" height="20"><text>Second</text></svg>' };
  });
  const dispose = installVisualizationRuntime(render);
  const send = (request: VisualizationRequest) => {
    const receipt = Promise.withResolvers<VisualizationResponse>();
    receipts.set(request.requestId, receipt);
    window.dispatchEvent(new MessageEvent("message", { data: request, source: window.parent }));
    return receipt.promise;
  };
  try {
    expect(post).toHaveBeenCalledWith({ channel: VISUALIZATION_CHANNEL, type: "ready" }, "*");
    const request = {
      channel: VISUALIZATION_CHANNEL,
      type: "render",
      format: "dot",
      source: "digraph {a -> b}",
      theme: "light",
    } as const;
    const firstResult = send({ ...request, requestId: "first" });
    await started.promise;
    const secondResult = send({ ...request, requestId: "second" });
    expect(render).toHaveBeenCalledTimes(1);
    first.resolve({
      svg: '<svg width="100" height="50" onload="alert(1)"><text>First</text></svg>',
    });
    expect(await firstResult).toMatchObject({ type: "result", requestId: "first" });
    expect(await secondResult).toMatchObject({ type: "result", requestId: "second" });
    expect(render).toHaveBeenCalledTimes(2);
    const invalid = await send({ ...request, requestId: "invalid", source: "x".repeat(65_537) });
    expect(invalid).toMatchObject({ type: "error", requestId: "invalid" });
    expect(render).toHaveBeenCalledTimes(2);
    document.dispatchEvent(
      new MessageEvent("message", {
        data: { ...request, requestId: "android-document" },
        source: window.parent,
        bubbles: true,
      }),
    );
    const exported = await send({
      channel: VISUALIZATION_CHANNEL,
      type: "export-svg",
      requestId: "export",
    });
    expect(exported).toMatchObject({ type: "result", svg: expect.stringContaining("Second") });
    expect(render).toHaveBeenCalledTimes(3);
    const container = document.getElementById("diagram")!;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "+", cancelable: true }));
    expect(container.style.transform).toContain("scale(1.25)");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(container.style.transform).toContain("translate(32px, 0px)");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "0", cancelable: true }));
    expect(container.style.transform).toBe("translate(0px, 0px) scale(1)");
  } finally {
    dispose();
    post.mockRestore();
    document.body.replaceChildren();
  }
});

test("keeps the appearance and current interactive state in SVG and PNG exports", async () => {
  document.body.innerHTML = '<div id="diagram" tabindex="0"></div>';
  const bodyStyle = document.body.style.cssText;
  const rootStyle = document.documentElement.style.cssText;
  const appearance = {
    fontFamily: "T3FixtureSans",
    background: "#101c2c",
    foreground: "#e8edf5",
    mutedForeground: "#a0b3ca",
    surface: "#26374d",
    border: "#657a96",
  };
  const svg = (label: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60" style="font-family:${appearance.fontFamily}"><rect width="120" height="60" fill="${appearance.background}"/><text fill="${appearance.foreground}">${label}</text><path fill="#b419e7" d="M0 0L10 10Z"/></svg>`;
  let currentSvg = svg("Original data");
  const receipts = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<VisualizationResponse>>
  >();
  const post = vi.spyOn(window, "postMessage").mockImplementation((message) => {
    const response = message as VisualizationResponse;
    if ("requestId" in response) receipts.get(response.requestId)?.resolve(response);
  });
  const pngSources: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((source: Blob) => {
      pngSources.push(source);
      return "blob:diagram-export";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "Image",
    class extends EventTarget {
      naturalWidth = 120;
      naturalHeight = 60;
      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    },
  );
  const drawImage = vi.fn();
  const canvasPrototype = HTMLCanvasElement.prototype as {
    getContext: (contextId: "2d") => CanvasRenderingContext2D | null;
  };
  const context = vi
    .spyOn(canvasPrototype, "getContext")
    .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const png = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,AAAA");
  const dispose = installVisualizationRuntime(async (_request, container) => {
    container.innerHTML = currentSvg;
    return { svg: currentSvg, exportSvg: async () => currentSvg };
  });
  const send = (request: VisualizationRequest) => {
    const receipt = Promise.withResolvers<VisualizationResponse>();
    receipts.set(request.requestId, receipt);
    window.dispatchEvent(new MessageEvent("message", { data: request, source: window.parent }));
    return receipt.promise;
  };
  try {
    const rendered = await send({
      channel: VISUALIZATION_CHANNEL,
      type: "render",
      requestId: "appearance",
      format: "vega",
      source: "{}",
      theme: "dark",
      appearance,
      interactive: true,
    });
    expect(rendered).toMatchObject({
      type: "result",
      svg: expect.stringContaining("Original data"),
    });
    expect(document.body.style.backgroundColor).toBe("rgb(16, 28, 44)");
    expect(document.body.style.color).toBe("rgb(232, 237, 245)");
    expect(document.body.style.fontFamily).toContain(appearance.fontFamily);

    currentSvg = svg("Selected data");
    const exported = await send({
      channel: VISUALIZATION_CHANNEL,
      type: "export-svg",
      requestId: "styled-svg",
    });
    expect(exported.type).toBe("result");
    if (exported.type !== "result") throw new Error("Expected an SVG export.");
    const exportedDocument = new DOMParser().parseFromString(exported.svg, "image/svg+xml");
    expect(exportedDocument.documentElement.getAttribute("width")).toBe("120");
    expect(exportedDocument.documentElement.getAttribute("height")).toBe("60");
    expect(exportedDocument.querySelector("rect")?.getAttribute("fill")).toBe(
      appearance.background,
    );
    expect(exportedDocument.querySelector("text")?.getAttribute("fill")).toBe(
      appearance.foreground,
    );
    expect(exportedDocument.querySelector("path")?.getAttribute("fill")).toBe("#b419e7");
    expect(exportedDocument.documentElement.style.fontFamily).toContain(appearance.fontFamily);
    expect(exportedDocument.documentElement.style.backgroundColor).toBe("rgb(16, 28, 44)");
    expect(exportedDocument.querySelector("text")?.textContent).toBe("Selected data");

    expect(
      await send({
        channel: VISUALIZATION_CHANNEL,
        type: "export-png",
        requestId: "styled-png",
      }),
    ).toMatchObject({ type: "png", dataUrl: "data:image/png;base64,AAAA" });
    expect(pngSources).toHaveLength(1);
    const pngSource = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
      reader.addEventListener("error", () => reject(reader.error), { once: true });
      reader.readAsText(pngSources[0]!);
    });
    expect(pngSource).toBe(exported.svg);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 240, 120);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagram-export");
  } finally {
    dispose();
    post.mockRestore();
    context.mockRestore();
    png.mockRestore();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.style.cssText = bodyStyle;
    document.documentElement.style.cssText = rootStyle;
  }
});
