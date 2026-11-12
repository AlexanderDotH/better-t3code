import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function AssistantQuoteComment(props: {
  readonly citation: AssistantCitation;
  readonly onInsert: (comment: string) => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState("");
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          className="flex-1 gap-4 bg-sheet px-5 py-4"
          style={{
            paddingTop: (Platform.OS === "android" ? insets.top : 0) + 16,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <AppText className="text-xl font-t3-semibold text-foreground">
            {translator.message("mobile.timeline.comment")}
          </AppText>
          <AppText
            numberOfLines={6}
            className="rounded-xl bg-subtle p-3 text-sm text-foreground-secondary"
          >
            {props.citation.text}
          </AppText>
          <TextInput
            autoFocus
            multiline
            maxLength={ASSISTANT_CITATION_MAX_COMMENT_LENGTH}
            accessibilityLabel={translator.message("mobile.timeline.comment")}
            placeholder={translator.message("mobile.timeline.commentPlaceholder")}
            value={comment}
            onChangeText={setComment}
            className="min-h-28 rounded-xl border border-border bg-input p-3 text-base text-foreground"
            textAlignVertical="top"
          />
          <View className="flex-row justify-end gap-2">
            <Button
              label={translator.message("mobile.timeline.cancel")}
              tone="text"
              onPress={props.onClose}
            />
            <Button
              label={translator.message("mobile.timeline.insertQuote")}
              onPress={() => props.onInsert(comment)}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
