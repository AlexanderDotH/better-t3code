import { getNextComposerMode } from "@t3tools/client-runtime/deep-planning";
import type { ComposerMode } from "@t3tools/contracts";
import { useCallback } from "react";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";

export function ComposerModeControl(props: {
  readonly mode: ComposerMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: ComposerMode) => void;
}) {
  const { mode, disabled, onChange } = props;
  const translator = useMobileInterfaceTranslator();
  const labelForMode = (mode: ComposerMode) =>
    translator.message(
      mode === "chat"
        ? "chat.composer.mode.chat"
        : mode === "deep-plan"
          ? "chat.deepPlan.label"
          : mode === "plan"
            ? "chat.composer.mode.plan"
            : "chat.composer.interaction.build",
    );
  const nextMode = getNextComposerMode(props.mode);
  const cycleMode = useCallback(() => {
    if (disabled) return false;
    onChange(getNextComposerMode(mode));
    return true;
  }, [disabled, mode, onChange]);
  useHardwareKeyboardCommand("cycleComposerMode", cycleMode);
  return (
    <ComposerInlineControl
      accessibilityHint={translator.message("chat.deepPlan.cycleMode", {
        mode: labelForMode(nextMode),
      })}
      accessibilityLabel={translator.message("chat.deepPlan.modeLabel", {
        mode: labelForMode(props.mode),
      })}
      disabled={props.disabled}
      emphasized
      icon={
        props.mode === "chat"
          ? { ios: "bubble.left.and.bubble.right", android: "chat_bubble" }
          : props.mode === "default"
            ? { ios: "hammer", android: "construction" }
            : { ios: "list.bullet.clipboard", android: "auto_awesome" }
      }
      label={labelForMode(props.mode)}
      onPress={cycleMode}
      showChevron={false}
    />
  );
}
