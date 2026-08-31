import { SymbolView } from "../../components/AppSymbol";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function WorkspaceEmptyDetail(props: { readonly onStartNewTask?: () => void }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="flex-1 items-center justify-center bg-screen px-10">
      <View className="max-w-[360px] items-center gap-3">
        <SymbolView
          name="sidebar.left"
          size={34}
          tintColorClassName={"accent-icon-subtle"}
          type="hierarchical"
        />
        <Text className="text-center text-xl font-t3-bold">
          {translator.message("mobile.layout.selectThread")}
        </Text>
        <Text className="text-center text-base text-foreground-muted">
          {translator.message("mobile.layout.selectThreadDescription")}
        </Text>
        {props.onStartNewTask ? (
          <Pressable
            accessibilityRole="button"
            className="mt-2 flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 active:opacity-70"
            onPress={props.onStartNewTask}
          >
            <Text className="text-base font-t3-bold text-primary-foreground">
              {translator.message("mobile.navigation.newTask")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
