import type { ReactNode } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function InsightsSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const translator = useMobileInterfaceTranslator();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View
        className="flex-1 bg-screen"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
      >
        <View className="flex-row items-center gap-3 border-b border-border-subtle p-4">
          <AppText className="min-w-0 flex-1 text-lg font-t3-semibold text-foreground">
            {props.title}
          </AppText>
          <Button
            label={translator.message("settings.common.close")}
            tone="text"
            onPress={props.onClose}
          />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 p-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {props.children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function InsightValue(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-2">
      <AppText className="min-w-0 flex-1 text-sm text-foreground-muted">{props.label}</AppText>
      <AppText selectable className="max-w-[65%] text-right text-sm tabular-nums text-foreground">
        {props.value}
      </AppText>
    </View>
  );
}
