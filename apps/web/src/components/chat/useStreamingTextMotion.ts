import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  createStreamingTextMotionFrame,
  detectStreamingTextAppend,
  MAX_STREAMING_TEXT_MOTION_GRAPHEMES,
  type StreamingTextMotionFrame,
} from "./streamingTextMotion";

export interface UseStreamingTextMotionOptions {
  readonly text: string;
  readonly streamId: string | null | undefined;
  readonly isStreaming: boolean;
  readonly animateInitialStreamChunk: boolean;
}

export interface StreamingTextMotionCommitInput extends UseStreamingTextMotionOptions {
  readonly isVisible: boolean;
  readonly nowMs: number;
}

export interface StreamingTextMotionCommitState {
  readonly streamId: string | null;
  readonly text: string;
  readonly isStreaming: boolean;
  readonly isVisible: boolean;
  readonly generation: number;
  readonly smoothedRate: number | undefined;
  readonly committedAtMs: number;
  readonly frames: readonly StreamingTextMotionFrame[];
}

export interface StreamingTextMotionSnapshot {
  readonly frames: readonly StreamingTextMotionFrame[];
  readonly animationTimeMs: number;
}

const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const EMPTY_STREAMING_TEXT_MOTION_FRAMES: readonly StreamingTextMotionFrame[] = [];

export function advanceStreamingTextMotionCommit(
  previous: StreamingTextMotionCommitState | null,
  input: StreamingTextMotionCommitInput,
): StreamingTextMotionCommitState {
  const streamId = input.streamId ?? null;
  if (previous !== null && isRepeatedCommit(previous, input, streamId)) {
    return previous;
  }

  if (previous === null || previous.streamId !== streamId) {
    return startStreamingTextMotionCommit(input, streamId);
  }

  if (streamId === null || !input.isStreaming || !input.isVisible) {
    return resetStreamingTextMotionCommit(previous, input, streamId);
  }

  const append = detectStreamingTextAppend(previous.text, input.text);
  if (append === null) {
    return resetStreamingTextMotionCommit(previous, input, streamId);
  }

  const generation = previous.generation + 1;
  const result = createStreamingTextMotionFrame({
    append,
    elapsedMs: input.nowMs - previous.committedAtMs,
    generation,
    previousRate: previous.smoothedRate,
    startedAtMs: input.nowMs,
  });
  const activeFrames = clearCompletedStreamingTextMotionSequence(
    previous,
    input.nowMs,
  ).frames.filter((frame) => frame.sourceEnd <= append.sourceStart);
  return {
    streamId,
    text: input.text,
    isStreaming: input.isStreaming,
    isVisible: input.isVisible,
    generation,
    smoothedRate: result.smoothedRate,
    committedAtMs: input.nowMs,
    frames:
      result.frame === null
        ? activeFrames
        : appendStreamingTextMotionFrame(activeFrames, result.frame),
  };
}

export function clearCompletedStreamingTextMotionSequence(
  state: StreamingTextMotionCommitState,
  nowMs: number,
): StreamingTextMotionCommitState {
  // react-markdown keys equal custom tags by sibling order. Removing an older
  // frame while a newer one is active shifts those keys and remounts its fade.
  if (
    state.frames.length === 0 ||
    state.frames.some((frame) => nowMs < frame.startedAtMs + frame.revealDeadlineMs)
  ) {
    return state;
  }
  return { ...state, frames: EMPTY_STREAMING_TEXT_MOTION_FRAMES };
}

