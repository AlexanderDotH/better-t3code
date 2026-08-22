import { ActivityIndicator, View } from "react-native";

import { ComposerToolbarButton } from "../../components/ComposerToolbar";
import { useThemeColor } from "../../lib/useThemeColor";
import type { NativeVoiceDictationState } from "./use-native-assembly-ai-dictation";

export function NativeVoiceDictationControl(props: {
  readonly state: NativeVoiceDictationState;
  readonly audioWaveform: ReadonlyArray<number>;
  readonly disabled?: boolean;
  readonly onStart: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onCancel: () => void;
}) {
  const dangerColor = useThemeColor("--color-danger-foreground");
  if (props.state === "idle") {
    return (
      <ComposerToolbarButton
        accessibilityLabel="Start voice input"
        disabled={props.disabled}
        icon="mic"
        onPress={() => void props.onStart()}
        showChevron={false}
      />
    );
  }

  const peak = props.audioWaveform.reduce((current, level) => Math.max(current, level), 0);
  const label =
    props.state === "starting"
      ? "Connecting"
      : props.state === "stopping"
        ? "Stopping"
        : peak > 0.35
          ? "Listening"
          : "Speak now";
  return (
    <ComposerToolbarButton
      accessibilityLabel={
        props.state === "starting" ? "Cancel voice input connection" : "Stop voice input"
      }
      disabled={props.state === "stopping"}
      icon={props.state === "recording" ? "stop.fill" : undefined}
      iconNode={
        props.state === "starting" || props.state === "stopping" ? (
          <ActivityIndicator size="small" color={String(dangerColor)} />
        ) : (
          <View className="h-2.5 w-2.5 rounded-sm bg-white" />
        )
      }
      label={label}
      maxWidth={132}
      onPress={() => (props.state === "starting" ? props.onCancel() : void props.onStop())}
      showChevron={false}
      variant="danger"
    />
  );
}
