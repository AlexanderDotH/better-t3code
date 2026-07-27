import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { VoiceDictationControl } from "./VoiceDictationControl";

describe("VoiceDictationControl", () => {
  it("keeps the active control anchored while the waveform expands to the left", () => {
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

    expect(stopRect.left).toBe(startRect.left);
    expect(waveformRect.right).toBeLessThanOrEqual(stopRect.left - 8);
    expect(waveformRect.left).toBeGreaterThanOrEqual(configBarRect.right + 8);
  });

  it("shows one red stop indicator and a live waveform while recording", async () => {
    const onStop = vi.fn(async () => undefined);
    render(
      <VoiceDictationControl
        state="recording"
        audioWaveform={[0, 0.25, 0.5, 1]}
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
    expect(document.querySelectorAll("[data-voice-wave-bar]")).toHaveLength(4);

    await stopButton.click();
    expect(onStop).toHaveBeenCalledOnce();
  });
});
