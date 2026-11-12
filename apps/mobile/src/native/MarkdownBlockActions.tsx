import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../components/ui/AppText";
import { SymbolView } from "../components/ui/AppSymbol";
import { Menu } from "../components/ui/Menu";
import { copyTextWithHaptic } from "../lib/copyTextWithHaptic";
import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";
import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { NativeScrollView } from "./NativeScrollViewMarker";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

export function MarkdownTableActions(props: {
  readonly markdown: string;
  readonly csv: string;
  readonly textProps: SelectableMarkdownTextProps;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const actions = [
    { id: "expand", title: translator.message("mobile.timeline.expandTable") },
    { id: "markdown", title: translator.message("mobile.timeline.copyMarkdown") },
    { id: "csv", title: translator.message("mobile.timeline.copyCsv") },
  ];
  const table = <MobileEnrichedMarkdownText {...props.textProps} markdown={props.markdown} />;
  return (
    <View className="my-2 min-w-0">
      <View className="flex-row justify-end">
        <Menu
          actions={actions}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "expand") setExpanded(true);
            if (nativeEvent.event === "markdown") copyTextWithHaptic(props.markdown);
            if (nativeEvent.event === "csv") copyTextWithHaptic(props.csv);
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translator.message("mobile.timeline.expandTable")}
            className="min-h-11 flex-row items-center gap-2 px-3"
          >
            <SymbolView name="doc.text" size={16} />
            <SymbolView name="ellipsis" size={14} />
          </Pressable>
        </Menu>
      </View>
      {table}
      {expanded ? (
        <Modal
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setExpanded(false)}
        >
          <View
            className="flex-1 bg-sheet"
            style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
          >
            <View className="flex-row items-center justify-end gap-3 px-3 py-2">
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center px-2"
                onPress={() => copyTextWithHaptic(props.markdown)}
              >
                <AppText className="text-sm text-foreground">
                  {translator.message("mobile.timeline.copyMarkdown")}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center px-2"
                onPress={() => copyTextWithHaptic(props.csv)}
              >
                <AppText className="text-sm text-foreground">
                  {translator.message("mobile.timeline.copyCsv")}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={translator.message("mobile.timeline.close")}
                className="size-11 items-center justify-center"
                onPress={() => setExpanded(false)}
              >
                <SymbolView name="xmark" size={18} />
              </Pressable>
            </View>
            <NativeScrollView contentContainerStyle={{ padding: 16 }}>
              <MobileEnrichedMarkdownText {...props.textProps} markdown={props.markdown} />
            </NativeScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function MarkdownTerminalAction(props: {
  readonly markdown: string;
  readonly command: string;
  readonly textProps: SelectableMarkdownTextProps;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translator.message("mobile.timeline.runTerminal")}
        className="min-h-11 flex-row items-center justify-end gap-2 px-3"
        onPress={() => props.textProps.onRunCommand?.(props.command)}
      >
        <SymbolView name="terminal" size={16} />
        <AppText className="text-sm text-foreground-secondary">
          {translator.message("mobile.timeline.runTerminal")}
        </AppText>
      </Pressable>
      <MobileEnrichedMarkdownText {...props.textProps} markdown={props.markdown} />
    </View>
  );
}
