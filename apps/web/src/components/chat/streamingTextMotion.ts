export const MAX_STREAMING_TEXT_MOTION_GRAPHEMES = 160;
export const STREAMING_TEXT_MOTION_EWMA_FACTOR = 0.35;

const SLOW_RATE_GRAPHEMES_PER_SECOND = 20;
const FAST_RATE_GRAPHEMES_PER_SECOND = 180;
const SLOW_DURATION_MS = 125;
const FAST_DURATION_MS = 65;
const SLOW_STAGGER_WINDOW_MS = 35;
const FAST_STAGGER_WINDOW_MS = 6;

let cachedSegmenter: Intl.Segmenter | null = null;
let cachedSegmenterConstructor: typeof Intl.Segmenter | undefined;

export interface StreamingTextGrapheme {
  readonly text: string;
  readonly index: number;
  readonly sourceOffset: number;
}

export interface StreamingTextAppend {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly text: string;
  readonly graphemes: readonly StreamingTextGrapheme[];
}

export interface StreamingTextMotionTiming {
  readonly durationMs: number;
  readonly staggerWindowMs: number;
  readonly staggerStepMs: number;
  readonly revealDeadlineMs: number;
}

export interface StreamingTextMotionFrame extends StreamingTextMotionTiming {
  readonly generation: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly graphemeCount: number;
  readonly smoothedRate: number;
}

export interface StreamingTextMotionFrameResult {
  readonly frame: StreamingTextMotionFrame | null;
  readonly smoothedRate: number;
}

export interface RenderedStreamingTextSuffix {
  readonly renderedStart: number;
  readonly sourceStart: number;
  readonly text: string;
  readonly graphemes: readonly StreamingTextGrapheme[];
}

interface CreateStreamingTextMotionFrameInput {
  readonly append: StreamingTextAppend;
  readonly elapsedMs: number | null;
  readonly generation: number;
  readonly previousRate: number | undefined;
}

interface MapSourceAppendInput {
  readonly frame: StreamingTextMotionFrame;
  readonly source: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly renderedText: string;
}

export function segmentStreamingTextGraphemes(
  text: string,
  sourceOffset = 0,
): readonly StreamingTextGrapheme[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter === null) {
    return segmentCodePoints(text, sourceOffset);
  }

  return Array.from(segmenter.segment(text), ({ segment, index }, graphemeIndex) => ({
    text: segment,
    index: graphemeIndex,
    sourceOffset: sourceOffset + index,
  }));
}

function getGraphemeSegmenter(): Intl.Segmenter | null {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter !== "function") {
    cachedSegmenter = null;
    cachedSegmenterConstructor = undefined;
    return null;
  }
  if (cachedSegmenter === null || cachedSegmenterConstructor !== Segmenter) {
    cachedSegmenter = new Segmenter(undefined, { granularity: "grapheme" });
    cachedSegmenterConstructor = Segmenter;
  }
  return cachedSegmenter;
}

export function detectStreamingTextAppend(
  previousText: string,
  nextText: string,
): StreamingTextAppend | null {
  if (nextText.length <= previousText.length || !nextText.startsWith(previousText)) {
    return null;
  }

  const sourceStart = previousText.length;
  const text = nextText.slice(sourceStart);
  return {
    sourceStart,
    sourceEnd: nextText.length,
    text,
    graphemes: segmentStreamingTextGraphemes(text, sourceStart),
  };
}

export function smoothStreamingTextRate(
  previousRate: number | undefined,
  observedRate: number,
): number {
  if (previousRate === undefined || !Number.isFinite(previousRate)) {
    return observedRate;
  }
  return (
    previousRate * (1 - STREAMING_TEXT_MOTION_EWMA_FACTOR) +
    observedRate * STREAMING_TEXT_MOTION_EWMA_FACTOR
  );
}

export function calculateStreamingTextMotionTiming(
  graphemesPerSecond: number,
  graphemeCount: number,
): StreamingTextMotionTiming {
  const progress = timingProgress(graphemesPerSecond);
  const durationMs = interpolate(SLOW_DURATION_MS, FAST_DURATION_MS, progress);
  const staggerWindowMs = interpolate(SLOW_STAGGER_WINDOW_MS, FAST_STAGGER_WINDOW_MS, progress);
  const staggerStepMs = graphemeCount > 1 ? staggerWindowMs / (graphemeCount - 1) : 0;
  const lastDelayMs = graphemeCount > 1 ? staggerWindowMs : 0;

  return {
    durationMs,
    staggerWindowMs,
    staggerStepMs,
    revealDeadlineMs: Math.min(160, durationMs + lastDelayMs),
  };
}

