import { renderAssemblyAiDictationDraft } from "@t3tools/client-runtime/assembly-ai";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNativeAssemblyAiSession,
  type NativeAssemblyAiSession,
} from "./native-assembly-ai-transport";

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
  readonly lifecycleKey: string;
  readonly draftText: string;
  readonly outputLanguage: "native" | "english";
  readonly onChangeDraftText: (text: string) => void;
  readonly onNotice: (title: string, error: Error) => void;
}) {
  const createToken = useAtomCommand(serverEnvironment.createAssemblyAiStreamingToken, {
    reportFailure: false,
  });
  const translateTranscript = useAtomCommand(serverEnvironment.translateSpeechTranscript, {
    reportFailure: false,
  });
  const [state, setState] = useState<NativeVoiceDictationState>("idle");
  const [audioWaveform, setAudioWaveform] = useState<ReadonlyArray<number>>(EMPTY_WAVEFORM);
  const stateRef = useRef<NativeVoiceDictationState>("idle");
  const attemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<NativeAssemblyAiSession | null>(null);
  const originalDraftRef = useRef("");
  const latestTranscriptRef = useRef("");
  const draftTextRef = useRef(input.draftText);
  const onChangeDraftTextRef = useRef(input.onChangeDraftText);
  const onNoticeRef = useRef(input.onNotice);
  draftTextRef.current = input.draftText;
  onChangeDraftTextRef.current = input.onChangeDraftText;
  onNoticeRef.current = input.onNotice;

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
    latestTranscriptRef.current = "";
    setAudioWaveform(EMPTY_WAVEFORM);
  }, []);

  const releaseAudio = useCallback(() => {
    audioStream.stream.stop();
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, [audioStream.stream]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") return;
    attemptRef.current += 1;
    abortRef.current?.abort();
    releaseAudio();
    sessionRef.current?.cancel();
    onChangeDraftTextRef.current(originalDraftRef.current);
    reset();
    transition("idle");
  }, [releaseAudio, reset, transition]);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      abortRef.current?.abort();
      audioStream.stream.stop();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      sessionRef.current?.cancel();
    };
  }, [audioStream.stream]);

  useEffect(() => {
    if (stateRef.current === "idle") return;
    // Switching project/thread must never keep the microphone attached to the
    // previous draft. Preserve the latest transcript instead of reverting it.
    attemptRef.current += 1;
    abortRef.current?.abort();
    releaseAudio();
    sessionRef.current?.cancel();
    reset();
    transition("idle");
  }, [input.lifecycleKey, releaseAudio, reset, transition]);

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
    originalDraftRef.current = draftTextRef.current;
    latestTranscriptRef.current = "";
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
      const tokenResult = await createToken({
        environmentId: input.environmentId,
        input: { projectId: input.projectId },
      });
      if (tokenResult._tag === "Failure") {
        if (isAtomCommandInterrupted(tokenResult)) {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          throw new Error("Voice input token creation was interrupted.");
        }
        throw commandFailureMessage(tokenResult, "Could not create a voice streaming token.");
      }
      if (attemptRef.current !== attempt || abortController.signal.aborted) return;

      const session = createNativeAssemblyAiSession({
        config: tokenResult.value,
        onTranscript: (text) => {
          if (attemptRef.current !== attempt || abortController.signal.aborted) return;
          latestTranscriptRef.current = text;
          onChangeDraftTextRef.current(
            renderAssemblyAiDictationDraft(originalDraftRef.current, text),
          );
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
    createToken,
    input.configured,
    input.environmentId,
    input.projectId,
    releaseAudio,
    reset,
    transition,
  ]);

  const stop = useCallback(async () => {
    if (stateRef.current === "idle" || stateRef.current === "stopping") return;
    const attempt = attemptRef.current;
    const session = sessionRef.current;
    transition("stopping");
    releaseAudio();
    try {
      await session?.stop();
    } catch (error) {
      onNoticeRef.current(
        "Could not stop voice input cleanly",
        error instanceof Error ? error : new Error("Voice input stop failed."),
      );
    }

    if (attemptRef.current === attempt && input.outputLanguage === "english") {
      const transcript = latestTranscriptRef.current.trim();
      if (transcript) {
        const result = await translateTranscript({
          environmentId: input.environmentId,
          input: { projectId: input.projectId, text: transcript },
        });
        if (attemptRef.current === attempt) {
          if (result._tag === "Success") {
            onChangeDraftTextRef.current(
              renderAssemblyAiDictationDraft(originalDraftRef.current, result.value.text),
            );
          } else if (!isAtomCommandInterrupted(result)) {
            onNoticeRef.current(
              "Could not translate voice input",
              commandFailureMessage(result, "Voice translation failed."),
            );
          }
        }
      }
    }

    if (attemptRef.current === attempt) attemptRef.current += 1;
    reset();
    transition("idle");
  }, [
    input.environmentId,
    input.outputLanguage,
    input.projectId,
    releaseAudio,
    reset,
    transition,
    translateTranscript,
  ]);

  return {
    state,
    active: state !== "idle",
    audioWaveform,
    start,
    stop,
    cancel,
  } as const;
}
