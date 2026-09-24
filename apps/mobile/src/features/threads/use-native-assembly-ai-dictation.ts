import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId, VoiceFileReference } from "@t3tools/contracts";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNativeServerSpeechSession,
  type NativeServerSpeechSession,
} from "./native-server-speech-transport";
import { shouldDeactivateNativeAssemblyAiDictation } from "./native-assembly-ai-dictation-policy";
import { createNativeDictationDraft, processNativeDictation } from "./native-dictation-draft";

export type NativeVoiceDictationState = "idle" | "starting" | "recording" | "stopping";

const EMPTY_WAVEFORM = Object.freeze(Array.from({ length: 14 }, () => 0));

function commandFailureMessage(result: { readonly _tag: string }, fallback: string): Error {
  if (result._tag !== "Failure") return new Error(fallback);
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error : new Error(fallback);
}

export function useNativeAssemblyAiDictation(input: {
  readonly configured: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly processingSupported: boolean;
  readonly lifecycleKey: string;
  readonly draftText: string;
  readonly readDraftText?: () => string;
  readonly draftReferences?: ReadonlyArray<VoiceFileReference>;
  readonly outputLanguage: "native" | "english";
  readonly onChangeDraftText: (
    text: string,
    references?: ReadonlyArray<VoiceFileReference>,
  ) => void;
  readonly onNotice: (title: string, error: Error) => void;
}) {
  const { readDraftText } = input;
  const startStreamingSession = useAtomCommand(serverEnvironment.startSpeechStreamingSession, {
    reportFailure: false,
  });
  const pushStreamingAudio = useAtomCommand(serverEnvironment.pushSpeechStreamingAudio, {
    reportFailure: false,
  });
  const finishStreamingSession = useAtomCommand(serverEnvironment.finishSpeechStreamingSession, {
    reportFailure: false,
  });
  const cancelStreamingSession = useAtomCommand(serverEnvironment.cancelSpeechStreamingSession, {
    reportFailure: false,
  });
  const translateTranscript = useAtomCommand(serverEnvironment.translateSpeechTranscript, {
    reportFailure: false,
  });
  const processDictation = useAtomCommand(serverEnvironment.processSpeechDictation, {
    reportFailure: false,
  });
  const [state, setState] = useState<NativeVoiceDictationState>("idle");
  const [audioWaveform, setAudioWaveform] = useState<ReadonlyArray<number>>(EMPTY_WAVEFORM);
  const stateRef = useRef<NativeVoiceDictationState>("idle");
  const attemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<NativeServerSpeechSession | null>(null);
  const draftSessionRef = useRef<ReturnType<typeof createNativeDictationDraft> | null>(null);
  const [restorableDraft, setRestorableDraft] = useState<{
    text: string;
    lifecycleKey: string;
  } | null>(null);
  const draftTextRef = useRef(input.draftText);
  const lifecycleKeyRef = useRef(input.lifecycleKey);
  const onChangeDraftTextRef = useRef(input.onChangeDraftText);
  const onNoticeRef = useRef(input.onNotice);
  useLayoutEffect(() => {
    onChangeDraftTextRef.current = input.onChangeDraftText;
    onNoticeRef.current = input.onNotice;
  }, [input.onChangeDraftText, input.onNotice]);

  const onAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    sessionRef.current?.pushAudio(buffer);
  }, []);
  const audioStream = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: "int16",
    onBuffer: onAudioBuffer,
  });

  const transition = useCallback((next: NativeVoiceDictationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const reset = useCallback(() => {
    abortRef.current = null;
    sessionRef.current = null;
    setAudioWaveform(EMPTY_WAVEFORM);
  }, []);

  const releaseAudio = useCallback(() => {
    audioStream.stream.stop();
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, [audioStream.stream]);

  const deactivate = useCallback(() => {
    draftSessionRef.current?.invalidate();
    setRestorableDraft(null);
    if (stateRef.current === "idle") return;
    attemptRef.current += 1;
    abortRef.current?.abort();
    releaseAudio();
    sessionRef.current?.cancel();
    reset();
    transition("idle");
  }, [releaseAudio, reset, transition]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") return;
    draftSessionRef.current?.cancel();
    deactivate();
  }, [deactivate]);

  useEffect(() => {
    if (!shouldDeactivateNativeAssemblyAiDictation(input.configured, stateRef.current)) return;
    deactivate();
  }, [deactivate, input.configured]);

  useLayoutEffect(() => {
    draftTextRef.current = input.draftText;
    lifecycleKeyRef.current = input.lifecycleKey;
    if (draftSessionRef.current && !draftSessionRef.current.isCurrent()) {
      // External edits and thread changes end ownership before a pending result can land.
      deactivate();
    }
  }, [deactivate, input.draftText, input.lifecycleKey]);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      draftSessionRef.current?.invalidate();
      abortRef.current?.abort();
      audioStream.stream.stop();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      sessionRef.current?.cancel();
    };
  }, [audioStream.stream]);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!input.configured) {
      onNoticeRef.current(
        "Voice input is not configured",
        new Error("Add an AssemblyAI API key in Settings → Agents & Servers."),
      );
      return;
    }
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    draftSessionRef.current?.invalidate();
    const lifecycleKey = input.lifecycleKey;
    const draftSession = createNativeDictationDraft({
      original: {
        text: readDraftText?.() ?? draftTextRef.current,
        references: input.draftReferences ?? [],
      },
      readText: () => readDraftText?.() ?? draftTextRef.current,
      isCurrent: () => lifecycleKeyRef.current === lifecycleKey,
      write: ({ text, references }) => {
        draftTextRef.current = text;
        onChangeDraftTextRef.current(text, references);
      },
    });
    draftSessionRef.current = draftSession;
    setRestorableDraft(null);
    const abortController = new AbortController();
    abortRef.current = abortController;
    setAudioWaveform(EMPTY_WAVEFORM);
    transition("starting");

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission was denied.");
      if (abortController.signal.aborted) return;
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });
      if (abortController.signal.aborted) return;
      const session = createNativeServerSpeechSession({
        startSession: async () => {
          const result = await startStreamingSession({
            environmentId: input.environmentId,
            input: {
              projectId: input.projectId,
              ...(input.processingSupported && input.threadId ? { threadId: input.threadId } : {}),
            },
          });
          if (result._tag === "Failure") {
            throw commandFailureMessage(result, "Could not start server voice streaming.");
          }
          return result.value;
        },
        pushAudio: async (streamingInput) => {
          const result = await pushStreamingAudio({
            environmentId: input.environmentId,
            input: streamingInput,
          });
          if (result._tag === "Failure") {
            throw commandFailureMessage(result, "Could not stream microphone audio.");
          }
          return result.value;
        },
        finishSession: async (streamingInput) => {
          const result = await finishStreamingSession({
            environmentId: input.environmentId,
            input: streamingInput,
          });
          if (result._tag === "Failure") {
            throw commandFailureMessage(result, "Could not finish server voice streaming.");
          }
          return result.value;
        },
        cancelSession: async (streamingInput) => {
          const result = await cancelStreamingSession({
            environmentId: input.environmentId,
            input: streamingInput,
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            throw commandFailureMessage(result, "Could not cancel server voice streaming.");
          }
        },
        onTranscript: (text) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          if (!draftSession.updateTranscript(text)) deactivate();
        },
        onAudioLevel: (level) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          setAudioWaveform((current) => [...current.slice(1), level]);
        },
        onError: (error) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          attemptRef.current += 1;
          releaseAudio();
          sessionRef.current?.cancel();
          reset();
          transition("idle");
          onNoticeRef.current("Voice input failed", error);
        },
      });
      sessionRef.current = session;
      await session.connect(abortController.signal);
      if (attemptRef.current !== attempt || abortController.signal.aborted) {
        session.cancel();
        return;
      }
      await audioStream.stream.start();
      if (attemptRef.current !== attempt || abortController.signal.aborted) {
        releaseAudio();
        session.cancel();
        return;
      }
      transition("recording");
    } catch (error) {
      if (attemptRef.current !== attempt || abortController.signal.aborted) return;
      releaseAudio();
      sessionRef.current?.cancel();
      reset();
      transition("idle");
      onNoticeRef.current(
        "Could not start voice input",
        error instanceof Error ? error : new Error("Voice input setup failed."),
      );
    }
  }, [
    audioStream.stream,
    cancelStreamingSession,
    finishStreamingSession,
    input.configured,
    input.environmentId,
    input.projectId,
    input.threadId,
    input.lifecycleKey,
    input.draftReferences,
    readDraftText,
    input.processingSupported,
    deactivate,
    pushStreamingAudio,
    releaseAudio,
    reset,
    startStreamingSession,
    transition,
  ]);

  const stop = useCallback(async () => {
    if (stateRef.current === "idle" || stateRef.current === "stopping") return;
    const attempt = attemptRef.current;
    const session = sessionRef.current;
    const draftSession = draftSessionRef.current;
    const abortController = abortRef.current;
    transition("stopping");
    releaseAudio();
    try {
      await session?.stop();
    } catch (error) {
      if (attemptRef.current === attempt)
        onNoticeRef.current(
          "Could not stop voice input cleanly",
          error instanceof Error ? error : new Error("Voice input stop failed."),
        );
    }

    if (attemptRef.current !== attempt || !draftSession?.isCurrent() || !abortController) return;
    const transcript = draftSession.transcript.trim();
    if (transcript) {
      const result = await processNativeDictation({
        transcript,
        signal: abortController.signal,
        ...(input.processingSupported
          ? {
              process: async (transcript: string) => {
                const result = await processDictation({
                  environmentId: input.environmentId,
                  input: {
                    projectId: input.projectId,
                    ...(input.threadId ? { threadId: input.threadId } : {}),
                    transcript,
                  },
                });
                if (result._tag === "Failure")
                  throw commandFailureMessage(result, "Voice processing failed.");
                return result.value;
              },
            }
          : {}),
        ...(input.outputLanguage === "english"
          ? {
              translate: async (text: string) => {
                const result = await translateTranscript({
                  environmentId: input.environmentId,
                  input: { projectId: input.projectId, text },
                });
                if (result._tag === "Failure")
                  throw commandFailureMessage(result, "Voice translation failed.");
                return result.value.text;
              },
            }
          : {}),
      });
      if (attemptRef.current !== attempt || !draftSession.isCurrent()) return;
      draftSession.applyProcessed(result);
      setRestorableDraft(
        draftSession.canRestoreOriginal()
          ? {
              text: draftTextRef.current,
              lifecycleKey: input.lifecycleKey,
            }
          : null,
      );
      if (result.warning) onNoticeRef.current("Voice input", new Error(result.warning));
    }

    if (attemptRef.current !== attempt) return;
    attemptRef.current += 1;
    reset();
    transition("idle");
  }, [
    input.environmentId,
    input.outputLanguage,
    input.projectId,
    input.threadId,
    input.processingSupported,
    input.lifecycleKey,
    processDictation,
    releaseAudio,
    reset,
    transition,
    translateTranscript,
  ]);

  const restoreOriginal = useCallback(() => {
    draftSessionRef.current?.restoreOriginal();
    setRestorableDraft(null);
  }, []);

  return {
    state,
    active: state !== "idle",
    audioWaveform,
    start,
    stop,
    cancel,
    canRestoreOriginal:
      restorableDraft !== null &&
      restorableDraft.text === input.draftText &&
      restorableDraft.lifecycleKey === input.lifecycleKey,
    restoreOriginal,
  } as const;
}
