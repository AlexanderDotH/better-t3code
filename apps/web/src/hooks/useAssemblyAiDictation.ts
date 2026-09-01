import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  startAssemblyAiStreamingTranscription,
  type StartAssemblyAiStreamingTranscriptionInput,
  type AssemblyAiStreamingSession,
} from "../lib/assemblyAiStreamingTranscription";

export type AssemblyAiDictationState = "idle" | "starting" | "recording" | "stopping";

export interface AssemblyAiDictationDraftSnapshot {
  readonly text: string;
  readonly cursor: number;
}

export interface AssemblyAiDictationNotice {
  readonly title: string;
  readonly error: Error;
}

export function shouldCancelAssemblyAiDictation(
  configured: boolean,
  state: AssemblyAiDictationState,
): boolean {
  return !configured && state !== "idle";
}

type StartTransport = typeof startAssemblyAiStreamingTranscription;
type TransformTranscript = (transcript: string) => Promise<string>;
const AUDIO_WAVEFORM_SAMPLE_COUNT = 14;
const EMPTY_AUDIO_WAVEFORM = Object.freeze(
  Array.from({ length: AUDIO_WAVEFORM_SAMPLE_COUNT }, () => 0),
);

export function renderAssemblyAiDictationDraft(original: string, transcript: string): string {
  if (transcript.length === 0) return original;
  const separator = original.length === 0 || /\s$/u.test(original) ? "" : " ";
  return `${original}${separator}${transcript}`;
}

export async function resolveAssemblyAiDictationTranscript(
  transcript: string,
  transformTranscript?: TransformTranscript,
): Promise<{ readonly text: string; readonly error: Error | null }> {
  if (!transformTranscript || transcript.length === 0) {
    return { text: transcript, error: null };
  }
  try {
    return { text: await transformTranscript(transcript), error: null };
  } catch (error) {
    return {
      text: transcript,
      error: error instanceof Error ? error : new Error("Voice input translation failed."),
    };
  }
}

