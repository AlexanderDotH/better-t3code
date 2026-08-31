import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  calculateStreamingTextMotionTiming,
  createStreamingTextMotionFrame,
  detectStreamingTextAppend,
  getStreamingTextMotionAnimationTiming,
  getStreamingTextMotionDelayMs,
  mapSourceAppendToRenderedSuffix,
  mapSourceFrameToRenderedText,
  segmentStreamingTextGraphemes,
  smoothStreamingTextRate,
} from "./streamingTextMotion";
import {
  advanceStreamingTextMotionCommit,
  clearCompletedStreamingTextMotionSequence,
  createStreamingTextMotionFramePublisher,
  type StreamingTextMotionSnapshot,
  useStreamingTextMotion,
} from "./useStreamingTextMotion";

const nativeSegmenter = Intl.Segmenter;

afterEach(() => {
  Object.defineProperty(Intl, "Segmenter", {
    configurable: true,
    value: nativeSegmenter,
    writable: true,
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class StreamingMotionTestNode {
  parentNode: StreamingMotionTestNode | null = null;
  childNodes: StreamingMotionTestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: StreamingMotionTestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: StreamingMotionTestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: StreamingMotionTestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new StreamingMotionTestNode(name, this);
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installStreamingMotionTestDom() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  const document = new StreamingMotionTestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: StreamingMotionTestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancelAnimationFrame: (frameId: number) => {
      callbacks.delete(frameId);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return { callbacks, document };
}

function StreamingTextMotionHarness(props: {
  readonly text: string;
  readonly isStreaming: boolean;
}) {
  useStreamingTextMotion({
    text: props.text,
    streamId: "message-1",
    isStreaming: props.isStreaming,
    animateInitialStreamChunk: false,
  });
  return null;
}

describe("streaming text graphemes", () => {
  it("keeps emoji families, flags, and combining accents intact", () => {
    const input = "A👨‍👩‍👧‍👦🇩🇪e\u0301";

    const graphemes = segmentStreamingTextGraphemes(input, 7);

    expect(graphemes.map(({ text }) => text)).toEqual(["A", "👨‍👩‍👧‍👦", "🇩🇪", "e\u0301"]);
    expect(graphemes.map(({ sourceOffset }) => sourceOffset)).toEqual([7, 8, 19, 23]);
  });

  it("falls back to Unicode code points when Intl.Segmenter is unavailable", () => {
    Object.defineProperty(Intl, "Segmenter", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(segmentStreamingTextGraphemes("A😀", 3)).toEqual([
      { index: 0, sourceOffset: 3, text: "A" },
      { index: 1, sourceOffset: 4, text: "😀" },
    ]);
  });
});

describe("streaming append detection", () => {
  it("returns the exact append boundary and Unicode graphemes", () => {
    const append = detectStreamingTextAppend("Hello ", "Hello 👋🏽!");

    expect(append).toEqual({
      sourceStart: 6,
      sourceEnd: 11,
      text: "👋🏽!",
      graphemes: [
        { index: 0, sourceOffset: 6, text: "👋🏽" },
        { index: 1, sourceOffset: 10, text: "!" },
      ],
    });
  });

  it("moves the append boundary back when provider deltas split a visual character", () => {
    expect(detectStreamingTextAppend("e", "e\u0301")).toEqual({
      sourceStart: 0,
      sourceEnd: 2,
      text: "e\u0301",
      graphemes: [{ index: 0, sourceOffset: 0, text: "e\u0301" }],
    });
    expect(detectStreamingTextAppend("👨", "👨‍👩")).toEqual({
      sourceStart: 0,
      sourceEnd: 5,
      text: "👨‍👩",
      graphemes: [{ index: 0, sourceOffset: 0, text: "👨‍👩" }],
    });
  });

  it("rejects unchanged, replaced, and truncated text", () => {
    expect(detectStreamingTextAppend("same", "same")).toBeNull();
    expect(detectStreamingTextAppend("word", "ward")).toBeNull();
    expect(detectStreamingTextAppend("longer", "long")).toBeNull();
  });
});

describe("adaptive streaming timing", () => {
  it("uses the slow-output budget at 20 graphemes per second", () => {
    expect(calculateStreamingTextMotionTiming(20, 4)).toEqual({
      durationMs: 125,
      staggerWindowMs: 35,
      staggerStepMs: 35 / 3,
      revealDeadlineMs: 160,
    });
  });

  it("uses the fast-output budget at 180 graphemes per second", () => {
    expect(calculateStreamingTextMotionTiming(180, 4)).toEqual({
      durationMs: 65,
      staggerWindowMs: 6,
      staggerStepMs: 2,
      revealDeadlineMs: 71,
    });
  });

  it("interpolates between timing budgets and caps the final reveal at 160ms", () => {
    const timing = calculateStreamingTextMotionTiming(100, 2);

    expect(timing).toEqual({
      durationMs: 95,
      staggerWindowMs: 20.5,
      staggerStepMs: 20.5,
      revealDeadlineMs: 115.5,
    });
    expect(timing.revealDeadlineMs).toBeLessThanOrEqual(160);
  });

  it("uses no stagger for a one-grapheme batch", () => {
    expect(calculateStreamingTextMotionTiming(20, 1)).toEqual({
      durationMs: 125,
      staggerWindowMs: 35,
      staggerStepMs: 0,
      revealDeadlineMs: 125,
    });
  });

  it("smooths observed output using an EWMA factor of 0.35", () => {
    expect(smoothStreamingTextRate(undefined, 80)).toBe(80);
    expect(smoothStreamingTextRate(80, 180)).toBe(115);
  });

  it("animates only the newest 512 graphemes of an oversized Unicode append", () => {
    const previousText = "seed:";
    const skippedGrapheme = "👨‍👩‍👧‍👦";
    const animatedText = `e\u0301${"x".repeat(511)}`;
    const text = `${previousText}${skippedGrapheme}${animatedText}`;
    const append = detectStreamingTextAppend(previousText, text)!;
    const result = createStreamingTextMotionFrame({
      append,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });
    const sourceStart = previousText.length + skippedGrapheme.length;

    expect(append.text).toBe(`${skippedGrapheme}${animatedText}`);
    expect(result.frame).toMatchObject({
      graphemeCount: 512,
      sourceEnd: text.length,
      sourceStart,
    });
    expect(result.smoothedRate).toBe(5_130);
    const mapped = mapSourceFrameToRenderedText({
      frame: result.frame!,
      source: text,
      sourceStart: 0,
      sourceEnd: text.length,
      renderedText: text,
    });

    expect(mapped).toMatchObject({
      renderedStart: sourceStart,
      sourceStart,
      text: animatedText,
    });
    expect(mapped?.graphemes).toHaveLength(512);
    expect(mapped?.graphemes[0]).toEqual({
      index: 0,
      sourceOffset: sourceStart,
      text: "e\u0301",
    });
  });

  it("divides one stagger window across the batch", () => {
    const append = detectStreamingTextAppend("", "abcd");
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 200,
      generation: 7,
      previousRate: undefined,
    });

    expect(result.frame?.generation).toBe(7);
    expect(getStreamingTextMotionDelayMs(result.frame!, 0)).toBe(0);
    expect(getStreamingTextMotionDelayMs(result.frame!, 3)).toBe(35);
    expect(result.frame?.revealDeadlineMs).toBe(160);
  });

  it("resumes retained character motion when a renderer remounts its spans", () => {
    const append = detectStreamingTextAppend("", "x");
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
      startedAtMs: 100,
    });

    expect(getStreamingTextMotionDelayMs(result.frame!, 0, 150)).toBe(-50);
    expect(getStreamingTextMotionAnimationTiming(result.frame!, 0, 150)).toEqual({
      delayMs: -50,
      durationMs: 125,
    });
  });
});

describe("Markdown source reconciliation", () => {
  it("maps a retained frame after a later provider delta extends the rendered text", () => {
    const append = detectStreamingTextAppend("seed", "seed!");
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });

    expect(
      mapSourceFrameToRenderedText({
        frame: result.frame!,
        source: "seed!?",
        sourceStart: 0,
        sourceEnd: 6,
        renderedText: "seed!?",
      }),
    ).toEqual({
      renderedStart: 4,
      renderedEnd: 5,
      sourceStart: 4,
      text: "!",
      graphemes: [{ index: 0, sourceOffset: 4, text: "!" }],
    });
  });

  it("maps only the appended visible suffix across a Markdown structure transition", () => {
    const source = "**world**";
    const append = detectStreamingTextAppend("**wor", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 4,
      previousRate: undefined,
    });

    const mapped = mapSourceAppendToRenderedSuffix({
      frame: result.frame!,
      source,
      sourceStart: 2,
      sourceEnd: 7,
      renderedText: "world",
    });

    expect(mapped).toEqual({
      renderedStart: 3,
      sourceStart: 5,
      text: "ld",
      graphemes: [
        { index: 0, sourceOffset: 5, text: "l" },
        { index: 1, sourceOffset: 6, text: "d" },
      ],
    });
    expect(
      mapSourceFrameToRenderedText({
        frame: result.frame!,
        source,
        sourceStart: 2,
        sourceEnd: source.length,
        renderedText: "world",
      }),
    ).toEqual({ ...mapped!, renderedEnd: 5 });
  });

  it("excludes appended closing Markdown syntax from a rendered suffix", () => {
    const source = "**world**";
    const append = detectStreamingTextAppend("**wor", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 4,
      previousRate: undefined,
    });

    const mapped = mapSourceAppendToRenderedSuffix({
      frame: result.frame!,
      source,
      sourceStart: 2,
      sourceEnd: source.length,
      renderedText: "world",
    });

    expect(mapped?.text).toBe("ld");
    expect(mapped?.sourceStart).toBe(5);
    expect(mapped?.renderedStart).toBe(3);
  });

  it("maps a new text node that lies fully inside the appended source", () => {
    const source = "Hello [world](https://example.com)";
    const append = detectStreamingTextAppend("Hello ", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });

    const mapped = mapSourceAppendToRenderedSuffix({
      frame: result.frame!,
      source,
      sourceStart: 7,
      sourceEnd: 12,
      renderedText: "world",
    });

    expect(mapped?.text).toBe("world");
    expect(mapped?.renderedStart).toBe(0);
    expect(mapped?.graphemes[0]?.index).toBe(1);
  });

  it("declines animation when source positions cannot prove the rendered suffix", () => {
    const source = "Fish &amp; chips";
    const append = detectStreamingTextAppend("Fish ", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });

    expect(
      mapSourceAppendToRenderedSuffix({
        frame: result.frame!,
        source,
        sourceStart: 5,
        sourceEnd: source.length,
        renderedText: "& chips",
      }),
    ).toBeNull();
  });

  it("rejects an incidental suffix match when the pre-append source does not reconcile", () => {
    const source = "priorl!";
    const append = detectStreamingTextAppend("prior", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });

    expect(
      mapSourceAppendToRenderedSuffix({
        frame: result.frame!,
        source,
        sourceStart: 0,
        sourceEnd: source.length,
        renderedText: "mismatchl",
      }),
    ).toBeNull();
  });

  it("ignores text nodes that end before the append boundary", () => {
    const source = "old new";
    const append = detectStreamingTextAppend("old ", source);
    const result = createStreamingTextMotionFrame({
      append: append!,
      elapsedMs: 100,
      generation: 1,
      previousRate: undefined,
    });

    expect(
      mapSourceAppendToRenderedSuffix({
        frame: result.frame!,
        source,
        sourceStart: 0,
        sourceEnd: 3,
        renderedText: "old",
      }),
    ).toBeNull();
  });
});

