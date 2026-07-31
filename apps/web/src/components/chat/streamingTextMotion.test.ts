import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  calculateStreamingTextMotionTiming,
  createStreamingTextMotionFrame,
  detectStreamingTextAppend,
  getStreamingTextMotionDelayMs,
  mapSourceAppendToRenderedSuffix,
  segmentStreamingTextGraphemes,
  smoothStreamingTextRate,
} from "./streamingTextMotion";
import {
  advanceStreamingTextMotionCommit,
  clearStreamingTextMotionFrame,
} from "./useStreamingTextMotion";

const nativeSegmenter = Intl.Segmenter;

afterEach(() => {
  Object.defineProperty(Intl, "Segmenter", {
    configurable: true,
    value: nativeSegmenter,
    writable: true,
  });
});

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

  it("does not create wrappers for updates larger than 160 graphemes", () => {
    const append = detectStreamingTextAppend("", "x".repeat(161));

    expect(append).not.toBeNull();
    expect(
      createStreamingTextMotionFrame({
        append: append!,
        elapsedMs: 100,
        generation: 1,
        previousRate: undefined,
      }),
    ).toEqual({ frame: null, smoothedRate: 1_610 });
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
});

describe("Markdown source reconciliation", () => {
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
  it("treats the first render as hydration unless the caller marks a new live row", () => {
    const hydrated = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: false,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "Already here",
    });
    const newlyInserted = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-2",
      text: "New",
    });

    expect(hydrated.frame).toBeNull();
    expect(newlyInserted.frame?.sourceStart).toBe(0);
    expect(newlyInserted.frame?.graphemeCount).toBe(3);
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

  it("samples append speed from committed updates and advances the generation", () => {
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

    expect(appended.generation).toBe(1);
    expect(appended.frame?.smoothedRate).toBe(80);
    expect(appended.frame?.sourceStart).toBe(1);
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
      expect(state.frame).toBeNull();
      expect(state.smoothedRate).toBeUndefined();
    }
  });

  it("clears only the matching active generation after its deadline", () => {
    const active = advanceStreamingTextMotionCommit(null, {
      animateInitialStreamChunk: true,
      isStreaming: true,
      isVisible: true,
      nowMs: 100,
      streamId: "message-1",
      text: "abc",
    });

    expect(clearStreamingTextMotionFrame(active, active.frame!.generation).frame).toBeNull();
    expect(clearStreamingTextMotionFrame(active, active.frame!.generation + 1)).toBe(active);
  });
});
