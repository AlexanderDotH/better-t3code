import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VISUALIZATION_CHANNEL } from "@t3tools/client-runtime/visualizations/model";

describe("diagram frame bridge", () => {
  let messages: EventTarget;
  beforeEach(() => {
    vi.resetModules();
    messages = new EventTarget();
    vi.stubGlobal("window", messages);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const emit = (source: unknown, data: unknown) => {
    messages.dispatchEvent(Object.assign(new Event("message"), { source, data }));
  };

  it("ignores other windows and stale request IDs, propagates errors, and discards aborted results", async () => {
    const { createRenderRequest, renderInFrame } = await import("./renderer");
    const contentWindow = { postMessage: vi.fn() };
    const frame = { contentWindow } as unknown as HTMLIFrameElement;
    const controller = new AbortController();
    const request = createRenderRequest("mermaid", "flowchart LR\nA-->B", "light");
    const pending = renderInFrame(frame, request, controller.signal);
    const result = {
      channel: VISUALIZATION_CHANNEL,
      type: "result",
      requestId: request.requestId,
      svg: "<svg/>",
    };
    emit({}, result);
    emit(contentWindow, { ...result, requestId: "stale" });
    emit(contentWindow, result);
    await expect(pending).resolves.toBe("<svg/>");

    const failed = renderInFrame(frame, request, controller.signal);
    emit(contentWindow, { ...result, type: "error", error: "Invalid graph" });
    await expect(failed).rejects.toThrow("Invalid graph");

    const cancelled = renderInFrame(frame, request, controller.signal);
    controller.abort();
    emit(contentWindow, result);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  });

  it("serializes previews, reuses its frame/cache, and removes it after the last consumer leaves", async () => {
    const { createRenderRequest, renderVisualizationPreview } = await import("./renderer");
    const requests: Array<{ requestId: string }> = [];
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const frames: Array<{
      contentWindow: { postMessage: ReturnType<typeof vi.fn> };
      remove: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" }),
    );
    vi.stubGlobal("document", {
      baseURI: "https://example.test/thread/a",
      body: { append: vi.fn() },
      createElement: () => {
        const frame = {
          sandbox: { add: vi.fn() },
          setAttribute: vi.fn(),
          style: {},
          remove: vi.fn(),
          contentWindow: {
            postMessage: vi.fn((request: { requestId: string }) => {
              requests.push(request);
              notifyStarted();
            }),
          },
          set srcdoc(_value: string) {
            queueMicrotask(() =>
              emit(frame.contentWindow, { channel: VISUALIZATION_CHANNEL, type: "ready" }),
            );
          },
        };
        frames.push(frame);
        return frame;
      },
    });
    const first = new AbortController();
    const second = new AbortController();
    const request = createRenderRequest("mermaid", "flowchart LR\nA-->B", "light");
    const pending = renderVisualizationPreview(request, first.signal);
    const cached = renderVisualizationPreview(request, second.signal);
    await started;
    expect(frames).toHaveLength(1);
    expect(requests).toHaveLength(1);
    emit(frames[0]!.contentWindow, {
      channel: VISUALIZATION_CHANNEL,
      type: "result",
      requestId: request.requestId,
      svg: "<svg/>",
    });
    await expect(pending).resolves.toBe("<svg/>");
    await expect(cached).resolves.toBe("<svg/>");
    expect(requests).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/visualizations/mermaid.html"),
      { signal: first.signal },
    );
    first.abort();
    expect(frames[0]!.remove).not.toHaveBeenCalled();
    second.abort();
    expect(frames[0]!.remove).toHaveBeenCalledOnce();
  });

  it("does no work for an already cancelled preview", async () => {
    const { createRenderRequest, renderVisualizationPreview } = await import("./renderer");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderVisualizationPreview(
        createRenderRequest("dot", "graph {a--b}", "dark"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
