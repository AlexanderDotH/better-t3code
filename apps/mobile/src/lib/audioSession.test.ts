import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const audio = vi.hoisted(() => ({
  steps: [] as Array<string>,
}));
vi.mock("expo-audio", () => ({
  AudioModule: { setAudioSessionOwner: vi.fn() },
  setAudioModeAsync: vi.fn(
    async (mode: { interruptionMode?: string; allowsRecording?: boolean }) => {
      audio.steps.push(
        mode.interruptionMode === undefined
          ? `mode:recording=${mode.allowsRecording}`
          : `mode:${mode.interruptionMode}`,
      );
    },
  ),
  setIsAudioActiveAsync: vi.fn(async (active: boolean) => {
    audio.steps.push(`active:${active}`);
  }),
}));
vi.mock("../native/voiceRecordingAudio", () => ({
  configureMusicFriendlyVoiceRecording: vi.fn(async () => {
    audio.steps.push("route:built-in-mic");
  }),
  clearVoiceRecordingInput: vi.fn(async () => {
    audio.steps.push("route:clear");
  }),
}));

import { acquireAudioSession, activateAudioSession, releaseAudioSession } from "./audioSession";

afterEach(() => {
  audio.steps = [];
});

describe("audio session ownership", () => {
  it("records alongside music on the built-in mic, while playback still takes the session", async () => {
    const recording = acquireAudioSession("recording");
    expect(await activateAudioSession(recording)).toBe(true);
    await releaseAudioSession(recording);
    expect(audio.steps).toEqual([
      "mode:mixWithOthers",
      "route:built-in-mic",
      "active:true",
      "route:clear",
      "mode:recording=false",
      "active:false",
    ]);

    audio.steps = [];
    const playback = acquireAudioSession("playback");
    expect(await activateAudioSession(playback)).toBe(true);
    await releaseAudioSession(playback);
    expect(audio.steps).toEqual(["mode:doNotMix", "active:true"]);
  });
});
