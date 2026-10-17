import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadContextMeterRing } from "../threads/ThreadContextMeterRing";

const EXAMPLE_USED_TOKENS = 64_000;
const EXAMPLE_MAX_TOKENS = 128_000;
const EXAMPLE_FILL = EXAMPLE_USED_TOKENS / EXAMPLE_MAX_TOKENS;

function ComposerPreviewIcon(props: { readonly name: AppSymbolName; readonly send?: boolean }) {
  return (
    <View
      className={
        props.send
          ? "size-8 shrink-0 items-center justify-center rounded-full bg-primary"
          : "size-8 shrink-0 items-center justify-center"
      }
    >
      <SymbolView
        name={props.name}
        size={16}
        tintColorClassName={props.send ? "accent-primary-foreground" : "accent-icon-muted"}
        type="monochrome"
      />
    </View>
  );
}

function ComposerContextPreview(props: { readonly enabled: boolean; readonly expanded?: boolean }) {
  const translator = useMobileInterfaceTranslator();
  const ring = props.enabled ? (
    <View className="size-11 shrink-0 items-center justify-center">
      <ThreadContextMeterRing fill={EXAMPLE_FILL} />
    </View>
  ) : null;

  return (
    <View className="gap-1.5">
      <Text className="text-xs font-t3-medium text-foreground-muted">
        {translator.message(
          props.expanded
            ? "settings.contextMeter.preview.expanded"
            : "settings.contextMeter.preview.singleLine",
        )}
      </Text>
      <View
        className={
          props.expanded
            ? "relative overflow-hidden rounded-[22px] border border-border-subtle bg-card p-1"
            : "min-h-[52px] flex-row items-center overflow-hidden rounded-full border border-border-subtle bg-card p-1"
        }
      >
        {props.expanded ? (
          <View className="min-h-[72px]">
            <View className={props.enabled ? "gap-3 pb-3 pl-3 pr-11 pt-3" : "gap-3 px-3 pb-3 pt-3"}>
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {translator.message("mobile.thread.askAnything")}
              </Text>
              <View className="h-1.5 w-3/5 rounded-full bg-subtle-strong" />
            </View>
          </View>
        ) : (
          <>
            <ComposerPreviewIcon name="plus" />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-muted">
              {translator.message("mobile.thread.askAnything")}
            </Text>
            {ring}
          </>
        )}
        {props.expanded && ring ? <View className="absolute right-0 top-0">{ring}</View> : null}
        <View className="flex-row items-center">
          {props.expanded ? (
            <>
              <ComposerPreviewIcon name="plus" />
              <View className="flex-1" />
            </>
          ) : null}
          <ComposerPreviewIcon name="mic" />
          <ComposerPreviewIcon name="arrow.up" send />
        </View>
      </View>
    </View>
  );
}

export function ContextWindowMeterSettingsPreview(props: {
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly onValueChange: (enabled: boolean) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const label = translator.message("settings.contextMeter.label");
  const description = translator.message("settings.contextMeter.description");
  const example = translator.message("settings.contextMeter.preview.example", {
    used: translator.number(EXAMPLE_USED_TOKENS),
    limit: translator.number(EXAMPLE_MAX_TOKENS),
    percentage: translator.number(EXAMPLE_FILL, { style: "percent", maximumFractionDigits: 0 }),
  });

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-base font-t3-medium text-foreground">{label}</Text>
        <Text className="text-sm leading-normal text-foreground-muted">{description}</Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-3"
      >
        {[false, true].map((enabled) => {
          const selected = props.enabled === enabled;
          const choiceLabel = translator.message(
            enabled ? "settings.contextMeter.preview.on" : "settings.contextMeter.preview.off",
          );

          return (
            <Pressable
              key={String(enabled)}
              accessible
              accessibilityRole="radio"
              accessibilityLabel={choiceLabel}
              accessibilityHint={`${description} ${example}`}
              accessibilityState={{ checked: selected, disabled: props.disabled }}
              disabled={props.disabled}
              onPress={() => {
                if (!props.disabled && !selected) props.onValueChange(enabled);
              }}
              className={`min-h-11 min-w-0 gap-3 rounded-[24px] border-2 p-3 active:opacity-70 ${selected ? "border-primary bg-subtle" : "border-border bg-grouped-card"} ${props.disabled ? "opacity-45" : ""}`}
              style={{ flexBasis: 280, flexGrow: 1, flexShrink: 1 }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                className="gap-3"
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className={
                      selected
                        ? "text-base font-t3-semibold text-foreground"
                        : "text-base text-foreground-muted"
                    }
                  >
                    {choiceLabel}
                  </Text>
                  <SymbolView
                    name={selected ? "checkmark.circle" : "circle"}
                    size={20}
                    tintColorClassName={selected ? "accent-primary" : "accent-icon-muted"}
                    type="monochrome"
                  />
                </View>
                <ComposerContextPreview enabled={enabled} />
                <ComposerContextPreview enabled={enabled} expanded />
                <Text className="text-xs leading-normal text-foreground-muted">{example}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
