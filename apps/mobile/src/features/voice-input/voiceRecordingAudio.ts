import { setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import {
  clearVoiceRecordingInput,
  configureMusicFriendlyVoiceRecording,
} from "../../native/voiceRecordingAudio";

// AVAudioSession is shared by every voice input entry point.
let audioOperation = Promise.resolve();

function runAudioOperation(operation: () => Promise<void>): Promise<void> {
  const result = audioOperation.then(operation);
  audioOperation = result.catch(() => undefined);
  return result;
}

async function releaseAudio(): Promise<void> {
  try {
    try {
      await clearVoiceRecordingInput();
    } finally {
      await setAudioModeAsync({ allowsRecording: false });
    }
  } finally {
    await setIsAudioActiveAsync(false);
  }
}

export function releaseVoiceRecordingAudio(): Promise<void> {
  return runAudioOperation(releaseAudio);
}

export function configureVoiceRecordingAudio(signal?: AbortSignal): Promise<void> {
  return runAudioOperation(async () => {
    signal?.throwIfAborted();
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "mixWithOthers",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      signal?.throwIfAborted();
      await configureMusicFriendlyVoiceRecording();
      signal?.throwIfAborted();
      await setIsAudioActiveAsync(true);
      signal?.throwIfAborted();
    } catch (error) {
      try {
        await releaseAudio();
      } catch {
        // Preserve the setup error while attempting every cleanup step.
      }
      throw error;
    }
  });
}
