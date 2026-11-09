import { Button } from "../../components/ui/Button";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ThreadCreationFailedCard(props: {
  readonly reason: string;
  readonly onEditTask: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-2.5 rounded-[20px] border border-border-subtle bg-card-alt p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-danger-foreground">
        {translator.message("mobile.ui.couldNotStartTask")}
      </Text>
      <Text className="font-sans text-sm leading-normal text-foreground-secondary">
        {props.reason}
      </Text>
      <Text className="font-sans text-xs leading-normal text-foreground-secondary">
        {translator.message("mobile.ui.yourPromptWasKeptInTheProject")}
      </Text>
      <View className="flex-row">
        <Button
          label={translator.message("mobile.ui.editTask")}
          tone="primary"
          onPress={props.onEditTask}
        />
      </View>
    </View>
  );
}
