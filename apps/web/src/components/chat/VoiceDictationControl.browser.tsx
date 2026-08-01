import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import "../../index.css";
import { VoiceDictationControl } from "./VoiceDictationControl";

describe("VoiceDictationControl", () => {
  it("keeps the active control anchored while the waveform expands to the left", async () => {
    render(
      <div className="flex w-80 flex-col gap-4">
        <div className="flex items-center justify-end gap-2">
          <VoiceDictationControl
            state="idle"
            audioWaveform={[]}
            disabled={false}
            onStart={vi.fn()}
            onStop={vi.fn()}
          />
          <span className="size-8" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <span data-testid="config-bar-control" className="size-8" />
          <VoiceDictationControl
            state="recording"
            audioWaveform={[0, 0.25, 0.5, 1]}
            disabled={false}
            onStart={vi.fn()}
            onStop={vi.fn()}
          />
          <span className="size-8" />
        </div>
      </div>,
    );

    await expect.element(page.getByRole("button", { name: "Start voice input" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Stop voice input" })).toBeVisible();

    const startButton = document.querySelector<HTMLElement>('[aria-label="Start voice input"]');
    const stopButton = document.querySelector<HTMLElement>('[aria-label="Stop voice input"]');
    const waveform = document.querySelector<HTMLElement>('[aria-label="Live microphone waveform"]');
    const configBarControl = document.querySelector<HTMLElement>(
      '[data-testid="config-bar-control"]',
    );

    expect(startButton).not.toBeNull();
    expect(stopButton).not.toBeNull();
    expect(waveform).not.toBeNull();
    expect(configBarControl).not.toBeNull();

    const startRect = startButton!.getBoundingClientRect();
    const stopRect = stopButton!.getBoundingClientRect();
    const waveformRect = waveform!.getBoundingClientRect();
    const configBarRect = configBarControl!.getBoundingClientRect();

    expect(Math.abs(stopRect.left - startRect.left)).toBeLessThanOrEqual(1);
    expect(waveformRect.right).toBeLessThanOrEqual(stopRect.left - 12);
    expect(waveformRect.left).toBeGreaterThanOrEqual(configBarRect.right + 12);
  });

  it("shows one orange stop indicator and a live waveform while recording", async () => {
    const onStop = vi.fn(async () => undefined);
    render(
      <VoiceDictationControl
        state="recording"
        audioWaveform={Array.from({ length: 14 }, (_, index) => index / 13)}
        disabled={false}
        onStart={vi.fn()}
        onStop={onStop}
      />,
    );

    const stopButton = page.getByRole("button", { name: "Stop voice input" });
    await expect.element(stopButton).toBeVisible();
    await expect
      .element(page.getByRole("meter", { name: "Live microphone waveform" }))
      .toHaveAttribute("aria-valuenow", "100");
    expect(document.querySelectorAll("button")).toHaveLength(1);
    expect(document.querySelector('[aria-label="Cancel voice input"]')).toBeNull();
    expect(document.querySelectorAll("[data-voice-wave-bar]")).toHaveLength(14);
    expect(document.querySelector('[data-voice-dictation-tone="ready"]')).not.toBeNull();
    expect(document.querySelector(".bg-orange-500")).not.toBeNull();

    await stopButton.click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("uses a gray waiting state until the connection is ready", async () => {
    render(
      <VoiceDictationControl
        state="starting"
        audioWaveform={Array.from({ length: 14 }, () => 0)}
        disabled={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    await expect
      .element(page.getByRole("button", { name: "Cancel voice input connection" }))
      .toBeVisible();
    expect(document.querySelector('[data-voice-dictation-tone="waiting"]')).not.toBeNull();
    expect(document.querySelector(".bg-muted")).not.toBeNull();
    expect(document.querySelector(".bg-orange-500")).toBeNull();
  });
});
