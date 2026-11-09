import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SidebarProjectGroupingMode } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsScreen } from "./components/SettingsScreen";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { NewThreadSettingsSection, WorkingSectionSettings } from "./ThreadSettingsSections";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

const GROUPING_OPTIONS: ReadonlyArray<{
  readonly mode: SidebarProjectGroupingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "repository",
    get label() {
      return currentInterfaceTranslator().message("mobile.settings.projectGrouping.repository");
    },
    get description() {
      return currentInterfaceTranslator().message(
        "mobile.settings.projectGrouping.repositoryDescription",
      );
    },
  },
  {
    mode: "repository_path",
    get label() {
      return currentInterfaceTranslator().message("mobile.settings.projectGrouping.path");
    },
    get description() {
      return currentInterfaceTranslator().message(
        "mobile.settings.projectGrouping.pathDescription",
      );
    },
  },
  {
    mode: "separate",
    get label() {
      return currentInterfaceTranslator().message("mobile.settings.projectGrouping.separate");
    },
    get description() {
      return currentInterfaceTranslator().message(
        "mobile.settings.projectGrouping.separateDescription",
      );
    },
  },
];

export function SettingsProjectGroupingRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedMode = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value).sidebarProjectGroupingMode
    : null;

  return (
    <SettingsScreen title={translator.message("mobile.settings.section.general")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title={translator.message("mobile.settings.projectGrouping")}>
          {GROUPING_OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.mode}
              label={option.label}
              description={option.description}
              selected={selectedMode === option.mode}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => savePreferences(mobileProjectGroupingModePatch(option.mode))}
            />
          ))}
        </SettingsSection>
        <WorkingSectionSettings />
        <NewThreadSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}
