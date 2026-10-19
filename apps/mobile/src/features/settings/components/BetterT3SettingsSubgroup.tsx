import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";

export function BetterT3SettingsSubgroup(props: {
  readonly title: string;
  readonly summary?: string;
  readonly collapsible?: boolean;
  readonly expanded?: boolean;
  readonly showTitle?: boolean;
  readonly onExpandedChange?: (expanded: boolean) => void;
  readonly children: ReactNode;
}) {
  const open = !props.collapsible || props.expanded === true;
  const [hasOpened, setHasOpened] = useState(open);

  if (open && !hasOpened) setHasOpened(true);

  return (
    <View className="gap-1">
      {props.collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.title}
          accessibilityValue={props.summary ? { text: props.summary } : undefined}
          accessibilityState={{ expanded: open }}
          className="min-h-11 flex-row items-center gap-2 px-1 py-2"
          onPress={() => props.onExpandedChange?.(!open)}
        >
          <SymbolView
            name={open ? "chevron.down" : "chevron.right"}
            size={13}
            tintColorClassName="accent-foreground-muted"
          />
          <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <Text className="text-sm font-t3-medium text-foreground">{props.title}</Text>
            {props.summary ? (
              <Text className="min-w-0 shrink text-sm text-foreground-muted">{props.summary}</Text>
            ) : null}
          </View>
        </Pressable>
      ) : props.showTitle !== false ? (
        <Text
          accessibilityRole="header"
          className="px-1 text-sm font-t3-medium text-foreground-muted"
        >
          {props.title}
        </Text>
      ) : null}
      {hasOpened ? (
        <View
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          pointerEvents={open ? "auto" : "none"}
          className="ml-1 border-l border-border pl-2"
          style={open ? undefined : { display: "none" }}
        >
          {props.children}
        </View>
      ) : null}
    </View>
  );
}
