export interface VoiceMicrophoneStream {
  readonly getTracks: () => readonly { readonly stop: () => void }[];
}

interface VoiceMicrophoneDevice {
  readonly kind: MediaDeviceKind;
  readonly deviceId: string;
  readonly label: string;
}

interface VoiceMicrophoneDevices<Stream extends VoiceMicrophoneStream> {
  readonly enumerateDevices?: () => Promise<readonly VoiceMicrophoneDevice[]>;
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<Stream>;
}

const knownBuiltInMicrophones = new WeakMap<object, string>();

const VOICE_AUDIO_CONSTRAINTS = {
  autoGainControl: true,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
} satisfies MediaTrackConstraints;

function builtInMicrophone(devices: readonly VoiceMicrophoneDevice[], missingDeviceId?: string) {
  return devices.find(
    (device) =>
      device.kind === "audioinput" &&
      device.deviceId !== "" &&
      device.deviceId !== missingDeviceId &&
      device.deviceId !== "default" &&
      device.deviceId !== "communications" &&
      /\b(?:built[- ]in|internal|integriert|eingebaut|internes|MacBook|iMac|microphone array|mikrofonarray)\b/i.test(
        device.label,
      ),
  );
}

/** Select before capture so Bluetooth playback can stay in its music profile. */
export async function requestVoiceMicrophone<Stream extends VoiceMicrophoneStream>(
  mediaDevices: VoiceMicrophoneDevices<Stream>,
  signal?: AbortSignal,
): Promise<Stream> {
  let ownedStream: Stream | null = null;
  const release = () => {
    const stream = ownedStream;
    ownedStream = null;
    stream?.getTracks().forEach((track) => track.stop());
  };
  const checkAborted = () => {
    if (signal?.aborted) throw new DOMException("Voice input was cancelled.", "AbortError");
  };
  const enumerate = async () => {
    try {
      return (await mediaDevices.enumerateDevices?.()) ?? [];
    } catch {
      return [];
    }
  };
  const capture = async (deviceId?: string) => {
    ownedStream = await mediaDevices.getUserMedia({
      audio: {
        ...VOICE_AUDIO_CONSTRAINTS,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    checkAborted();
  };
  signal?.addEventListener("abort", release, { once: true });
  try {
    checkAborted();
    const devices = await enumerate();
    let selectedId =
      builtInMicrophone(devices)?.deviceId ??
      (devices.every((device) => device.label === "")
        ? knownBuiltInMicrophones.get(mediaDevices)
        : undefined);
    checkAborted();
    let missingDeviceId: string | undefined;
    try {
      await capture(selectedId);
    } catch (error) {
      const missingDevice =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error.name === "NotFoundError" || error.name === "OverconstrainedError");
      if (!selectedId || !missingDevice) throw error;
      knownBuiltInMicrophones.delete(mediaDevices);
      missingDeviceId = selectedId;
      selectedId = builtInMicrophone(await enumerate(), missingDeviceId)?.deviceId;
      checkAborted();
      await capture(selectedId);
    }

    if (!selectedId) {
      // Browsers may hide names until the first microphone permission grant.
      const revealed = builtInMicrophone(await enumerate(), missingDeviceId);
      checkAborted();
      if (revealed) {
        release();
        await capture(revealed.deviceId);
        selectedId = revealed.deviceId;
      }
    }
    if (selectedId) knownBuiltInMicrophones.set(mediaDevices, selectedId);
    const stream = ownedStream;
    if (!stream) throw new DOMException("Voice input was cancelled.", "AbortError");
    ownedStream = null;
    return stream;
  } finally {
    signal?.removeEventListener("abort", release);
    release();
  }
}
