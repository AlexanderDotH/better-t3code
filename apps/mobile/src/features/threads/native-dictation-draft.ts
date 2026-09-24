import { renderAssemblyAiDictationDraft } from "@t3tools/client-runtime/assembly-ai";
import type { SpeechProcessDictationResult, VoiceFileReference } from "@t3tools/contracts";
import {
  reconcileVoiceFileReferences,
  translateVoiceDictationResult,
} from "@t3tools/shared/voiceFileContext";

const DICTATION_PROCESSING_TIMEOUT_MS = 65_000;

export interface NativeDictationDraftSnapshot {
  readonly text: string;
  readonly references: ReadonlyArray<VoiceFileReference>;
}

/** Owns only the dictated suffix while the original draft and lifecycle still match. */
export function createNativeDictationDraft(input: {
  readonly original: NativeDictationDraftSnapshot;
  readonly readText: () => string;
  readonly isCurrent: () => boolean;
  readonly write: (snapshot: NativeDictationDraftSnapshot) => void;
}) {
  let valid = true;
  let expectedText = input.original.text;
  let transcript = "";
  let transformed = false;
  const isCurrent = () => valid && input.isCurrent() && input.readText() === expectedText;
  const write = (text: string, references: ReadonlyArray<VoiceFileReference>) => {
    expectedText = text;
    input.write({ text, references: reconcileVoiceFileReferences(text, references) });
  };

  return {
    isCurrent,
    get transcript() {
      return transcript;
    },
    updateTranscript(value: string) {
      if (!isCurrent()) return false;
      transcript = value;
      write(renderAssemblyAiDictationDraft(input.original.text, value), input.original.references);
      return true;
    },
    applyProcessed(result: SpeechProcessDictationResult) {
      if (!isCurrent()) return false;
      const text = renderAssemblyAiDictationDraft(input.original.text, result.text);
      transformed = text !== renderAssemblyAiDictationDraft(input.original.text, transcript);
      write(text, [...input.original.references, ...result.references]);
      return true;
    },
    canRestoreOriginal() {
      return transformed && isCurrent();
    },
    restoreOriginal() {
      if (!transformed || !isCurrent()) return false;
      write(
        renderAssemblyAiDictationDraft(input.original.text, transcript),
        input.original.references,
      );
      transformed = false;
      return true;
    },
    cancel() {
      if (isCurrent()) write(input.original.text, input.original.references);
      valid = false;
    },
    invalidate() {
      valid = false;
    },
  };
}

function withinProcessingDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      settle();
    };
    const cancel = () => finish(() => reject(new Error("Voice processing was cancelled.")));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new Error("Voice processing timed out. The original dictation was kept.")),
        ),
      DICTATION_PROCESSING_TIMEOUT_MS,
    );
    signal.addEventListener("abort", cancel, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) cancel();
  });
}

export async function processNativeDictation(input: {
  readonly transcript: string;
  readonly signal: AbortSignal;
  readonly process?: (transcript: string) => Promise<SpeechProcessDictationResult>;
  readonly translate?: (text: string) => Promise<string>;
}): Promise<SpeechProcessDictationResult> {
  const original: SpeechProcessDictationResult = { text: input.transcript, references: [] };
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort();
  input.signal.addEventListener("abort", cancel, { once: true });
  if (input.signal.aborted) lifetime.abort();
  const process = async (): Promise<SpeechProcessDictationResult> => {
    let result = original;
    if (lifetime.signal.aborted) return result;
    if (input.process) result = await input.process(input.transcript);
    if (lifetime.signal.aborted || result.warning || !input.translate) return result;
    try {
      return await translateVoiceDictationResult(result, input.translate);
    } catch (error) {
      return {
        ...result,
        warning: error instanceof Error ? error.message : "Voice translation failed.",
      };
    }
  };
  try {
    return await withinProcessingDeadline(process(), lifetime.signal);
  } catch (error) {
    return {
      ...original,
      warning: error instanceof Error ? error.message : "Voice processing failed.",
    };
  } finally {
    input.signal.removeEventListener("abort", cancel);
    lifetime.abort();
  }
}
