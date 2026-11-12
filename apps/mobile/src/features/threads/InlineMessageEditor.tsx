import { useState } from "react";
import { TextInput, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function InlineMessageEditor(props: {
  readonly initialText: string;
  readonly available: boolean;
  readonly onSave: (text: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [text, setText] = useState(props.initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (saving || !props.available) return;
    setSaving(true);
    setError(null);
    await (async () => {
      await props.onSave(text);
      props.onClose();
    })()
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : translator.message("mobile.timeline.editFailed"),
        );
      })
      .finally(() => {
        setSaving(false);
      });
  };
  return (
    <View className="w-full min-w-0 gap-2 rounded-xl border border-border bg-screen p-3">
      <TextInput
        accessibilityLabel={translator.message("mobile.timeline.editMessage")}
        autoFocus
        multiline
        editable={!saving}
        value={text}
        onChangeText={setText}
        className="min-h-24 max-h-80 text-base text-foreground"
        textAlignVertical="top"
      />
      {error ? <AppText className="text-sm text-adaptive-rose-600-400">{error}</AppText> : null}
      <View className="flex-row justify-end gap-2">
        <Button
          tone="text"
          label={translator.message("mobile.timeline.cancel")}
          disabled={saving}
          onPress={props.onClose}
        />
        <Button
          label={translator.message(saving ? "mobile.timeline.saving" : "mobile.timeline.save")}
          disabled={!props.available || saving || !text.trim() || text === props.initialText}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}