export function createStreamingTextMotionFrame({
  append,
  elapsedMs,
  generation,
  previousRate,
}: CreateStreamingTextMotionFrameInput): StreamingTextMotionFrameResult {
  const observedRate = observeStreamingTextRate(append.graphemes.length, elapsedMs, previousRate);
  const smoothedRate = smoothStreamingTextRate(previousRate, observedRate);
  if (append.graphemes.length > MAX_STREAMING_TEXT_MOTION_GRAPHEMES) {
    return { frame: null, smoothedRate };
  }

  return {
    frame: {
      ...calculateStreamingTextMotionTiming(smoothedRate, append.graphemes.length),
      generation,
      sourceStart: append.sourceStart,
      sourceEnd: append.sourceEnd,
      graphemeCount: append.graphemes.length,
      smoothedRate,
    },
    smoothedRate,
  };
}

export function getStreamingTextMotionDelayMs(
  frame: StreamingTextMotionFrame,
  graphemeIndex: number,
): number {
  const lastIndex = Math.max(0, frame.graphemeCount - 1);
  const boundedIndex = Math.max(0, Math.min(lastIndex, graphemeIndex));
  return boundedIndex * frame.staggerStepMs;
}

export function mapSourceAppendToRenderedSuffix({
  frame,
  source,
  sourceStart,
  sourceEnd,
  renderedText,
}: MapSourceAppendInput): RenderedStreamingTextSuffix | null {
  if (!isValidSourceRange(source, sourceStart, sourceEnd)) {
    return null;
  }

  const appendedSourceStart = Math.max(sourceStart, frame.sourceStart);
  const appendedSourceEnd = Math.min(sourceEnd, frame.sourceEnd);
  if (appendedSourceStart >= appendedSourceEnd) {
    return null;
  }

  const appendedSource = source.slice(appendedSourceStart, appendedSourceEnd);
  const renderedSuffix = longestRenderedSuffixPrefix(renderedText, appendedSource);
  if (renderedSuffix === null) {
    return null;
  }
  const renderedStart = renderedText.length - renderedSuffix.length;
  const sourceBeforeAppend = source.slice(sourceStart, appendedSourceStart);
  if (
    sourceBeforeAppend.length > 0 &&
    renderedText.slice(0, renderedStart) !== sourceBeforeAppend
  ) {
    return null;
  }
  const batchIndexOffset = segmentStreamingTextGraphemes(
    source.slice(frame.sourceStart, appendedSourceStart),
  ).length;

  return {
    renderedStart,
    sourceStart: appendedSourceStart,
    text: renderedSuffix,
    graphemes: segmentStreamingTextGraphemes(renderedSuffix, appendedSourceStart).map(
      (grapheme) => ({ ...grapheme, index: batchIndexOffset + grapheme.index }),
    ),
  };
}

function segmentCodePoints(text: string, sourceOffset: number): readonly StreamingTextGrapheme[] {
  const graphemes: StreamingTextGrapheme[] = [];
  let utf16Offset = 0;
  for (const codePoint of Array.from(text)) {
    graphemes.push({
      text: codePoint,
      index: graphemes.length,
      sourceOffset: sourceOffset + utf16Offset,
    });
    utf16Offset += codePoint.length;
  }
  return graphemes;
}

function timingProgress(graphemesPerSecond: number): number {
  const finiteRate = Number.isFinite(graphemesPerSecond)
    ? graphemesPerSecond
    : FAST_RATE_GRAPHEMES_PER_SECOND;
  return Math.max(
    0,
    Math.min(
      1,
      (finiteRate - SLOW_RATE_GRAPHEMES_PER_SECOND) /
        (FAST_RATE_GRAPHEMES_PER_SECOND - SLOW_RATE_GRAPHEMES_PER_SECOND),
    ),
  );
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function observeStreamingTextRate(
  graphemeCount: number,
  elapsedMs: number | null,
  previousRate: number | undefined,
): number {
  if (elapsedMs !== null && Number.isFinite(elapsedMs) && elapsedMs > 0) {
    return (graphemeCount * 1_000) / elapsedMs;
  }
  return previousRate ?? SLOW_RATE_GRAPHEMES_PER_SECOND;
}

function isValidSourceRange(source: string, start: number, end: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= source.length
  );
}

function longestRenderedSuffixPrefix(renderedText: string, appendedSource: string): string | null {
  const graphemes = segmentStreamingTextGraphemes(appendedSource);
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index];
    if (grapheme === undefined) continue;
    const prefixEnd = grapheme.sourceOffset + grapheme.text.length;
    const prefix = appendedSource.slice(0, prefixEnd);
    if (renderedText.endsWith(prefix)) return prefix;
  }
  return null;
}
