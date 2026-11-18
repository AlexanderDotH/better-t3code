import {
  navigationCustomizationAvailable,
  overflowNavigationTabs,
} from "../workspace/navigation-tab-order";
import {
  NAVIGATION_TAB_ICONS,
  useWorkspaceTabLabels,
  useNavigationTabOrder,
  useHiddenNavigationTabs,
} from "../workspace/navigation-tabs";
import { currentWorkspaceSelections } from "../workspace/workspace-selection-store";
import { rememberedSettingsPage } from "../workspace/workspace-tab-navigation";
import { useSelectWorkspaceTab } from "../workspace/useSelectWorkspaceTab";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { EmptyState } from "../../components/ui/EmptyState";
import { useAuth, useUser } from "@clerk/expo";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { use } from "react";
import { Platform, View } from "react-native";
import { useWorkspaceSurface } from "../workspace/useWorkspaceSurface";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection, SettingsSidebarContext } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { settingsIndexRowId } from "./components/settings-page-targets";
import { buildSettingsIndexSections, type SettingsListRow } from "./SettingsRouteScreen.logic";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { filterSettingsSections } from "./settings-search";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { isMobileSecretsFeatureEnabled } from "./secret-provider-settings";

export function SettingsRouteScreen() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const inSidebar = use(NativePrimaryColumnContext) !== null && layout.usesSplitView;
  // The page open beside the list: the route right above the Settings tab's route. While
  // another tab is open this list stays mounted, hidden, and must keep showing the page Settings
  // reopens on; otherwise returning shows it unselected for a frame before the page arrives.
  const selected = useNavigationState((state) => {
    const list = state.routes.findIndex((route) => route.name === "Settings");
    return list < 0
      ? rememberedSettingsPage(currentWorkspaceSelections())
      : settingsIndexRowId(state.routes[list + 1]);
  });
  return <SettingsListScreen sidebar={inSidebar} selected={selected} />;
}

export function SettingsListScreen(props: {
  readonly sidebar: boolean;
  readonly selected: string | null;
}) {
  const translator = useMobileInterfaceTranslator();
  const surface = useWorkspaceSurface();
  const workspace = useWorkspaceTabs();
  const inSidebar = props.sidebar;
  const selected = props.selected;
  const sidebar = inSidebar ? { selected } : null;
  const content = hasCloudPublicConfig() ? (
    <ConfiguredSettingsRouteScreen />
  ) : (
    <LocalSettingsRouteScreen />
  );

  return (
    <SettingsSidebarContext value={sidebar}>
      <View className={`flex-1 ${inSidebar ? surface.className : "bg-screen"}`}>
        <SettingsEnvironmentFilterHeader />
        {Platform.OS === "android" ? (
          <SettingsScreen
            title={translator.message("mobile.settings.title")}
            workspaceRoot={inSidebar}
            trailing={<AndroidSettingsEnvironmentFilter />}
            search={
              workspace
                ? {
                    value: workspace.state.tabs.settings.query,
                    onChangeText: (query) =>
                      workspace.dispatch({ type: "query", tab: "settings", query }),
                    placeholder: translator.message("settings.application.search.aria"),
                  }
                : undefined
            }
          >
            {content}
          </SettingsScreen>
        ) : (
          content
        )}
      </View>
    </SettingsSidebarContext>
  );
}

function ConfiguredSettingsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const accountLabel = !isLoaded
    ? translator.message("mobile.ui.checking")
    : !isSignedIn
      ? translator.message("mobile.settings.signIn")
      : (user?.primaryEmailAddress?.emailAddress ?? "Signed in");

  return (
    <SettingsList
      connections={[
        {
          id: "account",
          icon: "person.crop.circle",
          label: translator.message("mobile.ui.t3Account"),
          value: accountLabel,
          disabled: !isLoaded,
          onPress: () => navigation.navigate("SettingsAuth"),
        },
        environmentsRow(
          Object.keys(savedConnectionsById).length,
          translator.message("mobile.settings.environments"),
        ),
      ]}
    />
  );
}

function LocalSettingsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const { savedConnectionsById } = useSavedRemoteConnections();
  return (
    <SettingsList
      connections={[
        environmentsRow(
          Object.keys(savedConnectionsById).length,
          translator.message("mobile.settings.environments"),
        ),
      ]}
    />
  );
}

function environmentsRow(count: number, label: string): SettingsListRow {
  return {
    id: "SettingsEnvironments",
    icon: "desktopcomputer",
    label,
    value: `${count}`,
    valuePosition: "trailing",
    target: "SettingsEnvironments",
  };
}

function SettingsList(props: { readonly connections: readonly SettingsListRow[] }) {
  const translator = useMobileInterfaceTranslator();
  // UIKit's scroll-edge material takes the scroll view's own color; like the chat list, match
  // the sidebar's surface so the bar doesn't darken over content at rest.
  // Grouped cards only lift off the screen surface; the drawer is as dark as they are.
  const listSurface = use(SettingsSidebarContext) ? "bg-drawer" : "bg-screen";
  const insets = useSafeAreaInsets();
  // UIKit insets the scroll view by its column's safe area, which this context can report as 0.
  const bottomSafeArea = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const workspace = useWorkspaceTabs();
  const query = workspace?.state.tabs.settings.query ?? "";
  const overflowRows = useOverflowRows();
  const indexSections = useSettingsIndexSections(props.connections, overflowRows);
  const sections = filterSettingsSections(indexSections, query);

  return (
    <View collapsable={false} className="flex-1">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className={`flex-1 ${listSurface}`}
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{
          // The workspace's clearance keeps the last row above its search field and keyboard.
          paddingBottom:
            Platform.OS === "ios"
              ? Math.max(Math.max(bottomSafeArea, 18) + 18, workspace?.bottomClearance ?? 0) -
                bottomSafeArea
              : Math.max(Math.max(insets.bottom, 18) + 18, workspace?.bottomClearance ?? 0),
        }}
      >
        {sections.length ? (
          sections.map((section) => (
            <SettingsSection key={section.title} title={section.title}>
              {section.rows.map(({ id, searchTerms: _searchTerms, ...row }) => (
                <SettingsRow key={id} {...row} />
              ))}
            </SettingsSection>
          ))
        ) : (
          <EmptyState
            variant="plain"
            title={translator.message("mobile.home.noResults")}
            detail={`No settings match “${query.trim()}”.`}
          />
        )}
      </ScrollView>
    </View>
  );
}

function useSettingsIndexSections(
  connections: readonly SettingsListRow[],
  overflowRows: readonly SettingsListRow[],
) {
  const translator = useMobileInterfaceTranslator();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const scopedProjectMembers =
    selectedProject?.members
      .map((member) => member.project)
      .filter((project) =>
        selectedTargets.some((target) => target.environmentId === project.environmentId),
      ) ?? [];
  const projectLabel =
    scopedProjectMembers.length > 0
      ? deriveProjectGroupLabel({
          representative: scopedProjectMembers[0]!,
          members: scopedProjectMembers,
        })
      : (selectedProject?.label ?? "Unavailable project");
  return buildSettingsIndexSections({
    translate: translator.message,
    connections,
    overflowRows,
    hasServerTargets: selectedTargets.length > 0,
    navigationCustomizationAvailable: navigationCustomizationAvailable(),
    secretsFeatureEnabled: isMobileSecretsFeatureEnabled,
    ...(selectedProjectKey !== null ? { selectedProjectLabel: projectLabel } : {}),
    ...(selectedTargets.length === 1
      ? { betterT3EnvironmentId: selectedTargets[0]!.environmentId }
      : {}),
  });
}

function useOverflowRows(): SettingsListRow[] {
  const tabLabels = useWorkspaceTabLabels();
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  const { layout } = useAdaptiveWorkspaceLayout();
  const tabs =
    Platform.OS === "android" && layout.usesSplitView ? [] : overflowNavigationTabs(order, hidden);
  const selectTab = useSelectWorkspaceTab();
  return tabs.map((tab) => ({
    id: tab,
    icon: NAVIGATION_TAB_ICONS[tab],
    label: tabLabels[tab],
    onPress: () => selectTab(tab),
  }));
}
