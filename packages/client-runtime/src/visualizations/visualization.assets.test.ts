// @effect-diagnostics-next-line nodeBuiltinImport:off - This acceptance test builds the shipped browser assets before executing them.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Read the exact build output bytes for CSP and browser/mobile parity checks.
import * as NodeFSP from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { beforeAll, expect, test } from "vite-plus/test";
import { VISUALIZATION_EXAMPLES } from "./examples.ts";
import {
  isVisualizationResponse,
  VISUALIZATION_CHANNEL,
  type VisualizationRequest,
  type VisualizationResponse,
} from "./model.ts";

const root = new URL("../../../../", import.meta.url);

beforeAll(() => {
  NodeChildProcess.execFileSync("node", ["scripts/build-visualizations.mjs", "--if-needed"], {
    cwd: root,
    stdio: "pipe",
  });
}, 30_000);

for (const [format, exampleId] of [
  ["mermaid", "mermaid-flowchart"],
  ["plantuml", "plantuml-component"],
  ["dot", "dot-directed"],
  ["vega", "vega-lite-selection"],
] as const) {
  test(`${format} shipped HTML boots, renders and exports through the host protocol`, async () => {
    const html = await NodeFSP.readFile(
      new URL(`apps/web/public/visualizations/${format}.html`, root),
      "utf8",
    );
    expect(
      await NodeFSP.readFile(
        new URL(`apps/mobile/assets/visualizations/${format}.html`, root),
        "utf8",
      ),
    ).toBe(html);
    const source = new JSDOM(html);
    const csp = source.window.document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    const scripts = [...source.window.document.querySelectorAll("script")];
    expect(scripts.length).toBe(format === "plantuml" ? 2 : 1);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    for (const script of scripts) {
      expect(script.src).toBe("");
      const hash = NodeCrypto.createHash("sha256")
        .update(script.textContent ?? "")
        .digest("base64");
      expect(csp).toContain(`'sha256-${hash}'`);
    }
    source.window.close();

    const messages: VisualizationResponse[] = [];
    const waiters = new Map<string, (message: VisualizationResponse) => void>();
    const errors: string[] = [];
    const console = new VirtualConsole();
    console.on("jsdomError", (error: Error) => {
      errors.push(error.message);
    });
    let networkRequests = 0;
    const dom = new JSDOM(html, {
      url: "https://visualization.invalid/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: console,
      beforeParse(window) {
        window.TextEncoder = TextEncoder;
        window.TextDecoder = TextDecoder;
        window.structuredClone = structuredClone;
        window.fetch = () => {
          networkRequests++;
          return Promise.reject(new Error("Network disabled in asset acceptance."));
        };
        window.postMessage = (data: unknown) => {
          if (!isVisualizationResponse(data)) return;
          messages.push(data);
          waiters.get(data.type === "ready" ? "ready" : data.requestId)?.(data);
        };
        Object.defineProperty(window.SVGElement.prototype, "getBBox", {
          value() {
            return { x: 0, y: 0, width: 200, height: 80 };
          },
        });
        Object.defineProperty(window.SVGElement.prototype, "getComputedTextLength", {
          value() {
            return 80;
          },
        });
        Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
          value() {
            return { measureText: (text: string) => ({ width: text.length * 8 }) };
          },
        });
      },
    });
    const receive = (requestId: string) => {
      const previous = messages.find((message) =>
        message.type === "ready" ? requestId === "ready" : message.requestId === requestId,
      );
      return previous
        ? Promise.resolve(previous)
        : new Promise<VisualizationResponse>((resolve) => {
            waiters.set(requestId, resolve);
          });
    };
    const send = async (request: VisualizationRequest) => {
      const response = receive(request.requestId);
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          data: request,
          source: dom.window as unknown as Window,
        }),
      );
      return response;
    };
    try {
      expect(errors).toEqual([]);
      expect(await receive("ready")).toEqual({ channel: VISUALIZATION_CHANNEL, type: "ready" });
      const example = VISUALIZATION_EXAMPLES.find((entry) => entry.id === exampleId)!;
      const rendered = await send({
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: "render-1",
        format: example.format,
        source: example.source,
        theme: "light",
        interactive: format === "vega",
      });
      expect(rendered.type, JSON.stringify(rendered)).toBe("result");
      if (rendered.type !== "result") throw new Error(JSON.stringify(rendered));
      expect(rendered.svg).toContain("<svg");
      expect(dom.window.document.querySelector("#diagram svg")).not.toBeNull();
      expect(dom.window.document.querySelector("#diagram")?.getAttribute("role")).toBe("group");
      expect(
        dom.window.document.querySelector("#diagram svg")?.getAttribute("aria-label"),
      ).toBeTruthy();
      const exported = await send({
        channel: VISUALIZATION_CHANNEL,
        type: "export-svg",
        requestId: "export-1",
      });
      expect(exported).toMatchObject({ type: "result", svg: rendered.svg });
      if (format === "vega") {
        const symbol = dom.window.document.querySelector(".role-legend-symbol path");
        expect(symbol).not.toBeNull();
        symbol!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        const selection = await send({
          channel: VISUALIZATION_CHANNEL,
          type: "export-svg",
          requestId: "selection-1",
        });
        expect(selection.type).toBe("result");
        if (selection.type !== "result") throw new Error(JSON.stringify(selection));
        expect(selection.svg).not.toEqual(rendered.svg);
        expect(selection.svg).toContain('opacity="0.2"');
      }
      const invalid = await send({
        channel: VISUALIZATION_CHANNEL,
        type: "render",
        requestId: "invalid-1",
        format: "vega-lite",
        source: "{",
        theme: "light",
      });
      expect(invalid).toMatchObject({ type: "error", requestId: "invalid-1" });
      expect(networkRequests).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      dom.window.close();
    }
  }, 30_000);
}
