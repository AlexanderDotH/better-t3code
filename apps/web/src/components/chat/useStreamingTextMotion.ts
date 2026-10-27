import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  createStreamingTextMotionFrame,
  detectStreamingTextAppend,
  MAX_STREAMING_TEXT_MOTION_GRAPHEMES,
  type StreamingTextMotionFrame,
} from "./streamingTextMotion";

export interface UseStreamingTextMotionOptions {
  readonly enabled?: boolean;
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
  readonly enabled: boolean;
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

  if (input.enabled === false || streamId === null || !input.isVisible) {
    return resetStreamingTextMotionCommit(previous, input, streamId);
  }
  if (!previous.isStreaming && input.animateInitialStreamChunk && previous.text !== input.text) {
    return startStreamingTextMotionCommit(input, streamId);
  }
  if (!input.isStreaming && !previous.isStreaming) {
    return resetStreamingTextMotionCommit(previous, input, streamId);
  }

  const append = detectStreamingTextAppend(previous.text, input.text);
  if (append === null) {
    if (previous.text === input.text && !input.isStreaming) {
      // Completion can arrive before the last CSS reveal finishes.
      return {
        ...clearCompletedStreamingTextMotionSequence(previous, input.nowMs),
        isStreaming: false,
        smoothedRate: undefined,
      };
    }
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
    enabled: true,
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
  enabled = true,
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

  const publishFrames = useCallback(
    (state: StreamingTextMotionCommitState, animationTimeMs: number) => {
      const nextSnapshot = { frames: state.frames, animationTimeMs };
      // Publish in the text commit's layout effect so appended text cannot paint
      // fully visible before its reveal animation is attached.
      setSnapshot((current) => (current.frames === state.frames ? current : nextSnapshot));
    },
    [],
  );

  useCommitEffect(() => {
    const nowMs = readNowMs();
    const next = advanceStreamingTextMotionCommit(committedRef.current, {
      enabled,
      text,
      streamId,
      isStreaming,
      animateInitialStreamChunk,
      isVisible: canAnimateStreamingMotion(),
      nowMs,
    });
    committedRef.current = next;
    publishFrames(next, nowMs);
  }, [enabled, animateInitialStreamChunk, isStreaming, streamId, text, publishFrames]);

  useEffect(() => {
    if (isStreaming || snapshot.frames.length === 0) return;
    const frames = snapshot.frames;
    const deadlineMs = Math.max(
      ...frames.map((frame) => frame.startedAtMs + frame.revealDeadlineMs),
    );
    const timeout = setTimeout(
      () => {
        const committed = committedRef.current;
        if (committed === null || committed.isStreaming || committed.frames !== frames) return;
        const next = clearCompletedStreamingTextMotionSequence(
          committed,
          Math.max(readNowMs(), deadlineMs),
        );
        committedRef.current = next;
        publishFrames(next, readNowMs());
      },
      Math.max(0, Math.ceil(deadlineMs - readNowMs())),
    );
    return () => clearTimeout(timeout);
  }, [isStreaming, snapshot.frames, publishFrames]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      const committed = committedRef.current;
      if (committed === null) return;

      const next = advanceStreamingTextMotionCommit(committed, {
        enabled: committed.enabled,
        text: committed.text,
        streamId: committed.streamId,
        isStreaming: committed.isStreaming,
        animateInitialStreamChunk: false,
        isVisible: canAnimateStreamingMotion(),
        nowMs: readNowMs(),
      });
      committedRef.current = next;
      publishFrames(next, readNowMs());
    };

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reducedMotion?.addEventListener?.("change", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotion?.removeEventListener?.("change", handleVisibilityChange);
    };
  }, [publishFrames]);

  return snapshot;
}

function startStreamingTextMotionCommit(
  input: StreamingTextMotionCommitInput,
  streamId: string | null,
): StreamingTextMotionCommitState {
  const canAnimate =
    input.enabled !== false &&
    streamId !== null &&
    input.isVisible &&
    input.animateInitialStreamChunk;
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
    enabled: input.enabled !== false,
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
    enabled: input.enabled !== false,
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
    return [nextFrame];
  }
  return [...frames, nextFrame];
}

function isRepeatedCommit(
  previous: StreamingTextMotionCommitState,
  input: StreamingTextMotionCommitInput,
  streamId: string | null,
): boolean {
  return (
    previous.enabled === (input.enabled !== false) &&
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

function canAnimateStreamingMotion(): boolean {
  return (
    (typeof document === "undefined" || document.visibilityState !== "hidden") &&
    (typeof window === "undefined" ||
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}
