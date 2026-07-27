import { describe, expect, it } from "vite-plus/test";

import {
  renderAssemblyAiDictationDraft,
  resolveAssemblyAiDictationTranscript,
} from "./useAssemblyAiDictation";

describe("renderAssemblyAiDictationDraft", () => {
  it("preserves the original draft byte-for-byte and adds exactly one separator when needed", () => {
    expect(renderAssemblyAiDictationDraft("existing", "spoken words")).toBe(
      "existing spoken words",
    );
    expect(renderAssemblyAiDictationDraft("existing\n", "spoken words")).toBe(
      "existing\nspoken words",
    );
    expect(renderAssemblyAiDictationDraft("  existing  ", "spoken words")).toBe(
      "  existing  spoken words",
    );
    expect(renderAssemblyAiDictationDraft("existing", "")).toBe("existing");
  });
});

describe("resolveAssemblyAiDictationTranscript", () => {
  it("returns the transformed final transcript", async () => {
    await expect(
      resolveAssemblyAiDictationTranscript("gesprochene worte", async (transcript) =>
        transcript.toUpperCase(),
      ),
    ).resolves.toEqual({ text: "GESPROCHENE WORTE", error: null });
  });

  it("keeps the native transcript when transformation fails", async () => {
    const error = new Error("translation unavailable");

    await expect(
      resolveAssemblyAiDictationTranscript("native words", async () => Promise.reject(error)),
    ).resolves.toEqual({ text: "native words", error });
  });
});
