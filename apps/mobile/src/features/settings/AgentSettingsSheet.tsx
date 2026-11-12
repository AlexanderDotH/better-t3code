import type { ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function AgentSettingsSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onSave?: () => void;
  readonly saveDisabled?: boolean;
  readonly contentKey?: string;
  readonly closeDisabled?: boolean;
  readonly children: ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!props.closeDisabled) props.onClose();
      }}
    >
      <View
        className="flex-1 bg-sheet"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
      >
        <View className="flex-row items-center gap-3 border-b border-border px-5 py-4">
          <Pressable
            accessibilityRole="button"
            disabled={props.closeDisabled}
            onPress={props.onClose}
            className="py-2"
          >
            <Text className="text-foreground">
              {translator.message(props.onSave ? "common.cancel" : "common.close")}
            </Text>
          </Pressable>
          <Text className="min-w-0 flex-1 text-lg font-t3-semibold text-foreground">
            {props.title}
          </Text>
          {props.onSave ? (
            <Pressable
              accessibilityRole="button"
              disabled={props.saveDisabled}
              onPress={props.onSave}
              className="py-2 disabled:opacity-40"
            >
              <Text className="font-t3-medium text-foreground">
                {translator.message("common.done")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          key={props.contentKey}
          keyboardShouldPersistTaps="handled"
          className="flex-1"
          contentContainerClassName="gap-4 p-5"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {props.children}
        </ScrollView>
      </View>
    </Modal>
  );
}
