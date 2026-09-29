import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { MaterialThreadListToolbar } from "./MaterialThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";

import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import {
  hasCustomHomeListOptions,
  PROJECT_SORT_OPTIONS,
  THREAD_SORT_OPTIONS,
} from "./home-list-options";

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

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  const copy = useHomeListFilterMenuCopy();
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.selectedProjectKey !== null
    : hasCustomHomeListOptions(props);
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: copy.environment,
        subactions: [
          {
            id: "environment:all",
            title: copy.allEnvironments,
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: copy.project,
              subactions: [
                {
                  id: "project:all",
                  title: copy.allProjects,
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
      ...(threadListV2Enabled
        ? []
        : ([
            {
              id: "project-sort",
              title: copy.sortProjects,
              subactions: PROJECT_SORT_OPTIONS.map((option) => ({
                id: `project-sort:${option.value}`,
                title: option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt,
                state: checkedMenuState(props.projectSortOrder === option.value),
              })),
            },
            {
              id: "thread-sort",
              title: copy.sortThreads,
              subactions: THREAD_SORT_OPTIONS.map((option) => ({
                id: `thread-sort:${option.value}`,
                title: option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt,
                state: checkedMenuState(props.threadSortOrder === option.value),
              })),
            },
          ] satisfies MenuAction[])),
    ],
    [
      copy,
      props.environments,
      props.projectSortOrder,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
      props.threadSortOrder,
      threadListV2Enabled,
    ],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }

      const projectSort = PROJECT_SORT_OPTIONS.find(
        (option) => id === `project-sort:${option.value}`,
      );
      if (projectSort) {
        props.onProjectSortOrderChange(projectSort.value);
        return;
      }

      const threadSort = THREAD_SORT_OPTIONS.find((option) => id === `thread-sort:${option.value}`);
      if (threadSort) {
        props.onThreadSortOrderChange(threadSort.value);
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <MaterialThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
