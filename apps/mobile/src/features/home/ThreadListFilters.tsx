import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ThreadListFilters(
  props: Pick<
    HomeHeaderProps,
    | "environments"
    | "projects"
    | "selectedEnvironmentId"
    | "selectedProjectKey"
    | "selectedProjectKeys"
    | "onEnvironmentChange"
    | "onProjectChange"
  > & {
    /** List padding the scroller bleeds through so pills start where row content does. */
    readonly gutter: number;
  },
) {
  const translator = useMobileInterfaceTranslator();
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProjectKeys =
    props.selectedProjectKeys ?? (props.selectedProjectKey ? [props.selectedProjectKey] : []);
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={
          selectedEnvironment?.label ?? translator.message("mobile.navigation.allEnvironments")
        }
        accessibilityLabel={translator.message("mobile.ui.filterThreadsByEnvironment")}
        active={selectedEnvironment !== undefined}
        actions={[
          {
            id: "all",
            title: translator.message("mobile.navigation.allEnvironments"),
            state: props.selectedEnvironmentId === null ? "on" : "off",
          },
          ...props.environments.map((environment) => ({
            id: JSON.stringify(environment.environmentId),
            title: environment.label,
            state:
              environment.environmentId === props.selectedEnvironmentId
                ? ("on" as const)
                : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onEnvironmentChange(null);
          else {
            const environment = props.environments.find(
              (candidate) => JSON.stringify(candidate.environmentId) === id,
            );
            if (environment) props.onEnvironmentChange(environment.environmentId);
          }
        }}
      />
      <ListFilterMenu
        label={
          selectedProjectKeys.length > 1
            ? translator.message("mobile.home.projectsSelected", {
                count: selectedProjectKeys.length,
              })
            : (selectedProject?.label ?? translator.message("mobile.navigation.allProjects"))
        }
        accessibilityLabel={translator.message("sidebar.project.filter")}
        active={selectedProjectKeys.length > 0}
        actions={[
          {
            id: "all",
            title: translator.message("mobile.navigation.allProjects"),
            state: selectedProjectKeys.length === 0 ? "on" : "off",
          },
          ...props.projects.map((project) => ({
            id: JSON.stringify(project.key),
            title: project.label,
            state: selectedProjectKeys.includes(project.key) ? ("on" as const) : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onProjectChange(null);
          else {
            const project = props.projects.find(
              (candidate) => JSON.stringify(candidate.key) === id,
            );
            if (project) props.onProjectChange(project.key);
          }
        }}
      />
      {props.selectedEnvironmentId !== null || selectedProjectKeys.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translator.message("mobile.ui.resetThreadFilters")}
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onEnvironmentChange(null);
            props.onProjectChange(null);
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
