import type { ReactNode } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function AccessSheet(props: {
  readonly title: string;
  readonly busy?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const translator = useMobileInterfaceTranslator();
  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <ScrollView
        className="flex-1 bg-sheet-solid"
        contentContainerClassName="gap-4 px-5"
        contentContainerStyle={{
          paddingTop: (Platform.OS === "android" ? insets.top : 0) + 20,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between gap-3">
          <AppText className="min-w-0 flex-1 text-lg font-t3-bold text-foreground">
            {props.title}
          </AppText>
          <Button
            label={translator.message("common.cancel")}
            tone="text"
            disabled={props.busy}
            onPress={props.onClose}
          />
        </View>
        {props.children}
      </ScrollView>
    </Modal>
  );
}
