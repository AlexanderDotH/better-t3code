import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { ProjectIndexingController } from "../project-indexing/ProjectIndexingController";
import { ProjectIndexingDefaultsCard } from "../project-indexing/ProjectIndexingDefaultsCard";
import { ProjectIndexActionButton } from "../project-indexing/ProjectIndexControls";
import {
  findMobileProjectIndexProject,
  type ProjectIndexingSettingsRouteParams,
} from "../project-indexing/mobile-project-index-settings";

type Props = StaticScreenProps<ProjectIndexingSettingsRouteParams | undefined>;

export function SettingsProjectIndexingRouteScreen(props: Props) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation<NativeStackNavigationProp<{ SettingsProjects: undefined }>>();
  const projects = useProjects();
  const { environments } = useWorkspaceState();
  const params = props.route.params;
  const projectMode = params?.projectId !== undefined;
  const project = findMobileProjectIndexProject(projects, params);
  const title = translator.message(
    projectMode ? "projectIndexing.projectSettings" : "projectIndexing.globalTitle",
  );
  const connectedEnvironments = environments.filter(
    (environment) =>
      environment.connectionState === "connected" &&
      (params?.environmentId === undefined || environment.environmentId === params.environmentId),
  );
  const projectEnvironmentLabel = project
    ? environments.find((environment) => environment.environmentId === project.environmentId)
        ?.environmentLabel
    : undefined;

  return (
    <AndroidScreenScaffold title={title}>
      <NativeStackScreenOptions options={{ title }} />
      <ScreenScaffoldScrollView>
        {projectMode ? (
          project ? (
            <View className="gap-3">
              <Text className="px-2 text-sm text-foreground-muted" selectable>
                {project.workspaceRoot}
              </Text>
              <ProjectIndexingController
                key={JSON.stringify([project.environmentId, project.id])}
                environmentId={project.environmentId}
                environmentLabel={projectEnvironmentLabel}
                projectId={project.id}
                projectLabel={project.title}
              />
            </View>
          ) : (
            <EmptyState
              title={title}
              detail={translator.message("projectIndexing.selectProjectFirst")}
              actionLabel={translator.message("mobile.settings.projects")}
              onAction={() => navigation.navigate("SettingsProjects")}
              variant="plain"
            />
          )
        ) : (
          <>
            <Text className="px-2 text-sm text-foreground-muted">
              {translator.message("projectIndexing.masterDescription")}
            </Text>
            {connectedEnvironments.length === 0 ? (
              <EmptyState
                title={title}
                detail={translator.message("settings.betterT3.noEnvironment")}
                variant="plain"
              />
            ) : (
              connectedEnvironments.map((environment) => (
                <ProjectIndexingDefaultsCard
                  key={environment.environmentId}
                  environmentId={environment.environmentId}
                  environmentLabel={environment.environmentLabel}
                />
              ))
            )}
            <View className="gap-2 px-2">
              <Text className="text-sm text-foreground-muted">
                {translator.message("projectIndexing.projectSettingsDescription")}
              </Text>
              <ProjectIndexActionButton
                label={translator.message("projectIndexing.projectSettings")}
                onPress={() => navigation.navigate("SettingsProjects")}
              />
            </View>
          </>
        )}
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
