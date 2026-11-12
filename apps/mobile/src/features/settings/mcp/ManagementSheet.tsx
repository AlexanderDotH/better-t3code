import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";

export function ManagementSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onBack?: () => void;
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const translator = useMobileInterfaceTranslator();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!props.busy) (props.onBack ?? props.onClose)();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-sheet"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
      >
        <View className="flex-row items-center gap-2 border-b border-border-subtle px-4 py-3">
          {props.onBack ? (
            <Button
              label={translator.message("mobile.mcp.back")}
              icon="chevron.left"
              tone="text"
              disabled={props.busy}
              onPress={props.onBack}
            />
          ) : null}
          <AppText className="min-w-0 flex-1 text-lg font-t3-semibold text-foreground">
            {props.title}
          </AppText>
          <Button
            label={translator.message("common.close")}
            tone="text"
            disabled={props.busy}
            onPress={props.onClose}
          />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        >
          {props.children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
