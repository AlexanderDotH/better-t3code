import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceDictationControl } from "./VoiceDictationControl";

function renderControl(state: "idle" | "recording"): string {
  return renderToStaticMarkup(
    <VoiceDictationControl
      state={state}
      audioWaveform={Array.from({ length: 14 }, (_, index) => index / 13)}
      disabled={false}
      onStart={vi.fn()}
      onStop={vi.fn()}
    />,
  );
}

describe("VoiceDictationControl layout", () => {
  it("keeps the active button anchored while the waveform expands to its left", () => {
    const idleMarkup = renderControl("idle");
    const recordingMarkup = renderControl("recording");

    expect(recordingMarkup.indexOf('role="meter"')).toBeLessThan(
      recordingMarkup.indexOf('aria-label="Stop voice input"'),
    );

    for (const sizeClass of ["h-9", "w-9", "sm:h-8", "sm:w-8"]) {
      expect(idleMarkup).toContain(sizeClass);
      expect(recordingMarkup).toContain(sizeClass);
    }
    expect(recordingMarkup.match(/data-voice-wave-bar="true"/gu)).toHaveLength(14);
  });
});
