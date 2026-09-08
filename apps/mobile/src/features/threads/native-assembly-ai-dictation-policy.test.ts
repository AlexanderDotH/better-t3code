import { describe, expect, it } from "vite-plus/test";

import { shouldDeactivateNativeAssemblyAiDictation } from "./native-assembly-ai-dictation-policy";

describe("native AssemblyAI dictation policy", () => {
  it("deactivates every owned in-flight state when the feature is turned off", () => {
    expect(shouldDeactivateNativeAssemblyAiDictation(false, "starting")).toBe(true);
    expect(shouldDeactivateNativeAssemblyAiDictation(false, "recording")).toBe(true);
    expect(shouldDeactivateNativeAssemblyAiDictation(false, "stopping")).toBe(true);
  });

  it("does not repeat cleanup after settlement or interrupt enabled dictation", () => {
    expect(shouldDeactivateNativeAssemblyAiDictation(false, "idle")).toBe(false);
    expect(shouldDeactivateNativeAssemblyAiDictation(true, "recording")).toBe(false);
  });
});
