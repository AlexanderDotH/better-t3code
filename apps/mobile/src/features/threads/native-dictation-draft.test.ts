import type { SpeechProcessDictationResult, VoiceFileReference } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createNativeDictationDraft,
  processNativeDictation,
  type NativeDictationDraftSnapshot,
} from "./native-dictation-draft";

const reference: VoiceFileReference = {
  label: "index.ts",
  previewPath: "apps/web/index.ts",
  candidates: [
    { path: "apps/web/index.ts", symbols: [{ name: "App", kind: "class", line: 12 }] },
    { path: "apps/server/index.ts", symbols: [{ name: "startServer", kind: "function", line: 7 }] },
  ],
  truncated: false,
};
const fileLink = serializeComposerFileLink(reference.previewPath);

function draftHarness(initialText = "Existing instructions.") {
  let draft: NativeDictationDraftSnapshot = { text: initialText, references: [] };
  let currentThread = "thread-1";
  const session = createNativeDictationDraft({
    original: draft,
    readText: () => draft.text,
    isCurrent: () => currentThread === "thread-1",
    write: (next) => {
      draft = next;
    },
  });
  return {
    session,
    get draft() {
      return draft;
    },
    edit(text: string) {
      draft = { ...draft, text };
    },
    switchThread() {
      currentThread = "thread-2";
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("native dictated draft ownership", () => {
  it("keeps the original draft, joins every live turn, and restores the raw dictated suffix", () => {
    const harness = draftHarness();
    harness.session.updateTranscript("Change index tee ess.");
    harness.session.updateTranscript("Change index tee ess. No, keep the API unchanged.");
    expect(harness.draft.text).toBe(
      "Existing instructions. Change index tee ess. No, keep the API unchanged.",
    );

    harness.session.applyProcessed({
      text: `Change ${fileLink}. Keep the API unchanged.`,
      references: [reference],
    });
    expect(harness.draft.text).toBe(
      `Existing instructions. Change ${fileLink}. Keep the API unchanged.`,
    );
    expect(harness.draft.references[0]?.candidates).toHaveLength(2);
    expect(harness.session.canRestoreOriginal()).toBe(true);
    harness.session.restoreOriginal();
    expect(harness.draft.text).toBe(
      "Existing instructions. Change index tee ess. No, keep the API unchanged.",
    );
    expect(harness.draft.references).toEqual([]);
  });

  it.each(["manual edit", "thread switch", "cancel"] as const)(
    "rejects a late processing result after %s",
    (change) => {
      const harness = draftHarness();
      harness.session.updateTranscript("Live dictation");
      if (change === "manual edit") harness.edit("User changed this manually");
      if (change === "thread switch") harness.switchThread();
      if (change === "cancel") harness.session.cancel();
      const retained = harness.draft;
      expect(harness.session.applyProcessed({ text: "Late cleanup", references: [] })).toBe(false);
      expect(harness.draft).toEqual(retained);
      expect(harness.session.canRestoreOriginal()).toBe(false);
    },
  );

  it("does not restore over an edit made after processing", () => {
    const harness = draftHarness();
    harness.session.updateTranscript("Please change it um");
    harness.session.applyProcessed({ text: "Please change it.", references: [] });
    harness.edit("Please keep the new manual version.");
    expect(harness.session.restoreOriginal()).toBe(false);
    expect(harness.draft.text).toBe("Please keep the new manual version.");
  });

  it("retains a previous dictation's candidates when a later dictated suffix is restored", () => {
    let draft: NativeDictationDraftSnapshot = { text: `Fix ${fileLink}.`, references: [reference] };
    const session = createNativeDictationDraft({
      original: draft,
      readText: () => draft.text,
      isCurrent: () => true,
      write: (next) => {
        draft = next;
      },
    });
    session.updateTranscript("um don't change the API");
    session.applyProcessed({ text: "Do not change the API.", references: [] });
    session.restoreOriginal();
    expect(draft.text).toBe(`Fix ${fileLink}. um don't change the API`);
    expect(draft.references).toEqual([reference]);
  });
});

describe("native dictation processing", () => {
  it("processes the entire transcript before translating and protects file alternatives", async () => {
    const transcript = "Change index tee ess. No, leave the API unchanged.";
    const process = vi.fn(async (): Promise<SpeechProcessDictationResult> => ({
      text: `Ändere ${fileLink}. Die API nicht verändern.`,
      references: [reference],
    }));
    const translate = vi.fn(async (text: string) =>
      text
        .replace("Ändere", "Change")
        .replace("Die API nicht verändern.", "Do not change the API."),
    );
    const result = await processNativeDictation({
      transcript,
      process,
      translate,
      signal: new AbortController().signal,
    });
    expect(process).toHaveBeenCalledWith(transcript);
    expect(translate.mock.calls[0]?.[0]).not.toContain(reference.previewPath);
    expect(result).toEqual({
      text: `Change ${fileLink}. Do not change the API.`,
      references: [reference],
    });
  });

  it("keeps processed text and candidates when translation drops a file reference", async () => {
    const processed = { text: `Change ${fileLink}.`, references: [reference] };
    const result = await processNativeDictation({
      transcript: "Change index tee ess.",
      signal: new AbortController().signal,
      process: async () => processed,
      translate: async () => "Change the file.",
    });
    expect(result.text).toBe(processed.text);
    expect(result.references).toEqual(processed.references);
    expect(result.warning).toBeTruthy();
  });

  it("retains original text and stops the pipeline on gateway failure", async () => {
    const translate = vi.fn(async (text: string) => text);
    const result = await processNativeDictation({
      transcript: "Do not change the API.",
      signal: new AbortController().signal,
      process: async () => {
        throw new Error("Gateway unavailable");
      },
      translate,
    });
    expect(result).toEqual({
      text: "Do not change the API.",
      references: [],
      warning: "Gateway unavailable",
    });
    expect(translate).not.toHaveBeenCalled();
  });

  it("keeps a server fallback verbatim when processing returned a warning", async () => {
    const original = {
      text: "Do not change the API.",
      references: [],
      warning: "Gateway unavailable",
    };
    const translate = vi.fn(async (text: string) => `Translated ${text}`);
    const result = await processNativeDictation({
      transcript: original.text,
      signal: new AbortController().signal,
      process: async () => original,
      translate,
    });
    expect(result).toEqual(original);
    expect(translate).not.toHaveBeenCalled();
  });

  it("keeps the existing translation path on an environment without processing support", async () => {
    const translate = vi.fn(async () => "Do not change the API.");
    const result = await processNativeDictation({
      transcript: "Die API nicht verändern.",
      signal: new AbortController().signal,
      translate,
    });
    expect(translate).toHaveBeenCalledWith("Die API nicht verändern.");
    expect(result).toEqual({ text: "Do not change the API.", references: [] });
  });

  it("returns the raw transcript after 65 seconds and ignores a late result", async () => {
    vi.useFakeTimers();
    let finish!: (result: SpeechProcessDictationResult) => void;
    const process = () =>
      new Promise<SpeechProcessDictationResult>((resolve) => {
        finish = resolve;
      });
    const translate = vi.fn(async (text: string) => text);
    const pending = processNativeDictation({
      transcript: "Keep this.",
      process,
      translate,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(await pending).toMatchObject({
      text: "Keep this.",
      references: [],
      warning: expect.stringContaining("timed out"),
    });
    finish({ text: "Late text", references: [] });
    await Promise.resolve();
    expect(translate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a cancelled processing request without awaiting the remote response", async () => {
    const abort = new AbortController();
    const pending = processNativeDictation({
      transcript: "Keep this.",
      process: () => new Promise<SpeechProcessDictationResult>(() => {}),
      signal: abort.signal,
    });
    abort.abort();
    expect(await pending).toMatchObject({
      text: "Keep this.",
      warning: expect.stringContaining("cancelled"),
    });
  });
});