describe("streaming motion commit lifecycle", () => {
  it("drains the hook cleanup timer and pending frame when streaming settles", async () => {
    vi.useFakeTimers();
    const { callbacks, document } = installStreamingMotionTestDom();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.createElement("div") as unknown as Element);

    try {
      await act(() => {
        root.render(createElement(StreamingTextMotionHarness, { text: "", isStreaming: true }));
      });
      await act(() => {
        root.render(createElement(StreamingTextMotionHarness, { text: "A", isStreaming: true }));
      });

      expect(callbacks.size).toBe(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await act(() => {
        root.render(createElement(StreamingTextMotionHarness, { text: "A", isStreaming: false }));
      });

      expect(callbacks.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("drains the hook cleanup timer and pending frame when the renderer unmounts", async () => {
    vi.useFakeTimers();
    const { callbacks, document } = installStreamingMotionTestDom();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.createElement("div") as unknown as Element);

    await act(() => {
      root.render(createElement(StreamingTextMotionHarness, { text: "", isStreaming: true }));
    });
    await act(() => {
      root.render(createElement(StreamingTextMotionHarness, { text: "A", isStreaming: true }));
    });

    expect(callbacks.size).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await act(() => root.unmount());

    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes rapid streaming commits once per animation frame", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const published: StreamingTextMotionSnapshot[] = [];
    let nextFrameId = 0;
    const publisher = createStreamingTextMotionFramePublisher({
      cancelFrame: (frameId) => callbacks.delete(frameId),
      publish: (snapshot) => published.push(snapshot),
      requestFrame: (callback) => {
        nextFrameId += 1;
        callbacks.set(nextFrameId, callback);
        return nextFrameId;
      },
    });
    const first = { animationTimeMs: 10, frames: [] } satisfies StreamingTextMotionSnapshot;
    const latest = { animationTimeMs: 11, frames: [] } satisfies StreamingTextMotionSnapshot;

    publisher.enqueue(first);
    publisher.enqueue(latest);

    expect(callbacks).toHaveLength(1);
    expect(published).toHaveLength(0);
    callbacks.values().next().value?.(12);
    expect(published).toEqual([latest]);
  });

  it("cancels pending frame publication when streaming settles", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const published: StreamingTextMotionSnapshot[] = [];
    const publisher = createStreamingTextMotionFramePublisher({
      cancelFrame: (frameId) => {
        cancelled.push(frameId);
        callbacks.delete(frameId);
      },
      publish: (snapshot) => published.push(snapshot),
      requestFrame: (callback) => {
        callbacks.set(7, callback);
        return 7;
      },
    });
    const active = { animationTimeMs: 10, frames: [] } satisfies StreamingTextMotionSnapshot;
    const settled = { animationTimeMs: 11, frames: [] } satisfies StreamingTextMotionSnapshot;

    publisher.enqueue(active);
    publisher.flush(settled);

    expect(cancelled).toEqual([7]);
    expect(callbacks).toHaveLength(0);
    expect(published).toEqual([settled]);
  });

  it("leaves no scheduled frame behind when the renderer unmounts", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const published: StreamingTextMotionSnapshot[] = [];
    const publisher = createStreamingTextMotionFramePublisher({
      cancelFrame: (frameId) => {
        cancelled.push(frameId);
        callbacks.delete(frameId);
      },
      publish: (snapshot) => published.push(snapshot),
      requestFrame: (callback) => {
        callbacks.set(11, callback);
        return 11;
      },
    });

    publisher.enqueue({ animationTimeMs: 10, frames: [] });
    publisher.dispose();

    expect(cancelled).toEqual([11]);
    expect(callbacks).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("keeps a reveal sequence mounted until its final provider delta finishes", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 0,
      streamId: "message-1",
      text: "",
    });
    const firstDelta = advanceStreamingTextMotionCommit(hydrated, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "A",
    });
    const secondDelta = advanceStreamingTextMotionCommit(firstDelta, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 150,
      streamId: "message-1",
      text: "AB",
    });

    expect(
      secondDelta.frames.map(({ generation, sourceStart, sourceEnd }) => ({
        generation,
        sourceStart,
        sourceEnd,
      })),
    ).toEqual([
      { generation: 1, sourceStart: 0, sourceEnd: 1 },
      { generation: 2, sourceStart: 1, sourceEnd: 2 },
    ]);

    const afterFirstDeadline = clearCompletedStreamingTextMotionSequence(secondDelta, 226);
    expect(afterFirstDeadline).toBe(secondDelta);
    expect(afterFirstDeadline.frames.map(({ generation }) => generation)).toEqual([1, 2]);

    const afterFinalDeadline = clearCompletedStreamingTextMotionSequence(secondDelta, 276);
    expect(afterFinalDeadline.frames).toHaveLength(0);
  });

  it("supersedes unfinished motion when a later delta completes its grapheme", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 0,
      streamId: "message-1",
      text: "",
    });
    const baseCharacter = advanceStreamingTextMotionCommit(hydrated, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "e",
    });
    const combinedCharacter = advanceStreamingTextMotionCommit(baseCharacter, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 120,
      streamId: "message-1",
      text: "e\u0301",
    });

    expect(
      combinedCharacter.frames.map(({ generation, graphemeCount, sourceStart, sourceEnd }) => ({
        generation,
        graphemeCount,
        sourceStart,
        sourceEnd,
      })),
    ).toEqual([{ generation: 2, graphemeCount: 1, sourceStart: 0, sourceEnd: 2 }]);
  });

  it("keeps the newest frame when rapid batches exceed the 512-grapheme active budget", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 0,
      streamId: "message-1",
      text: "",
    });
    const firstBatch = advanceStreamingTextMotionCommit(hydrated, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "a".repeat(400),
    });
    const secondBatch = advanceStreamingTextMotionCommit(firstBatch, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 101,
      streamId: "message-1",
      text: `${"a".repeat(400)}${"b".repeat(200)}`,
    });

    expect(
      secondBatch.frames.map(({ generation, sourceStart, sourceEnd }) => ({
        generation,
        sourceStart,
        sourceEnd,
      })),
    ).toEqual([{ generation: 2, sourceStart: 400, sourceEnd: 600 }]);
    expect(secondBatch.generation).toBe(2);
    expect(secondBatch.text).toBe(`${"a".repeat(400)}${"b".repeat(200)}`);
    expect(
      secondBatch.frames.reduce((total, frame) => total + frame.graphemeCount, 0),
    ).toBeLessThanOrEqual(512);
  });

  it("animates completed buffered initial text only when explicitly approved", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: false,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "Buffered",
    });
    const approved = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: false,
      isVisible: true,
      nowMs: 100,
      streamId: "message-2",
      text: "Buffered",
    });

    expect(hydrated.frames).toHaveLength(0);
    expect(approved.frames[0]).toMatchObject({
      graphemeCount: 8,
      sourceEnd: 8,
      sourceStart: 0,
    });
  });

  it("keeps one-grapheme initial batches slow while larger batches finish faster", () => {
    const oneGrapheme = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "A",
    });
    const manyGraphemes = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-2",
      text: "A".repeat(32),
    });

    expect(oneGrapheme.frames[0]?.durationMs).toBe(125);
    expect(manyGraphemes.frames[0]?.durationMs).toBeLessThan(125);
    expect(manyGraphemes.frames[0]?.revealDeadlineMs).toBeLessThan(
      oneGrapheme.frames[0]!.revealDeadlineMs,
    );
  });

  it("does not consume another generation when Strict Mode replays the same commit", () => {
    const first = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "A",
    });

    const replay = advanceStreamingTextMotionCommit(first, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 101,
      streamId: "message-1",
      text: "A",
    });

    expect(replay).toBe(first);
    expect(replay.generation).toBe(1);
  });

  it("samples elapsed append speed and applies EWMA to the next batch", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "A",
    });

    const appended = advanceStreamingTextMotionCommit(hydrated, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 200,
      streamId: "message-1",
      text: "ABCDEFGHI",
    });
    const smoothed = advanceStreamingTextMotionCommit(appended, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 300,
      streamId: "message-1",
      text: `ABCDEFGHI${"x".repeat(18)}`,
    });

    expect(appended.generation).toBe(1);
    expect(appended.frames.at(-1)?.smoothedRate).toBe(80);
    expect(appended.frames.at(-1)?.sourceStart).toBe(1);
    expect(smoothed.generation).toBe(2);
    expect(smoothed.frames.at(-1)?.smoothedRate).toBe(115);
  });

  it("clears and resets rate on replacement, completion, hiding, and stream changes", () => {
    const active = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "abc",
    });
    const replaced = advanceStreamingTextMotionCommit(active, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 200,
      streamId: "message-1",
      text: "abd",
    });
    const completed = advanceStreamingTextMotionCommit(active, {
      animateInitialStreamChunk: false,
      isStreaming: false,
      isVisible: true,
      nowMs: 200,
      streamId: "message-1",
      text: "abc",
    });
    const hidden = advanceStreamingTextMotionCommit(active, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: false,
      nowMs: 200,
      streamId: "message-1",
      text: "abcd",
    });
    const changedStream = advanceStreamingTextMotionCommit(active, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 200,
      streamId: "message-2",
      text: "historical",
    });

    for (const state of [replaced, completed, hidden, changedStream]) {
      expect(state.frames).toHaveLength(0);
      expect(state.smoothedRate).toBeUndefined();
    }
  });

  it("preserves active frames before their reveal deadline", () => {
    const active = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "abc",
    });

    expect(clearCompletedStreamingTextMotionSequence(active, 224)).toBe(active);
  });
});
