import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AssemblyAiDictationState } from "../../hooks/useAssemblyAiDictation";
import { VoiceDictationControl } from "./VoiceDictationControl";

function renderControl(state: AssemblyAiDictationState): string {
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
  it("gives the waveform and adjacent controls consistent breathing room", () => {
    const idleMarkup = renderControl("idle");
    const recordingMarkup = renderControl("recording");

    expect(recordingMarkup.indexOf('role="meter"')).toBeLessThan(
      recordingMarkup.indexOf('aria-label="Stop voice input"'),
    );

    for (const sizeClass of ["h-9", "w-9", "sm:h-8", "sm:w-8"]) {
      expect(idleMarkup).toContain(sizeClass);
      expect(recordingMarkup).toContain(sizeClass);
    }
    expect(recordingMarkup).toContain("gap-3");
    expect(recordingMarkup).toContain("h-8 w-20");
    expect(recordingMarkup).toContain("gap-0.5");
    expect(recordingMarkup.match(/data-voice-wave-bar="true"/gu)).toHaveLength(14);
  });

  it("stays gray while connecting and turns red only when speech is accepted", () => {
    const startingMarkup = renderControl("starting");
    const recordingMarkup = renderControl("recording");
    const stoppingMarkup = renderControl("stopping");

    expect(startingMarkup).toContain('data-voice-dictation-tone="waiting"');
    expect(startingMarkup).toContain("bg-muted");
    expect(startingMarkup).toContain('aria-label="Cancel voice input connection"');

    expect(recordingMarkup).toContain('data-voice-dictation-tone="ready"');
    expect(recordingMarkup).toContain("bg-rose-500");
    expect(recordingMarkup).toContain('aria-label="Stop voice input"');

    expect(stoppingMarkup).toContain('data-voice-dictation-tone="waiting"');
    expect(stoppingMarkup).toContain("bg-muted");
    expect(stoppingMarkup).toContain('aria-label="Stopping voice input"');
    expect(stoppingMarkup).toContain('aria-busy="true"');

    for (const markup of [startingMarkup, stoppingMarkup]) {
      expect(markup).not.toContain("rose-");
    }
    for (const markup of [startingMarkup, recordingMarkup, stoppingMarkup]) {
      expect(markup).not.toContain("orange-");
    }
  });
});