export function useStreamingTextMotion({
  text,
  streamId,
  isStreaming,
  animateInitialStreamChunk,
}: UseStreamingTextMotionOptions): StreamingTextMotionSnapshot {
  const [snapshot, setSnapshot] = useState<StreamingTextMotionSnapshot>({
    frames: EMPTY_STREAMING_TEXT_MOTION_FRAMES,
    animationTimeMs: 0,
  });
  const committedRef = useRef<StreamingTextMotionCommitState | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCleanupTimer = () => {
    if (cleanupTimerRef.current === null) return;
    clearTimeout(cleanupTimerRef.current);
    cleanupTimerRef.current = null;
  };

  const publishFrames = (state: StreamingTextMotionCommitState, animationTimeMs: number) => {
    setSnapshot((current) =>
      current.frames === state.frames ? current : { frames: state.frames, animationTimeMs },
    );
  };

  const scheduleCleanup = (state: StreamingTextMotionCommitState) => {
    clearCleanupTimer();
    const atMs = streamingTextMotionSequenceDeadline(state.frames);
    if (atMs === null) return;
    cleanupTimerRef.current = setTimeout(
      () => {
        const committed = committedRef.current;
        if (committed === null) return;
        const nowMs = readNowMs();
        const next = clearCompletedStreamingTextMotionSequence(committed, nowMs);
        committedRef.current = next;
        cleanupTimerRef.current = null;
        publishFrames(next, nowMs);
        scheduleCleanup(next);
      },
      Math.max(1, atMs - readNowMs()),
    );
  };

  useCommitEffect(() => {
    const nowMs = readNowMs();
    const next = advanceStreamingTextMotionCommit(committedRef.current, {
      text,
      streamId,
      isStreaming,
      animateInitialStreamChunk,
      isVisible: isDocumentVisible(),
      nowMs,
    });
    committedRef.current = next;
    publishFrames(next, nowMs);
    scheduleCleanup(next);

    return clearCleanupTimer;
  }, [animateInitialStreamChunk, isStreaming, streamId, text]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      const committed = committedRef.current;
      if (committed === null) return;

      const next = advanceStreamingTextMotionCommit(committed, {
        text: committed.text,
        streamId: committed.streamId,
        isStreaming: committed.isStreaming,
        animateInitialStreamChunk: false,
        isVisible: isDocumentVisible(),
        nowMs: readNowMs(),
      });
      committedRef.current = next;
      clearCleanupTimer();
      publishFrames(next, readNowMs());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return snapshot;
}

function startStreamingTextMotionCommit(
  input: StreamingTextMotionCommitInput,
  streamId: string | null,
): StreamingTextMotionCommitState {
  const canAnimate =
    streamId !== null && input.isStreaming && input.isVisible && input.animateInitialStreamChunk;
  const append = canAnimate ? detectStreamingTextAppend("", input.text) : null;
  const generation = append === null ? 0 : 1;
  const result =
    append === null
      ? null
      : createStreamingTextMotionFrame({
          append,
          elapsedMs: null,
          generation,
          previousRate: undefined,
          startedAtMs: input.nowMs,
        });

  return {
    streamId,
    text: input.text,
    isStreaming: input.isStreaming,
    isVisible: input.isVisible,
    generation,
    smoothedRate: result?.smoothedRate,
    committedAtMs: input.nowMs,
    frames: result?.frame ? [result.frame] : EMPTY_STREAMING_TEXT_MOTION_FRAMES,
  };
}

function resetStreamingTextMotionCommit(
  previous: StreamingTextMotionCommitState,
  input: StreamingTextMotionCommitInput,
  streamId: string | null,
): StreamingTextMotionCommitState {
  return {
    streamId,
    text: input.text,
    isStreaming: input.isStreaming,
    isVisible: input.isVisible,
    generation: previous.generation,
    smoothedRate: undefined,
    committedAtMs: input.nowMs,
    frames: EMPTY_STREAMING_TEXT_MOTION_FRAMES,
  };
}

function appendStreamingTextMotionFrame(
  frames: readonly StreamingTextMotionFrame[],
  nextFrame: StreamingTextMotionFrame,
): readonly StreamingTextMotionFrame[] {
  const activeGraphemeCount = frames.reduce(
    (total, frame) => total + frame.graphemeCount,
    nextFrame.graphemeCount,
  );
  if (activeGraphemeCount > MAX_STREAMING_TEXT_MOTION_GRAPHEMES) {
    return frames;
  }
  return [...frames, nextFrame];
}

function streamingTextMotionSequenceDeadline(
  frames: readonly StreamingTextMotionFrame[],
): number | null {
  let deadline: number | null = null;
  for (const frame of frames) {
    const frameDeadline = frame.startedAtMs + frame.revealDeadlineMs;
    deadline = deadline === null ? frameDeadline : Math.max(deadline, frameDeadline);
  }
  return deadline;
}

function isRepeatedCommit(
  previous: StreamingTextMotionCommitState,
  input: StreamingTextMotionCommitInput,
  streamId: string | null,
): boolean {
  return (
    previous.streamId === streamId &&
    previous.text === input.text &&
    previous.isStreaming === input.isStreaming &&
    previous.isVisible === input.isVisible
  );
}

function readNowMs(): number {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
