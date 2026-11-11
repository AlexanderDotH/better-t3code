import { useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ContextSheetSize } from "../../components/ContextSheetSize";
import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

/** A titled sheet sized to its content, for details opened from a chat control. */
export function ThreadDetailSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState(0);
  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "android" ? "overFullScreen" : "pageSheet"}
      transparent={Platform.OS === "android"}
      onRequestClose={props.onClose}
      onDismiss={props.onClose}
    >
      <View className={Platform.OS === "android" ? "flex-1 justify-end bg-backdrop" : "flex-1"}>
        {Platform.OS === "android" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translator.message("common.close")}
            onPress={props.onClose}
            className="absolute inset-0"
          />
        ) : null}
        <View
          className="overflow-hidden rounded-t-3xl bg-sheet-solid"
          style={
            Platform.OS === "android" ? { maxHeight: windowHeight - insets.top - 24 } : { flex: 1 }
          }
        >
          <ContextSheetSize height={contentHeight} />
          <ScrollView
            accessibilityViewIsModal
            onContentSizeChange={(_width, height) => setContentHeight(height)}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row items-center justify-between gap-3 border-b border-border pl-5 pr-2 pt-2">
              <Text
                accessibilityRole="header"
                className="flex-1 text-lg font-t3-semibold text-foreground"
              >
                {props.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={props.onClose}
                className="min-h-11 min-w-11 items-center justify-center px-3"
              >
                <Text className="text-sm text-foreground">{translator.message("common.done")}</Text>
              </Pressable>
            </View>
            <View className="px-5 pt-3">{props.children}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
