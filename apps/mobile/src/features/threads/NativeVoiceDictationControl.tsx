import { ActivityIndicator, View } from "react-native";

import { ComposerToolbarButton } from "../../components/ComposerToolbar";
import type { NativeVoiceDictationState } from "./use-native-assembly-ai-dictation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function NativeVoiceDictationControl(props: {
  readonly state: NativeVoiceDictationState;
  readonly audioWaveform: ReadonlyArray<number>;
  readonly disabled?: boolean;
  readonly onStart: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onCancel: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  if (props.state === "idle") {
    return (
      <ComposerToolbarButton
        accessibilityLabel={translator.message("mobile.thread.voiceStart")}
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
      ? translator.message("mobile.thread.voiceConnecting")
      : props.state === "stopping"
        ? translator.message("mobile.thread.voiceStopping")
        : peak > 0.35
          ? translator.message("mobile.thread.voiceListening")
          : translator.message("mobile.thread.voiceSpeak");
  return (
    <ComposerToolbarButton
      accessibilityLabel={
        props.state === "starting"
          ? translator.message("mobile.thread.voiceCancel")
          : translator.message("mobile.thread.voiceStop")
      }
      disabled={props.state === "stopping"}
      icon={props.state === "recording" ? "stop.fill" : undefined}
      iconNode={
        props.state === "starting" || props.state === "stopping" ? (
          <ActivityIndicator size="small" colorClassName={"accent-danger-foreground"} />
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
