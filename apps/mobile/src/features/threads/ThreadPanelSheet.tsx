import type { ReactNode } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetHeader } from "../../components/ui/SheetHeader";

export function ThreadPanelSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View
        className="flex-1 bg-sheet"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
      >
        <SheetHeader title={props.title} onClose={props.onClose} presentation="inline" />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 px-4 py-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {props.children}
        </ScrollView>
      </View>
    </Modal>
  );
}