export function useAssemblyAiDictation(input: {
  readonly configured: boolean;
  readonly lifecycleKey: string;
  readonly getDraftSnapshot: () => AssemblyAiDictationDraftSnapshot;
  readonly applyDraftSnapshot: (snapshot: AssemblyAiDictationDraftSnapshot) => void;
  readonly onNotice: (notice: AssemblyAiDictationNotice) => void;
  readonly transformTranscript?: TransformTranscript;
  readonly createToken?: StartAssemblyAiStreamingTranscriptionInput["createToken"];
  readonly startTransport?: StartTransport;
}) {
  const [state, setState] = useState<AssemblyAiDictationState>("idle");
  const [audioWaveform, setAudioWaveform] = useState<ReadonlyArray<number>>(EMPTY_AUDIO_WAVEFORM);
  const stateRef = useRef<AssemblyAiDictationState>("idle");
  const attemptRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AssemblyAiStreamingSession | null>(null);
  const originalDraftRef = useRef<AssemblyAiDictationDraftSnapshot | null>(null);
  const latestTranscriptRef = useRef("");
  const mountedRef = useRef(true);
  const getDraftSnapshotRef = useRef(input.getDraftSnapshot);
  const applyDraftSnapshotRef = useRef(input.applyDraftSnapshot);
  const onNoticeRef = useRef(input.onNotice);
  const startTransportRef = useRef(input.startTransport ?? startAssemblyAiStreamingTranscription);
  const createTokenRef = useRef(input.createToken);
  const transformTranscriptRef = useRef(input.transformTranscript);

  getDraftSnapshotRef.current = input.getDraftSnapshot;
  applyDraftSnapshotRef.current = input.applyDraftSnapshot;
  onNoticeRef.current = input.onNotice;
  startTransportRef.current = input.startTransport ?? startAssemblyAiStreamingTranscription;
  createTokenRef.current = input.createToken;
  transformTranscriptRef.current = input.transformTranscript;

  const transition = useCallback((next: AssemblyAiDictationState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const resetAudioWaveform = useCallback(() => {
    if (mountedRef.current) setAudioWaveform(EMPTY_AUDIO_WAVEFORM);
  }, []);

  const clearAttempt = useCallback(() => {
    abortControllerRef.current = null;
    sessionRef.current = null;
    originalDraftRef.current = null;
    latestTranscriptRef.current = "";
  }, []);

  const terminatePreservingDraft = useCallback(() => {
    attemptRef.current += 1;
    abortControllerRef.current?.abort();
    sessionRef.current?.cancel();
    clearAttempt();
    stateRef.current = "idle";
  }, [clearAttempt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      terminatePreservingDraft();
    };
  }, [terminatePreservingDraft]);

  useLayoutEffect(() => {
    transition("idle");
    return () => terminatePreservingDraft();
  }, [input.lifecycleKey, terminatePreservingDraft, transition]);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!input.configured) {
      onNoticeRef.current({
        title: "Voice input is not configured",
        error: new Error("Add an AssemblyAI API key in Settings → Connections → Voice input."),
      });
      return;
    }

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const originalDraft = getDraftSnapshotRef.current();
    originalDraftRef.current = originalDraft;
    latestTranscriptRef.current = "";
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    resetAudioWaveform();
    transition("starting");

    try {
      const session = await startTransportRef.current({
        signal: abortController.signal,
        ...(createTokenRef.current ? { createToken: createTokenRef.current } : {}),
        onTranscript: ({ text }) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          latestTranscriptRef.current = text;
          const nextText = renderAssemblyAiDictationDraft(originalDraft.text, text);
          applyDraftSnapshotRef.current({ text: nextText, cursor: nextText.length });
        },
        onAudioLevel: (level) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          const nextLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
          if (mountedRef.current) {
            setAudioWaveform((current) => [...current.slice(1), nextLevel]);
          }
        },
        onError: (error) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          attemptRef.current += 1;
          sessionRef.current?.cancel();
          clearAttempt();
          resetAudioWaveform();
          transition("idle");
          onNoticeRef.current({ title: "Voice input failed", error });
        },
      });

      if (attemptRef.current !== attempt || abortController.signal.aborted) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      transition("recording");
    } catch (error) {
      if (attemptRef.current !== attempt || abortController.signal.aborted) return;
      clearAttempt();
      resetAudioWaveform();
      transition("idle");
      onNoticeRef.current({
        title: "Could not start voice input",
        error: error instanceof Error ? error : new Error("Voice input setup failed."),
      });
    }
  }, [clearAttempt, input.configured, resetAudioWaveform, transition]);

  const stop = useCallback(async () => {
    if (stateRef.current === "idle" || stateRef.current === "stopping") return;
    const session = sessionRef.current;
    if (!session) {
      attemptRef.current += 1;
      abortControllerRef.current?.abort();
      clearAttempt();
      resetAudioWaveform();
      transition("idle");
      return;
    }

    const attempt = attemptRef.current;
    const originalDraft = originalDraftRef.current;
    transition("stopping");
    try {
      await session.stop();
    } catch (error) {
      onNoticeRef.current({
        title: "Could not stop voice input cleanly",
        error: error instanceof Error ? error : new Error("AssemblyAI streaming stop failed."),
      });
    }

    if (attemptRef.current === attempt && originalDraft) {
      const transformed = await resolveAssemblyAiDictationTranscript(
        latestTranscriptRef.current,
        transformTranscriptRef.current,
      );
      if (attemptRef.current === attempt) {
        const nextText = renderAssemblyAiDictationDraft(originalDraft.text, transformed.text);
        applyDraftSnapshotRef.current({ text: nextText, cursor: nextText.length });
        if (transformed.error) {
          onNoticeRef.current({
            title: "Could not translate voice input",
            error: transformed.error,
          });
        }
      }
    }

    if (attemptRef.current === attempt) attemptRef.current += 1;
    clearAttempt();
    resetAudioWaveform();
    transition("idle");
  }, [clearAttempt, resetAudioWaveform, transition]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") return;
    const originalDraft = originalDraftRef.current;
    attemptRef.current += 1;
    abortControllerRef.current?.abort();
    sessionRef.current?.cancel();
    clearAttempt();
    if (originalDraft) applyDraftSnapshotRef.current(originalDraft);
    resetAudioWaveform();
    transition("idle");
  }, [clearAttempt, resetAudioWaveform, transition]);

  useEffect(() => {
    if (shouldCancelAssemblyAiDictation(input.configured, stateRef.current)) cancel();
  }, [cancel, input.configured]);

  useEffect(() => {
    if (state === "idle") return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [cancel, state]);

  return {
    state,
    active: state !== "idle",
    audioWaveform,
    start,
    stop,
    cancel,
  } as const;
}
