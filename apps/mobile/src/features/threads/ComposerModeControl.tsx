import type { ComposerMode } from "@t3tools/contracts";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ThreadDetailSheet } from "./ThreadDetailSheet";
import { nextAvailableComposerMode } from "./composer-mode-availability";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";

export function ComposerModeControl(props: {
  readonly mode: ComposerMode;
  readonly disabled?: boolean;
  readonly iconOnly?: boolean;
  readonly size?: "regular" | "large";
  readonly onChange: (mode: ComposerMode) => void;
  readonly unavailable?: Readonly<Partial<Record<ComposerMode, string | null>>>;
}) {
  const { mode, disabled, onChange } = props;
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
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
  const cycleMode = useCallback(() => {
    if (disabled) return false;
    onChange(nextAvailableComposerMode(mode, props.unavailable));
    return true;
  }, [disabled, mode, onChange, props.unavailable]);
  useHardwareKeyboardCommand("cycleComposerMode", cycleMode);
  return (
    <>
      <ComposerInlineControl
        accessibilityHint={translator.message("mobile.composer.modeMenuHint")}
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
              : props.mode === "deep-plan"
                ? { ios: "list.bullet.clipboard.fill", android: "auto_awesome" }
                : { ios: "list.bullet.clipboard", android: "auto_awesome" }
        }
        iconOnly={props.iconOnly}
        label={labelForMode(props.mode)}
        onPress={() => setOpen(true)}
        showChevron
        size={props.size}
      />
      {open ? (
        <ThreadDetailSheet
          title={translator.message("mobile.composer.modeTitle")}
          onClose={() => setOpen(false)}
        >
          <View accessibilityRole="radiogroup">
            {(["default", "plan", "deep-plan", "chat"] as const).map((choice) => {
              const unavailable = props.unavailable?.[choice];
              return (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  accessibilityLabel={labelForMode(choice)}
                  accessibilityState={{
                    checked: mode === choice,
                    disabled: disabled || Boolean(unavailable),
                  }}
                  disabled={disabled || Boolean(unavailable)}
                  className="min-h-14 flex-row items-center gap-3 border-b border-border py-3 disabled:opacity-50"
                  onPress={() => {
                    onChange(choice);
                    setOpen(false);
                  }}
                >
                  <SymbolView
                    name={mode === choice ? "checkmark.circle" : "circle"}
                    size={20}
                    tintColorClassName="accent-icon"
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-base font-t3-medium text-foreground">
                      {labelForMode(choice)}
                    </Text>
                    <Text className="text-sm text-foreground-muted">
                      {unavailable ??
                        translator.message(
                          choice === "default"
                            ? "mobile.composer.buildDescription"
                            : choice === "plan"
                              ? "mobile.composer.planDescription"
                              : choice === "deep-plan"
                                ? "mobile.composer.deepPlanDescription"
                                : "mobile.composer.chatDescription",
                        )}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ThreadDetailSheet>
      ) : null}
    </>
  );
}
