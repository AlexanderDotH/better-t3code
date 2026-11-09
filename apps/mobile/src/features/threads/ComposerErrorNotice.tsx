import { View } from "react-native";
import { Notice } from "../../components/ui/Notice";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ComposerErrorNotice(props: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="px-4 pb-3">
      <Notice
        message={props.message}
        icon="exclamationmark.circle"
        iconTone="danger"
        floating
        onDismiss={props.onDismiss}
        dismissLabel={translator.message("chat.composer.dismissError")}
      />
    </View>
  );
}
