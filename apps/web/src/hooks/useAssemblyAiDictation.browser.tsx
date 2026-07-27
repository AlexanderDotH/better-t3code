import { useState } from "react";
import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { useAssemblyAiDictation } from "./useAssemblyAiDictation";
import type { AssemblyAiTranscriptUpdate } from "../lib/assemblyAiStreamingTranscription";

let emitTranscript: ((update: AssemblyAiTranscriptUpdate) => void) | null = null;
let emitError: ((error: Error) => void) | null = null;
let emitAudioLevel: ((level: number) => void) | null = null;
const stopSession = vi.fn(async () => undefined);
const cancelSession = vi.fn();
const notice = vi.fn();
const send = vi.fn();

function DictationHarness({
  configured = true,
  transformTranscript,
}: {
  readonly configured?: boolean;
  readonly transformTranscript?: (transcript: string) => Promise<string>;
}) {
  const [lifecycleKey, setLifecycleKey] = useState("thread-a");
  const [draft, setDraft] = useState({ text: "draft  \n", cursor: 2 });
  const dictation = useAssemblyAiDictation({
    configured,
    lifecycleKey,
    getDraftSnapshot: () => draft,
    applyDraftSnapshot: setDraft,
    onNotice: notice,
    ...(transformTranscript ? { transformTranscript } : {}),
    startTransport: async ({ onTranscript, onError, onAudioLevel }) => {
      emitTranscript = onTranscript;
      emitError = onError;
      emitAudioLevel = onAudioLevel ?? null;
      return { stop: stopSession, cancel: cancelSession };
    },
  });

  return (
    <div>
      <output data-testid="state">{dictation.state}</output>
      <output data-testid="draft">{draft.text}</output>
      <output data-testid="cursor">{draft.cursor}</output>
      <output data-testid="waveform">{dictation.audioWaveform.join(",")}</output>
      <button type="button" onClick={() => void dictation.start()}>
        Start
      </button>
      <button type="button" onClick={() => void dictation.stop()}>
        Stop
      </button>
      <button type="button" disabled={dictation.active} onClick={send}>
        Send
      </button>
      <textarea aria-label="Prompt" disabled={dictation.active} value={draft.text} readOnly />
      <button type="button" onClick={() => setLifecycleKey("thread-b")}>
        Switch thread
      </button>
    </div>
  );
}

describe("useAssemblyAiDictation", () => {
  beforeEach(() => {
    emitTranscript = null;
    emitError = null;
    emitAudioLevel = null;
    stopSession.mockClear();
    cancelSession.mockClear();
    notice.mockClear();
    send.mockClear();
  });

  it("commits Stop, restores the exact Cancel snapshot, ignores stale callbacks, and never sends", async () => {
    render(<DictationHarness />);

    await page.getByRole("button", { name: "Start" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("recording");
    await expect.element(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await expect.element(page.getByRole("textbox", { name: "Prompt" })).toBeDisabled();

    emitTranscript?.({ text: "spoken words" });
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \nspoken words");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect.element(page.getByRole("textbox", { name: "Prompt" })).toHaveValue("draft  \n");
    await expect.element(page.getByTestId("cursor")).toHaveTextContent("2");

    emitTranscript?.({ text: "stale text" });
    await expect.element(page.getByRole("textbox", { name: "Prompt" })).toHaveValue("draft  \n");

    await page.getByRole("button", { name: "Start" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("recording");
    emitTranscript?.({ text: "kept text" });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \nkept text");
    expect(stopSession).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("retains a live waveform history, including repeated microphone levels", async () => {
    render(<DictationHarness />);
    await page.getByRole("button", { name: "Start" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("recording");

    emitAudioLevel?.(0.4);
    emitAudioLevel?.(0.4);

    await expect.element(page.getByTestId("waveform")).toHaveTextContent(/0\.4,0\.4$/u);
  });

  it("replaces only the dictated segment with its post-stop translation", async () => {
    const transformTranscript = vi.fn(async (transcript: string) => `translated ${transcript}`);
    render(<DictationHarness transformTranscript={transformTranscript} />);

    await page.getByRole("button", { name: "Start" }).click();
    emitTranscript?.({ text: "gesprochene worte" });
    await page.getByRole("button", { name: "Stop" }).click();

    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \ntranslated gesprochene worte");
    expect(transformTranscript).toHaveBeenCalledOnce();
    expect(transformTranscript).toHaveBeenCalledWith("gesprochene worte");
  });

  it("keeps the native dictated segment when post-stop translation fails", async () => {
    const translationError = new Error("translation unavailable");
    render(
      <DictationHarness
        transformTranscript={vi.fn(async () => Promise.reject(translationError))}
      />,
    );

    await page.getByRole("button", { name: "Start" }).click();
    emitTranscript?.({ text: "native words" });
    await page.getByRole("button", { name: "Stop" }).click();

    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \nnative words");
    expect(notice).toHaveBeenCalledWith({
      title: "Could not translate voice input",
      error: translationError,
    });
  });

  it("does not start and explains how to configure a missing API key", async () => {
    render(<DictationHarness configured={false} />);

    await page.getByRole("button", { name: "Start" }).click();

    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    expect(emitTranscript).toBeNull();
    expect(notice).toHaveBeenCalledWith({
      title: "Voice input is not configured",
      error: expect.objectContaining({ message: expect.stringMatching(/AssemblyAI API key/i) }),
    });
  });

  it("terminates on a thread switch while preserving the latest usable transcript", async () => {
    render(<DictationHarness />);
    await page.getByRole("button", { name: "Start" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("recording");
    emitTranscript?.({ text: "keep on switch" });

    await page.getByRole("button", { name: "Switch thread" }).click();

    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \nkeep on switch");
    expect(cancelSession).toHaveBeenCalledOnce();
  });

  it("preserves the latest usable transcript when the streaming service fails", async () => {
    render(<DictationHarness />);
    await page.getByRole("button", { name: "Start" }).click();
    await expect.element(page.getByTestId("state")).toHaveTextContent("recording");
    emitTranscript?.({ text: "keep after failure" });

    emitError?.(new Error("service unavailable"));

    await expect.element(page.getByTestId("state")).toHaveTextContent("idle");
    await expect
      .element(page.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("draft  \nkeep after failure");
    expect(cancelSession).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith({
      title: "Voice input failed",
      error: expect.objectContaining({ message: "service unavailable" }),
    });
  });
});
