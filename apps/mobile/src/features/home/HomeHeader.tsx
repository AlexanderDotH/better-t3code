import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useCallback, useMemo, useRef } from "react";
import type { SearchBarCommands } from "react-native-screens";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";
import type { HomeHeaderProps } from "./HomeHeader.types";

import { Platform } from "react-native";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { PROJECT_SORT_OPTIONS, THREAD_SORT_OPTIONS } from "./home-list-options";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function useHomeListFilterMenuCopy() {
  const translator = useMobileInterfaceTranslator();
  return useMemo(
    () => ({
      title: translator.message("mobile.navigation.threadListOptions"),
      environment: translator.message("mobile.navigation.environment"),
      allEnvironments: translator.message("mobile.navigation.allEnvironments"),
      allEnvironmentsDescription: translator.message(
        "mobile.navigation.allEnvironmentsDescription",
      ),
      project: translator.message("mobile.navigation.project"),
      allProjects: translator.message("mobile.navigation.allProjects"),
      allProjectsDescription: translator.message("mobile.navigation.allProjectsDescription"),
      sortProjects: translator.message("mobile.navigation.sortProjects"),
      sortThreads: translator.message("mobile.navigation.sortThreads"),
      lastUserMessage: translator.message("mobile.navigation.lastUserMessage"),
      createdAt: translator.message("mobile.navigation.createdAt"),
    }),
    [translator],
  );
}

export function HomeHeader(props: HomeHeaderProps) {
  const translator = useMobileInterfaceTranslator();
  const copy = useHomeListFilterMenuCopy();
  const threadListV2Enabled = useThreadListV2Enabled();
  const searchBarRef = useRef<SearchBarCommands>(null);
  const iconColor = useUniwindTheme()["--color-icon"];
  // The list uses a fixed creation order and ignores sort/group options, so
  // the filter menu only carries the filters and the "customized" icon state
  // keys off those alone.
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null || props.selectedProjectKey !== null;
  const focusSearch = useCallback(() => {
    searchBarRef.current?.focus();
    return searchBarRef.current !== null;
  }, []);
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const filterMenu = buildHomeListFilterMenu({
    ...props,
    copy,
    listOrganization: !threadListV2Enabled,
  });

  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={filterMenu.items}
        options={{
          // Static header config (glass, title, fonts) lives in Stack.tsx
          // (GLASS_HEADER_OPTIONS). Only dynamic values are set here.
          headerTintColor: iconColor,
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () => [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: translator.message("mobile.navigation.openSettings"),
                    icon: { name: "ellipsis", type: "sfSymbol" } as const,
                    identifier: "home-settings",
                    label: "",
                    onPress: props.onOpenSettings,
                    type: "button",
                  }),
                ]
              : undefined,
          // The keys below are set per-branch (not `undefined`) so a later
          // reapply cannot clobber options owned by NativeHeaderToolbar.
          ...(NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
            ? {
                unstable_headerToolbarItems: () => [
                  createNativeMailSearchToolbarItem({
                    composeButtonId: "home-new-task",
                    composeSystemImageName: "square.and.pencil",
                    filterMenu,
                    filterButtonId: "home-filter",
                    filterSystemImageName: hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease",
                    onComposePress: props.onStartNewTask,
                    onSearchTextChange: props.onSearchQueryChange,
                    placeholder: translator.message("common.search"),
                    searchTextChangeId: "home-search-text",
                    showsSearchDismissButton: true,
                  }),
                ],
              }
            : {
                // Pre-Liquid-Glass iOS: standard pull-down search in the nav
                // bar; create + sort live in the plain bottom toolbar below.
                headerSearchBarOptions: {
                  ref: searchBarRef,
                  autoCapitalize: "none" as const,
                  hideNavigationBar: false,
                  placeholder: translator.message("common.search"),
                  onCancelButtonPress: () => {
                    props.onSearchQueryChange("");
                  },
                  onChangeText: (event) => {
                    props.onSearchQueryChange(event.nativeEvent.text);
                  },
                },
              }),
        }}
      />

      {NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED ? null : (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel={translator.message("mobile.navigation.filterThreads")}
            icon={
              hasCustomListOptions
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            title={copy.title}
            separateBackground
          >
            <NativeHeaderToolbar.Menu title={copy.environment}>
              <NativeHeaderToolbar.Label>{copy.environment}</NativeHeaderToolbar.Label>
              <NativeHeaderToolbar.MenuAction
                isOn={props.selectedEnvironmentId === null}
                onPress={() => props.onEnvironmentChange(null)}
                subtitle={copy.allEnvironmentsDescription}
              >
                <NativeHeaderToolbar.Label>{copy.allEnvironments}</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
              {props.environments.map((environment) => (
                <NativeHeaderToolbar.MenuAction
                  key={environment.environmentId}
                  isOn={props.selectedEnvironmentId === environment.environmentId}
                  onPress={() => props.onEnvironmentChange(environment.environmentId)}
                >
                  <NativeHeaderToolbar.Label>{environment.label}</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
              ))}
            </NativeHeaderToolbar.Menu>

            {props.projects.length > 0 ? (
              <NativeHeaderToolbar.Menu title={copy.project}>
                <NativeHeaderToolbar.Label>{copy.project}</NativeHeaderToolbar.Label>
                <NativeHeaderToolbar.MenuAction
                  isOn={props.selectedProjectKey === null}
                  onPress={() => props.onProjectChange(null)}
                  subtitle={copy.allProjectsDescription}
                >
                  <NativeHeaderToolbar.Label>{copy.allProjects}</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
                {props.projects.map((project) => (
                  <NativeHeaderToolbar.MenuAction
                    key={project.key}
                    isOn={props.selectedProjectKey === project.key}
                    onPress={() => props.onProjectChange(project.key)}
                  >
                    <NativeHeaderToolbar.Label>{project.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            ) : null}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title={copy.sortProjects}>
                <NativeHeaderToolbar.Label>{copy.sortProjects}</NativeHeaderToolbar.Label>
                {PROJECT_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.projectSortOrder === option.value}
                    onPress={() => props.onProjectSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>
                      {option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt}
                    </NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title={copy.sortThreads}>
                <NativeHeaderToolbar.Label>{copy.sortThreads}</NativeHeaderToolbar.Label>
                {THREAD_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.threadSortOrder === option.value}
                    onPress={() => props.onThreadSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>
                      {option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt}
                    </NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Spacer flexible />
          <NativeHeaderToolbar.Button
            accessibilityLabel={translator.message("mobile.navigation.newTask")}
            icon="square.and.pencil"
            onPress={props.onStartNewTask}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}
    </>
  );
}
