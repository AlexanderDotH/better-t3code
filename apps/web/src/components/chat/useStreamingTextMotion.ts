import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  createStreamingTextMotionFrame,
  detectStreamingTextAppend,
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
  readonly frame: StreamingTextMotionFrame | null;
}

interface FrameDeadline {
  readonly frame: StreamingTextMotionFrame;
  readonly atMs: number;
}

const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
  });
  return {
    streamId,
    text: input.text,
    isStreaming: input.isStreaming,
    isVisible: input.isVisible,
    generation,
    smoothedRate: result.smoothedRate,
    committedAtMs: input.nowMs,
    frame: result.frame,
  };
}

export function clearStreamingTextMotionFrame(
  state: StreamingTextMotionCommitState,
  generation: number,
): StreamingTextMotionCommitState {
  if (state.frame?.generation !== generation) {
    return state;
  }
  return { ...state, frame: null };
}

export function useStreamingTextMotion({
  text,
  streamId,
  isStreaming,
  animateInitialStreamChunk,
}: UseStreamingTextMotionOptions): StreamingTextMotionFrame | null {
  const [frame, setFrame] = useState<StreamingTextMotionFrame | null>(null);
  const committedRef = useRef<StreamingTextMotionCommitState | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<FrameDeadline | null>(null);

  const clearCleanupTimer = () => {
    if (cleanupTimerRef.current === null) return;
    clearTimeout(cleanupTimerRef.current);
    cleanupTimerRef.current = null;
  };

  const scheduleCleanup = (nextFrame: StreamingTextMotionFrame, nowMs: number) => {
    clearCleanupTimer();
    const existingDeadline = deadlineRef.current;
    const atMs =
      existingDeadline?.frame === nextFrame
        ? existingDeadline.atMs
        : nowMs + nextFrame.revealDeadlineMs;
    deadlineRef.current = { frame: nextFrame, atMs };
    cleanupTimerRef.current = setTimeout(
      () => {
        const committed = committedRef.current;
        if (deadlineRef.current?.frame !== nextFrame || committed?.frame !== nextFrame) return;
        committedRef.current = clearStreamingTextMotionFrame(committed, nextFrame.generation);
        deadlineRef.current = null;
        cleanupTimerRef.current = null;
        setFrame((current) => (current === nextFrame ? null : current));
      },
      Math.max(0, atMs - readNowMs()),
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
    setFrame((current) => (current === next.frame ? current : next.frame));

    if (next.frame === null) {
      clearCleanupTimer();
      deadlineRef.current = null;
    } else {
      scheduleCleanup(next.frame, nowMs);
    }

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
      deadlineRef.current = null;
      setFrame(null);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return frame;
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
        });

  return {
    streamId,
    text: input.text,
    isStreaming: input.isStreaming,
    isVisible: input.isVisible,
    generation,
    smoothedRate: result?.smoothedRate,
    committedAtMs: input.nowMs,
    frame: result?.frame ?? null,
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
    frame: null,
  };
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
