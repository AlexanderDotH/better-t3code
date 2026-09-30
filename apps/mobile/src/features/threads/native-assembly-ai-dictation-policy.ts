export type NativeVoiceDictationState = "idle" | "starting" | "recording" | "stopping";

export function shouldDeactivateNativeAssemblyAiDictation(
  configured: boolean,
  state: NativeVoiceDictationState,
): boolean {
  return !configured && state !== "idle";
}
