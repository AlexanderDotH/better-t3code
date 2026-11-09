import { useRef, useState, type ReactNode } from "react";
import { Keyboard, type TextInputInstance, View } from "react-native";

import {
  AndroidHeaderIconButton,
  AndroidScreenHeader,
} from "../../components/ui/AndroidScreenHeader";
import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { SearchField } from "../../components/ui/SearchField";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { useHardwareBack } from "../../lib/backHandler";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function FilesHeader(props: {
  readonly projectName: string;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onRefresh: () => void;
  readonly onBack?: () => void;
  readonly leading?: ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const { paddingTop, paddingBottom } = useToolbarLayout();
  const searchRef = useRef<TextInputInstance>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const { onSearchQueryChange } = props;
  const closeSearch = () => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  };

  useHardwareBack(searching, () => {
    closeSearch();
    return true;
  });

  return (
    <View>
      {}
      <View
        pointerEvents={searching ? "none" : "auto"}
        accessibilityElementsHidden={searching}
        importantForAccessibility={searching ? "no-hide-descendants" : "auto"}
        style={{ opacity: searching ? 0 : 1 }}
      >
        <AndroidScreenHeader
          title={translator.message("mobile.files.title")}
          subtitle={props.projectName}
          hideBottomBorder
          onBack={props.onBack}
          leading={props.leading}
          actions={[
            {
              accessibilityLabel: translator.message("mobile.files.search"),
              icon: "magnifyingglass",
              onPress: () => setSearchOpen(true),
            },
          ]}
          trailing={
            <AndroidAnchoredMenu
              title={translator.message("mobile.ui.fileOptions")}
              actions={[{ id: "refresh", title: translator.message("mobile.files.refresh") }]}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "refresh") props.onRefresh();
              }}
            >
              {(open) => (
                <AndroidHeaderIconButton
                  accessibilityLabel={translator.message("mobile.ui.fileOptions")}
                  icon="ellipsis"
                  onPress={open}
                />
              )}
            </AndroidAnchoredMenu>
          }
        />
      </View>
      {searching ? (
        <View className="absolute inset-0 bg-header px-2" style={{ paddingTop, paddingBottom }}>
          <View className="flex-1 flex-row items-center gap-1">
            <AndroidHeaderIconButton
              accessibilityLabel={translator.message("mobile.ui.closeFileSearch")}
              icon="arrow.left"
              onPress={closeSearch}
            />
            <SearchField
              inputRef={searchRef}
              accessibilityLabel={translator.message("mobile.files.search")}
              clearAccessibilityLabel={translator.message("mobile.ui.clearFileSearch")}
              placeholder={translator.message("mobile.files.search")}
              value={props.searchQuery}
              onChangeText={onSearchQueryChange}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
