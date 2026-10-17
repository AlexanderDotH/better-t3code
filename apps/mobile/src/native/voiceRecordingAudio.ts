import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

interface VoiceRecordingAudioModule {
  readonly configureVoiceRecordingAudio?: () => Promise<void>;
  readonly clearVoiceRecordingInput?: () => Promise<void>;
}

const nativeModule =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<VoiceRecordingAudioModule>("T3NativeControls")
    : null;

export async function configureMusicFriendlyVoiceRecording(): Promise<void> {
  await nativeModule?.configureVoiceRecordingAudio?.();
}

export async function clearVoiceRecordingInput(): Promise<void> {
  await nativeModule?.clearVoiceRecordingInput?.();
}
