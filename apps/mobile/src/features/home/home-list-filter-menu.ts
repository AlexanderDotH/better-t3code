import type { EnvironmentId, SidebarThreadSortOrder } from "@t3tools/contracts";

import type { HomeProjectSortOrder } from "./homeThreadList";
import { PROJECT_SORT_OPTIONS, THREAD_SORT_OPTIONS } from "./home-list-sort-options";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly onPress: () => void;
};

type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuAction[];
};

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

export interface HomeListFilterMenuCopy {
  readonly title: string;
  readonly environment: string;
  readonly allEnvironments: string;
  readonly allEnvironmentsDescription: string;
  readonly project: string;
  readonly allProjects: string;
  readonly allProjectsDescription: string;
  readonly sortProjects: string;
  readonly sortThreads: string;
  readonly lastUserMessage: string;
  readonly createdAt: string;
}

const DEFAULT_HOME_LIST_FILTER_MENU_COPY: HomeListFilterMenuCopy = {
  title: "Thread list options",
  environment: "Environment",
  allEnvironments: "All environments",
  allEnvironmentsDescription: "Show threads from every environment",
  project: "Project",
  allProjects: "All projects",
  allProjectsDescription: "Show threads from every project",
  sortProjects: "Sort projects",
  sortThreads: "Sort threads",
  lastUserMessage: "Last user message",
  createdAt: "Created at",
};

export function buildHomeListFilterMenu(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onProjectSortOrderChange: (sortOrder: HomeProjectSortOrder) => void;
  readonly onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  /** False hides the sort/group submenus. Thread List v2 uses a fixed
      creation-order layout, so offering those controls while it silently
      ignores them would be a lie; the environment filter still applies. */
  readonly listOrganization?: boolean;
  readonly copy?: HomeListFilterMenuCopy;
}): HomeListFilterMenu {
  const copy = props.copy ?? DEFAULT_HOME_LIST_FILTER_MENU_COPY;
  const items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu> = [];

  items.push({
    type: "submenu",
    title: copy.environment,
    items: [
      {
        type: "action",
        title: copy.allEnvironments,
        subtitle: copy.allEnvironmentsDescription,
        state: props.selectedEnvironmentId === null ? "on" : "off",
        onPress: () => props.onEnvironmentChange(null),
      },
      ...props.environments.map((environment) => ({
        type: "action" as const,
        title: environment.label,
        state:
          props.selectedEnvironmentId === environment.environmentId
            ? ("on" as const)
            : ("off" as const),
        onPress: () => props.onEnvironmentChange(environment.environmentId),
      })),
    ],
  });

  if (props.projects.length > 0) {
    items.push({
      type: "submenu",
      title: copy.project,
      items: [
        {
          type: "action",
          title: copy.allProjects,
          subtitle: copy.allProjectsDescription,
          state: props.selectedProjectKey === null ? "on" : "off",
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          type: "action" as const,
          title: project.label,
          state: props.selectedProjectKey === project.key ? ("on" as const) : ("off" as const),
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  if (props.listOrganization !== false) {
    items.push(
      {
        type: "submenu",
        title: copy.sortProjects,
        items: PROJECT_SORT_OPTIONS.map((option) => ({
          type: "action",
          title: option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt,
          state: props.projectSortOrder === option.value ? "on" : "off",
          onPress: () => props.onProjectSortOrderChange(option.value),
        })),
      },
      {
        type: "submenu",
        title: copy.sortThreads,
        items: THREAD_SORT_OPTIONS.map((option) => ({
          type: "action",
          title: option.value === "updated_at" ? copy.lastUserMessage : copy.createdAt,
          state: props.threadSortOrder === option.value ? "on" : "off",
          onPress: () => props.onThreadSortOrderChange(option.value),
        })),
      },
    );
  }

  return {
    title: copy.title,
    items,
  };
}
