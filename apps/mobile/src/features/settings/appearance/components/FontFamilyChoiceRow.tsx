import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../../../components/ui/AppText";
import { Button } from "../../../../components/ui/Button";
import { ScreenScrollView } from "../../../../components/ui/ScreenScrollView";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsRow } from "../../components/SettingsRow";
import { mobileFontOptions, type MobileFontPreferenceKey } from "../mobileFontPreferences";

export function FontFamilyChoiceRow(props: { readonly preferenceKey: MobileFontPreferenceKey }) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const result = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(result) && !result.waiting;
  const selected = AsyncResult.isSuccess(result) ? (result.value[props.preferenceKey] ?? "") : "";
  const fonts = mobileFontOptions(
    Platform.OS,
    props.preferenceKey === "fontFamilyCode" || props.preferenceKey === "fontFamilyTerminal",
  );
  const label = translator.message(`mobile.prefs.${props.preferenceKey}`);
  const fontLabel = (font: (typeof fonts)[number]) =>
    font.label ??
    translator.message(
      font.value === "sans-serif"
        ? "mobile.prefs.systemSans"
        : font.value === "serif"
          ? "mobile.prefs.systemSerif"
          : font.value === "monospace"
            ? "mobile.prefs.systemMonospace"
            : "mobile.prefs.defaultFont",
    );
  const current = fonts.find((font) => font.value === selected) ?? fonts[0]!;
  return (
    <>
      <SettingsRow
        icon="textformat.size"
        label={label}
        value={fontLabel(current)}
        disabled={!ready}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View
          className="flex-1 bg-sheet"
          style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
        >
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-lg">{label}</Text>
            <Button
              label={translator.message("common.done")}
              tone="text"
              onPress={() => setOpen(false)}
            />
          </View>
          <ScreenScrollView
            contentContainerClassName="px-5"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          >
            {fonts.map((font) => (
              <Pressable
                key={font.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected === font.value, disabled: !ready }}
                disabled={!ready}
                className="flex-row items-center justify-between gap-3 border-b border-border-subtle p-4"
                onPress={() => {
                  save({ [props.preferenceKey]: font.value });
                  setOpen(false);
                }}
              >
                <Text className="min-w-0 flex-1" style={{ fontFamily: font.family }}>
                  {fontLabel(font)}
                </Text>
                {selected === font.value ? <Text>✓</Text> : null}
              </Pressable>
            ))}
          </ScreenScrollView>
        </View>
      </Modal>
    </>
  );
}
