import type { NativeVoiceDictationState } from "./use-native-assembly-ai-dictation";

export function shouldDeactivateNativeAssemblyAiDictation(
  configured: boolean,
  state: NativeVoiceDictationState,
): boolean {
  return !configured && state !== "idle";
}
