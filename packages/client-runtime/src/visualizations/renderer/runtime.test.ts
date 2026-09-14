// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import {
  VISUALIZATION_CHANNEL,
  type VisualizationRequest,
  type VisualizationResponse,
} from "../model.ts";
import { installVisualizationRuntime, type RenderedDiagram } from "./runtime.ts";

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
