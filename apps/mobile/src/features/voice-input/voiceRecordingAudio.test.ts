import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const audio = vi.hoisted(() => ({
  setMode: vi.fn(),
  setActive: vi.fn(),
  configureRoute: vi.fn(),
  clearInput: vi.fn(),
}));
vi.mock("expo-audio", () => ({
  setAudioModeAsync: audio.setMode,
  setIsAudioActiveAsync: audio.setActive,
}));
vi.mock("../../native/voiceRecordingAudio", () => ({
  configureMusicFriendlyVoiceRecording: audio.configureRoute,
  clearVoiceRecordingInput: audio.clearInput,
}));

import { configureVoiceRecordingAudio, releaseVoiceRecordingAudio } from "./voiceRecordingAudio";

afterEach(async () => {
  await releaseVoiceRecordingAudio().catch(() => undefined);
  vi.resetAllMocks();
});

describe("voice recording audio ownership", () => {
  it("allows recording alongside music and selects the safe route before activation", async () => {
    let musicCanContinue = false;
    let safeRoute = false;
    audio.setMode.mockImplementation(async (mode) => {
      musicCanContinue = mode.interruptionMode === "mixWithOthers";
    });
    audio.configureRoute.mockImplementation(async () => {
      safeRoute = true;
    });
    audio.setActive.mockImplementation(async (active) => {
      if (active) {
        expect(musicCanContinue).toBe(true);
        expect(safeRoute).toBe(true);
      }
    });
    await configureVoiceRecordingAudio();
    await releaseVoiceRecordingAudio();
    expect(audio.setActive.mock.calls.at(-1)).toEqual([false]);
  });

  it("deactivates recording even when clearing the preferred input fails", async () => {
    await configureVoiceRecordingAudio();
    const failure = new Error("Input unavailable");
    audio.clearInput.mockRejectedValueOnce(failure);
    await expect(releaseVoiceRecordingAudio()).rejects.toBe(failure);
    expect(audio.setMode.mock.calls.at(-1)).toEqual([{ allowsRecording: false }]);
    expect(audio.setActive.mock.calls.at(-1)).toEqual([false]);
  });

  it("deactivates recording even when disabling recording fails", async () => {
    const failure = new Error("Audio mode failed");
    audio.setMode.mockRejectedValueOnce(failure);
    await expect(releaseVoiceRecordingAudio()).rejects.toBe(failure);
    expect(audio.setActive).toHaveBeenCalledWith(false);
  });

  it("cleans up a failed route configuration and preserves its original error", async () => {
    const failure = new Error("Route unavailable");
    audio.configureRoute.mockRejectedValueOnce(failure);
    await expect(configureVoiceRecordingAudio()).rejects.toBe(failure);
    expect(audio.setActive).not.toHaveBeenCalledWith(true);
    expect(audio.setActive).toHaveBeenCalledWith(false);
  });

  it("does not reactivate audio when dictation is cancelled during route selection", async () => {
    const route = Promise.withResolvers<void>();
    const configuring = Promise.withResolvers<void>();
    const abort = new AbortController();
    audio.configureRoute.mockImplementationOnce(() => {
      configuring.resolve();
      return route.promise;
    });
    const operation = configureVoiceRecordingAudio(abort.signal);
    await configuring.promise;
    abort.abort();
    route.resolve();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(audio.setActive).not.toHaveBeenCalledWith(true);
    expect(audio.setActive).toHaveBeenCalledWith(false);
  });

  it("finishes prior cleanup before a new dictation activates the shared audio session", async () => {
    const cleanup = Promise.withResolvers<void>();
    const clearing = Promise.withResolvers<void>();
    audio.clearInput.mockImplementationOnce(() => {
      clearing.resolve();
      return cleanup.promise;
    });
    const releasing = releaseVoiceRecordingAudio();
    await clearing.promise;
    const configuring = configureVoiceRecordingAudio();
    expect(audio.setActive).not.toHaveBeenCalledWith(true);
    cleanup.resolve();
    await releasing;
    await configuring;
    expect(audio.setActive.mock.calls.map(([active]) => active)).toEqual([false, true]);
  });
});
