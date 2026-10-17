import { describe, expect, it, vi } from "vite-plus/test";

import { requestVoiceMicrophone } from "./voiceMicrophone";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const headset = { kind: "audioinput", deviceId: "headset", label: "AirPods Pro" } as const;
const builtIn = {
  kind: "audioinput",
  deviceId: "built-in",
  label: "MacBook Pro Microphone",
} as const;
function stream() {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }], stop };
}

describe("voice microphone selection", () => {
  it.each([
    "MacBook Pro Microphone",
    "MacBook Air-Mikrofon",
    "Built-in Microphone",
    "Internal Microphone",
    "Microphone Array (Realtek)",
  ])("opens %s directly without activating the Bluetooth microphone", async (label) => {
    const recording = stream();
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => recording);
    const captured = await requestVoiceMicrophone({
      enumerateDevices: async () => [
        { ...headset, deviceId: "default" },
        headset,
        { ...builtIn, label },
      ],
      getUserMedia,
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: { deviceId: { exact: "built-in" } },
    });
    expect(captured).toBe(recording);
    expect(recording.stop).not.toHaveBeenCalled();
  });

  it("releases the permission stream before opening the built-in microphone when names become available", async () => {
    const permissionStream = stream();
    const recording = stream();
    const enumerateDevices = vi
      .fn()
      .mockResolvedValueOnce([{ ...headset, label: "" }])
      .mockResolvedValueOnce([headset, builtIn]);
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (typeof constraints.audio === "object" && constraints.audio.deviceId) {
        expect(permissionStream.stop).toHaveBeenCalledOnce();
        return recording;
      }
      return permissionStream;
    });
    expect(await requestVoiceMicrophone({ enumerateDevices, getUserMedia })).toBe(recording);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(recording.stop).not.toHaveBeenCalled();
  });

  it("reuses the discovered microphone if the browser hides device names between recordings", async () => {
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream());
    const mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValueOnce([builtIn]).mockResolvedValueOnce([]),
      getUserMedia,
    };
    const first = await requestVoiceMicrophone(mediaDevices);
    first.stop();
    await requestVoiceMicrophone(mediaDevices);
    expect(getUserMedia.mock.calls.map(([constraints]) => constraints.audio)).toEqual([
      expect.objectContaining({ deviceId: { exact: "built-in" } }),
      expect.objectContaining({ deviceId: { exact: "built-in" } }),
    ]);
  });

  it("keeps the default microphone when no built-in microphone is reported", async () => {
    const recording = stream();
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => recording);
    expect(
      await requestVoiceMicrophone({ enumerateDevices: async () => [headset], getUserMedia }),
    ).toBe(recording);
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: {
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  });

  it("can still record when device enumeration is unsupported or fails", async () => {
    for (const enumerateDevices of [
      undefined,
      async () => {
        throw new Error("enumeration denied");
      },
    ]) {
      const recording = stream();
      expect(
        await requestVoiceMicrophone({
          ...(enumerateDevices ? { enumerateDevices } : {}),
          getUserMedia: async () => recording,
        }),
      ).toBe(recording);
    }
  });

  it("uses the available default input if the preferred microphone is unplugged before capture", async () => {
    const recording = stream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Device removed", "OverconstrainedError"))
      .mockResolvedValueOnce(recording);
    expect(
      await requestVoiceMicrophone({ enumerateDevices: async () => [builtIn], getUserMedia }),
    ).toBe(recording);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not retry a denied microphone permission on another input", async () => {
    const denied = new DOMException("Permission denied", "NotAllowedError");
    const getUserMedia = vi.fn(async () => {
      throw denied;
    });
    await expect(
      requestVoiceMicrophone({ enumerateDevices: async () => [builtIn], getUserMedia }),
    ).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("never leaves the permission stream open if the replacement microphone fails", async () => {
    const permissionStream = stream();
    const failure = new Error("Microphone busy");
    const enumerateDevices = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([builtIn]);
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(permissionStream)
      .mockRejectedValueOnce(failure);
    await expect(requestVoiceMicrophone({ enumerateDevices, getUserMedia })).rejects.toBe(failure);
    expect(permissionStream.stop).toHaveBeenCalledOnce();
  });

  it("stops a microphone granted after the user cancels its permission request", async () => {
    const permission = deferred<ReturnType<typeof stream>>();
    const requested = deferred<void>();
    const recording = stream();
    const abort = new AbortController();
    const capture = requestVoiceMicrophone(
      {
        getUserMedia: () => {
          requested.resolve();
          return permission.promise;
        },
      },
      abort.signal,
    );
    await requested.promise;
    abort.abort();
    permission.resolve(recording);
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(recording.stop).toHaveBeenCalledOnce();
  });

  it("releases an open microphone immediately when cancelled during device discovery", async () => {
    const revealed = deferred<readonly (typeof builtIn)[]>();
    const discovering = deferred<void>();
    const permissionStream = stream();
    const abort = new AbortController();
    const enumerateDevices = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => {
        discovering.resolve();
        return revealed.promise;
      });
    const getUserMedia = vi.fn(async () => permissionStream);
    const capture = requestVoiceMicrophone({ enumerateDevices, getUserMedia }, abort.signal);
    await discovering.promise;
    abort.abort();
    expect(permissionStream.stop).toHaveBeenCalledOnce();
    revealed.resolve([builtIn]);
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("does not request capture after an already-cancelled start", async () => {
    const abort = new AbortController();
    abort.abort();
    const getUserMedia = vi.fn(async () => stream());
    await expect(requestVoiceMicrophone({ getUserMedia }, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
