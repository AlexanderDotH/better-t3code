import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  VISUALIZATION_CHANNEL,
  type VisualizationAppearance,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";

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

  const stubPreviewFrames = (onRequest: (request: VisualizationRenderRequest) => void) => {
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
          contentWindow: { postMessage: vi.fn(onRequest) },
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
    return frames;
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
    const frames = stubPreviewFrames((request) => {
      requests.push(request);
      notifyStarted();
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

  it.each([
    ["fontFamily", "Georgia, serif"],
    ["background", "#f1f3f5"],
    ["foreground", "#223344"],
    ["mutedForeground", "#667788"],
    ["surface", "#e1e3e5"],
    ["border", "#aabbcc"],
  ] as const)("refreshes cached previews when %s changes", async (field, value) => {
    const { createRenderRequest, renderVisualizationPreview } = await import("./renderer");
    const requests: VisualizationRenderRequest[] = [];
    const frames = stubPreviewFrames((request) => {
      requests.push(request);
      emit(frames[0]!.contentWindow, {
        channel: VISUALIZATION_CHANNEL,
        type: "result",
        requestId: request.requestId,
        svg:
          requests.length === 1
            ? "<svg>Original appearance</svg>"
            : "<svg>Changed appearance</svg>",
      });
    });
    const appearance = {
      fontFamily: "Arial, sans-serif",
      background: "#ffffff",
      foreground: "#111111",
      mutedForeground: "#555555",
      surface: "#eeeeee",
      border: "#cccccc",
    };
    const controller = new AbortController();
    const source = "flowchart LR\nAlpha-->Beta";
    try {
      const original = createRenderRequest("mermaid", source, "light", false, appearance);
      expect(await renderVisualizationPreview(original, controller.signal)).toBe(
        "<svg>Original appearance</svg>",
      );
      expect(
        await renderVisualizationPreview(
          createRenderRequest("mermaid", source, "light", false, { ...appearance }),
          controller.signal,
        ),
      ).toBe("<svg>Original appearance</svg>");
      expect(requests).toHaveLength(1);
      expect(
        await renderVisualizationPreview(
          createRenderRequest("mermaid", source, "light", false, {
            ...appearance,
            [field]: value,
          }),
          controller.signal,
        ),
      ).toBe("<svg>Changed appearance</svg>");
      expect(await renderVisualizationPreview(original, controller.signal)).toBe(
        "<svg>Original appearance</svg>",
      );
      expect(requests).toHaveLength(2);
      expect(frames).toHaveLength(1);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
    }
  });

  it("updates all preview appearances from one shared observer and releases it with the last consumer", async () => {
    const { JSDOM } = await import("jsdom");
    const { act, createElement, Fragment } = await import("react");
    const { create } = await import("react-test-renderer");
    const { useVisualizationAppearance } = await import("./useVisualizationAppearance");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const observers: MutationObserver[] = [];
    let palette = {
      fontFamily: "  FixtureSans, sans-serif  ",
      background: "#ffffff",
      foreground: "#123456",
      mutedForeground: "#667788",
      surface: "#f4f4f4",
      border: "rgba(0, 0, 0, 0.2)",
      card: "rgba(0, 0, 0, 0.1)",
    };
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("getComputedStyle", (element: HTMLElement) => {
      if (element.classList.contains("chat-markdown-codeblock"))
        return { backgroundColor: palette.card };
      const muted = element.style.color === "var(--contrast-muted-foreground)";
      return {
        fontFamily: palette.fontFamily,
        backgroundColor: muted ? palette.surface : palette.background,
        color: muted ? palette.mutedForeground : palette.foreground,
        borderTopColor: palette.border,
      };
    });
    vi.stubGlobal(
      "MutationObserver",
      vi.fn(function (callback: MutationCallback) {
        const observer = new dom.window.MutationObserver(callback);
        observers.push(observer);
        vi.spyOn(observer, "disconnect");
        return observer;
      }),
    );
    const appearances = new Map<string, VisualizationAppearance>();
    function PreviewConsumer({ id }: { id: string }) {
      appearances.set(id, useVisualizationAppearance("light"));
      return null;
    }
    const consumers = (ids: string[]) =>
      createElement(
        Fragment,
        null,
        ids.map((id) => createElement(PreviewConsumer, { key: id, id })),
      );
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(consumers(["first", "second"]));
      });
      expect(observers).toHaveLength(1);
      expect(appearances.get("first")).toEqual({
        fontFamily: "FixtureSans, sans-serif",
        background: "#e6e6e6",
        foreground: "#123456",
        mutedForeground: "#667788",
        surface: "#f4f4f4",
        border: "#b8b8b8",
      });
      expect(appearances.get("second")).toBe(appearances.get("first"));

      await act(async () => {
        palette = {
          fontFamily: "ChangedFixtureSans, sans-serif",
          background: "#222222",
          foreground: "#eeeeee",
          mutedForeground: "#ababab",
          surface: "#444444",
          border: "rgba(255, 255, 255, 0.2)",
          card: "rgba(255, 255, 255, 0.1)",
        };
        dom.window.document.documentElement.classList.add("dark");
      });
      expect(appearances.get("first")).toEqual({
        fontFamily: "ChangedFixtureSans, sans-serif",
        background: "#383838",
        foreground: "#eeeeee",
        mutedForeground: "#ababab",
        surface: "#444444",
        border: "#606060",
      });
      expect(appearances.get("second")).toBe(appearances.get("first"));
      expect(observers).toHaveLength(1);

      await act(async () => {
        renderer!.update(consumers(["second"]));
      });
      expect(observers[0]!.disconnect).not.toHaveBeenCalled();
      await act(async () => {
        renderer!.unmount();
        renderer = undefined;
      });
      expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
      expect(dom.window.document.body.childElementCount).toBe(0);
    } finally {
      await act(async () => renderer?.unmount());
      for (const observer of observers) vi.mocked(observer.disconnect).mockRestore();
      dom.window.close();
    }
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
