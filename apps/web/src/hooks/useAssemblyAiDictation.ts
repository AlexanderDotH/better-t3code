import { renderAssemblyAiDictationDraft } from "@t3tools/client-runtime/assembly-ai";
import type { VoiceFileReference } from "@t3tools/contracts";
export { renderAssemblyAiDictationDraft } from "@t3tools/client-runtime/assembly-ai";
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
  readonly references?: ReadonlyArray<VoiceFileReference>;
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
interface ProcessedTranscript {
  readonly text: string;
  readonly references?: ReadonlyArray<VoiceFileReference>;
  readonly warning?: string;
}
type TransformTranscript = (transcript: string) => Promise<string | ProcessedTranscript>;
const DICTATION_PROCESSING_TIMEOUT_MS = 65_000;
const AUDIO_WAVEFORM_SAMPLE_COUNT = 14;
const EMPTY_AUDIO_WAVEFORM = Object.freeze(
  Array.from({ length: AUDIO_WAVEFORM_SAMPLE_COUNT }, () => 0),
);

export async function resolveAssemblyAiDictationTranscript(
  transcript: string,
  transformTranscript?: TransformTranscript,
): Promise<ProcessedTranscript & { readonly error: Error | null }> {
  if (!transformTranscript || transcript.length === 0) {
    return { text: transcript, error: null };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const transformed = await Promise.race([
      transformTranscript(transcript),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Voice input processing timed out. The original was kept.")),
          DICTATION_PROCESSING_TIMEOUT_MS,
        );
      }),
    ]);
    return {
      ...(typeof transformed === "string" ? { text: transformed } : transformed),
      error: null,
    };
  } catch (error) {
    return {
      text: transcript,
      error: error instanceof Error ? error : new Error("Voice input processing failed."),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function useAssemblyAiDictation(input: {
  readonly configured: boolean;
  readonly lifecycleKey: string;
  readonly draftText: string;
  readonly getDraftSnapshot: () => AssemblyAiDictationDraftSnapshot;
  readonly applyDraftSnapshot: (snapshot: AssemblyAiDictationDraftSnapshot) => void;
  readonly onNotice: (notice: AssemblyAiDictationNotice) => void;
  readonly transformTranscript?: TransformTranscript;
  readonly createToken?: StartAssemblyAiStreamingTranscriptionInput["createToken"];
  readonly startTransport?: StartTransport;
}) {
  const [state, setState] = useState<AssemblyAiDictationState>("idle");
  const [audioWaveform, setAudioWaveform] = useState<ReadonlyArray<number>>(EMPTY_AUDIO_WAVEFORM);
  const [restorableDraft, setRestorableDraft] = useState<{
    original: AssemblyAiDictationDraftSnapshot;
    processedText: string;
    lifecycleKey: string;
  } | null>(null);
  const stateRef = useRef<AssemblyAiDictationState>("idle");
  const attemptRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AssemblyAiStreamingSession | null>(null);
  const originalDraftRef = useRef<AssemblyAiDictationDraftSnapshot | null>(null);
  const latestTranscriptRef = useRef("");
  const expectedDraftTextRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const getDraftSnapshotRef = useRef(input.getDraftSnapshot);
  const applyDraftSnapshotRef = useRef(input.applyDraftSnapshot);
  const onNoticeRef = useRef(input.onNotice);
  const startTransportRef = useRef(input.startTransport ?? startAssemblyAiStreamingTranscription);
  const createTokenRef = useRef(input.createToken);
  const transformTranscriptRef = useRef(input.transformTranscript);

  useLayoutEffect(() => {
    getDraftSnapshotRef.current = input.getDraftSnapshot;
    applyDraftSnapshotRef.current = input.applyDraftSnapshot;
    onNoticeRef.current = input.onNotice;
    startTransportRef.current = input.startTransport ?? startAssemblyAiStreamingTranscription;
    createTokenRef.current = input.createToken;
    transformTranscriptRef.current = input.transformTranscript;
  });

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
    expectedDraftTextRef.current = null;
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

  useLayoutEffect(() => {
    if (stateRef.current !== "idle" && input.draftText !== expectedDraftTextRef.current) {
      terminatePreservingDraft();
      resetAudioWaveform();
      transition("idle");
    }
  }, [input.draftText, resetAudioWaveform, terminatePreservingDraft, transition]);

  const applySnapshot = useCallback((snapshot: AssemblyAiDictationDraftSnapshot) => {
    expectedDraftTextRef.current = snapshot.text;
    applyDraftSnapshotRef.current(snapshot);
  }, []);

  const draftUnchanged = useCallback(
    () => getDraftSnapshotRef.current().text === expectedDraftTextRef.current,
    [],
  );

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!input.configured) {
      onNoticeRef.current({
        title: "Voice input is not configured",
        error: new Error("Add an AssemblyAI API key in Settings → Better T3 → Voice."),
      });
      return;
    }

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const originalDraft = getDraftSnapshotRef.current();
    setRestorableDraft(null);
    originalDraftRef.current = originalDraft;
    expectedDraftTextRef.current = originalDraft.text;
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
          if (!draftUnchanged()) {
            terminatePreservingDraft();
            resetAudioWaveform();
            transition("idle");
            return;
          }
          latestTranscriptRef.current = text;
          const nextText = renderAssemblyAiDictationDraft(originalDraft.text, text);
          applySnapshot({ ...originalDraft, text: nextText, cursor: nextText.length });
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
  }, [
    applySnapshot,
    clearAttempt,
    draftUnchanged,
    input.configured,
    resetAudioWaveform,
    terminatePreservingDraft,
    transition,
  ]);

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
      if (attemptRef.current === attempt) {
        onNoticeRef.current({
          title: "Could not stop voice input cleanly",
          error: error instanceof Error ? error : new Error("AssemblyAI streaming stop failed."),
        });
      }
    }

    if (attemptRef.current === attempt && originalDraft && draftUnchanged()) {
      const originalText = renderAssemblyAiDictationDraft(
        originalDraft.text,
        latestTranscriptRef.current,
      );
      const transformed = await resolveAssemblyAiDictationTranscript(
        latestTranscriptRef.current,
        transformTranscriptRef.current,
      );
      if (attemptRef.current === attempt && draftUnchanged()) {
        const nextText = renderAssemblyAiDictationDraft(originalDraft.text, transformed.text);
        applySnapshot({
          text: nextText,
          cursor: nextText.length,
          references: [...(originalDraft.references ?? []), ...(transformed.references ?? [])],
        });
        if (nextText !== originalText) {
          setRestorableDraft({
            original: { ...originalDraft, text: originalText, cursor: originalText.length },
            processedText: nextText,
            lifecycleKey: input.lifecycleKey,
          });
        }
        if (transformed.error) {
          onNoticeRef.current({
            title: "Could not process voice input",
            error: transformed.error,
          });
        } else if (transformed.warning) {
          onNoticeRef.current({ title: "Voice input", error: new Error(transformed.warning) });
        }
      }
    }

    if (attemptRef.current !== attempt) return;
    attemptRef.current += 1;
    clearAttempt();
    resetAudioWaveform();
    transition("idle");
  }, [
    applySnapshot,
    clearAttempt,
    draftUnchanged,
    input.lifecycleKey,
    resetAudioWaveform,
    transition,
  ]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") return;
    const originalDraft = draftUnchanged() ? originalDraftRef.current : null;
    attemptRef.current += 1;
    abortControllerRef.current?.abort();
    sessionRef.current?.cancel();
    clearAttempt();
    if (originalDraft) applyDraftSnapshotRef.current(originalDraft);
    resetAudioWaveform();
    transition("idle");
  }, [clearAttempt, draftUnchanged, resetAudioWaveform, transition]);

  const restoreOriginal = useCallback(() => {
    if (
      !restorableDraft ||
      restorableDraft.lifecycleKey !== input.lifecycleKey ||
      getDraftSnapshotRef.current().text !== restorableDraft.processedText
    )
      return;
    applyDraftSnapshotRef.current(restorableDraft.original);
    setRestorableDraft(null);
  }, [input.lifecycleKey, restorableDraft]);

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
    canRestoreOriginal:
      restorableDraft !== null &&
      restorableDraft.lifecycleKey === input.lifecycleKey &&
      input.draftText === restorableDraft.processedText,
    restoreOriginal,
  } as const;
}
