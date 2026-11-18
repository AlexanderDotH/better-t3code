import { ActivityIndicator, View } from "react-native";
import { useEffect } from "react";
import IconHourglass from "@tabler/icons-react-native/IconHourglass";
import { isAssemblyAiDictationProcessing } from "@t3tools/client-runtime/assembly-ai";
import { withUniwind } from "uniwind";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { ComposerToolbarButton } from "../../components/ComposerToolbar";
import { useAppActive, useReduceMotionEnabled } from "../../lib/appState";
import type { NativeVoiceDictationState } from "./use-native-assembly-ai-dictation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const HourglassIcon = withUniwind(IconHourglass);
const HOURGLASS_TURN_MS = 360;
const HOURGLASS_PAUSE_MS = 840;

function ProcessingHourglass() {
  const rotation = useSharedValue(0);
  const reducedMotion = useReduceMotionEnabled();
  const appActive = useAppActive();
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the native transform animation only while voice processing is mounted and motion is allowed.
  useEffect(() => {
    if (reducedMotion || !appActive) return;
    rotation.set(
      withRepeat(
        withSequence(
          withTiming(180, {
            duration: HOURGLASS_TURN_MS,
            easing: Easing.inOut(Easing.ease),
            reduceMotion: ReduceMotion.System,
          }),
          withDelay(HOURGLASS_PAUSE_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      ),
    );
    return () => {
      cancelAnimation(rotation);
      rotation.set(0);
    };
  }, [appActive, reducedMotion, rotation]);
  return (
    <Animated.View accessible={false} style={style}>
      <HourglassIcon size={16} colorClassName="accent-icon" />
    </Animated.View>
  );
}

export function NativeVoiceDictationControl(props: {
  readonly state: NativeVoiceDictationState;
  readonly audioWaveform: ReadonlyArray<number>;
  readonly disabled?: boolean;
  readonly onStart: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onCancel: () => void;
  readonly canRestoreOriginal?: boolean;
  readonly onRestoreOriginal?: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  if (props.state === "idle") {
    return (
      <>
        {props.canRestoreOriginal ? (
          <ComposerToolbarButton
            accessibilityLabel={translator.message("chat.composer.voiceRestoreOriginal")}
            disabled={props.disabled}
            icon="arrow.uturn.backward"
            label={translator.message("chat.composer.voiceRestoreOriginal")}
            maxWidth={132}
            onPress={() => props.onRestoreOriginal?.()}
            showChevron={false}
          />
        ) : null}
        <ComposerToolbarButton
          accessibilityLabel={translator.message("mobile.thread.voiceStart")}
          disabled={props.disabled}
          icon="mic"
          onPress={() => void props.onStart()}
          showChevron={false}
        />
      </>
    );
  }

  const peak = props.audioWaveform.reduce((current, level) => Math.max(current, level), 0);
  const processing = isAssemblyAiDictationProcessing(props.state);
  const label =
    props.state === "starting"
      ? translator.message("mobile.thread.voiceConnecting")
      : props.state === "stopping"
        ? translator.message("chat.composer.voiceProcessing")
        : props.state === "interpreting"
          ? translator.message("chat.composer.voiceInterpreting")
          : peak > 0.35
            ? translator.message("mobile.thread.voiceListening")
            : translator.message("mobile.thread.voiceSpeak");
  return (
    <ComposerToolbarButton
      accessibilityLabel={
        processing
          ? `${label}. ${translator.message("mobile.thread.voiceCancel")}`
          : props.state !== "recording"
            ? translator.message("mobile.thread.voiceCancel")
            : translator.message("mobile.thread.voiceStop")
      }
      icon={props.state === "recording" ? "stop.fill" : undefined}
      iconNode={
        processing ? (
          <ProcessingHourglass />
        ) : props.state !== "recording" ? (
          <ActivityIndicator size="small" colorClassName={"accent-danger-foreground"} />
        ) : (
          <View className="h-2.5 w-2.5 rounded-sm bg-white" />
        )
      }
      label={processing ? undefined : label}
      maxWidth={132}
      onPress={() => (props.state === "recording" ? void props.onStop() : props.onCancel())}
      showChevron={false}
      variant={processing ? "default" : "danger"}
    />
  );
}
