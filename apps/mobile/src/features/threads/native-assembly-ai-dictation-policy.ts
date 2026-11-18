import type { AssemblyAiDictationState } from "@t3tools/client-runtime/assembly-ai";

export type NativeVoiceDictationState = AssemblyAiDictationState;

export function shouldDeactivateNativeAssemblyAiDictation(
  configured: boolean,
  state: NativeVoiceDictationState,
): boolean {
  return !configured && state !== "idle";
}
