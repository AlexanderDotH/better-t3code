import { CommonActions, useNavigation, useRoute } from "@react-navigation/native";
import { use, type ComponentProps } from "react";
import { Platform } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BetterT3SettingsCategoryId } from "@t3tools/client-runtime/better-t3-settings-layout";

import { ListRow } from "../../../components/ui/ListRow";
import { ListRowLayout } from "../../../components/ui/ListRowLayout";
import { RowPressable } from "../../../components/ui/RowPressable";
import { cn } from "../../../lib/cn";
import {
  settingsIndexRowId,
  type SettingsLegalDocumentTarget,
  type SettingsPageTarget,
} from "./settings-page-targets";
import { SettingsSidebarContext } from "./SettingsSection";
import { openSettings } from "../settings-navigation";

type SettingsRowProps = {
  readonly disabled?: boolean;
  readonly icon: ComponentProps<typeof ListRow>["icon"];
  readonly label: string;
  readonly value?: string;
  readonly valuePosition?: "below" | "trailing";
  readonly fullScreenTarget?: SettingsLegalDocumentTarget;
  readonly onPress?: () => void;
} & (
  | {
      readonly target: "SettingsBetterT3Category";
      readonly params: {
        readonly category: BetterT3SettingsCategoryId;
        readonly environmentId?: EnvironmentId;
      };
    }
  | { readonly target?: SettingsPageTarget; readonly params?: never }
);

export function SettingsRow(props: SettingsRowProps) {
  const navigation = useNavigation();
  const sidebar = use(SettingsSidebarContext);
  // The Settings list opens pages in place of the detail column; a page's own rows push below.
  const inList = ["Home", "Settings"].includes(useRoute().name);
  const valueBelow =
    props.valuePosition === "below" ||
    (props.valuePosition === undefined && Platform.OS === "android");
  const content = {
    icon: props.icon,
    label: props.label,
    description: valueBelow ? props.value : undefined,
    detail: valueBelow ? undefined : props.value,
    disabled: props.disabled,
  };
  const onPress = () => {
    if (props.target === "SettingsBetterT3Category") {
      if (inList) openSettings(navigation, props.target, props.params);
      else navigation.navigate(props.target, props.params);
    } else if (props.target) {
      if (inList) openSettings(navigation, props.target);
      else navigation.dispatch(CommonActions.navigate(props.target));
    } else if (props.fullScreenTarget) {
      navigation.navigate(props.fullScreenTarget);
    } else {
      props.onPress?.();
    }
  };
  if (sidebar) {
    const selected =
      props.target !== undefined &&
      settingsIndexRowId({ name: props.target, params: props.params }) === sidebar.selected;
    return (
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={[props.label, props.value].filter(Boolean).join(", ")}
        accessibilityState={{ disabled: Boolean(props.disabled), selected }}
        disabled={props.disabled}
        onPress={onPress}
        className={cn("rounded-2xl", selected && "bg-subtle-strong")}
      >
        <ListRowLayout {...content} />
      </RowPressable>
    );
  }
  return <ListRow {...content} onPress={onPress} />;
}
