import type { ContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { memo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { ContextSheetSize } from "../../components/ContextSheetSize";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { contextMeterPresentation } from "./context-meter-presentation";
import { ThreadContextMeterRing } from "./ThreadContextMeterRing";

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View accessible className="flex-row items-center justify-between gap-4 py-2">
      <Text className="shrink text-sm text-foreground-muted">{props.label}</Text>
      <Text className="shrink text-right text-base font-t3-medium text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

function ContextDetailSheet(props: {
  readonly presentation: ReturnType<typeof contextMeterPresentation>;
  readonly onClose: () => void;
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
                {translator.message("chat.contextMeter.title")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={props.onClose}
                className="min-h-11 min-w-11 items-center justify-center px-3"
              >
                <Text className="text-sm text-foreground">{translator.message("common.done")}</Text>
              </Pressable>
            </View>
            <View className="px-5 pt-3">
              <DetailRow
                label={translator.message("chat.contextMeter.usedTokens")}
                value={props.presentation.usedTokens}
              />
              <DetailRow
                label={translator.message("chat.contextMeter.limit")}
                value={props.presentation.limit}
              />
              <DetailRow
                label={translator.message("chat.contextMeter.percentage")}
                value={props.presentation.percentage}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const ThreadContextMeter = memo(function ThreadContextMeter(props: {
  readonly snapshot: ContextWindowSnapshot;
}) {
  const translator = useMobileInterfaceTranslator();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = contextMeterPresentation(props.snapshot, translator);

  return (
    <>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={presentation.accessibilityLabel}
        onPress={() => setDetailsOpen(true)}
        className="size-11 shrink-0 items-center justify-center active:opacity-60"
      >
        <ThreadContextMeterRing
          fill={presentation.fill}
          critical={presentation.critical}
          unknown={props.snapshot.usedPercentage === null}
        />
      </Pressable>
      {detailsOpen ? (
        <ContextDetailSheet presentation={presentation} onClose={() => setDetailsOpen(false)} />
      ) : null}
    </>
  );
});
