import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../../components/ui/AppBar";
import { AppText } from "../../../components/ui/AppText";
import { ListActionRow } from "../../../components/ui/ListActionRow";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useMobileGitWorkbenchAvailability } from "./use-mobile-git-workbench";
import {
  mobileGitWorkbenchCanActivate,
  mobileGitWorkbenchStatusMessageKey,
} from "./mobile-git-workbench";
import { GitWorkbenchSection } from "./GitWorkbenchSection";

export function ProjectGitWorkbenchEntry(props: { readonly project: EnvironmentProject }) {
  const navigation = useNavigation();
  const t = useMobileInterfaceTranslator();
  const availability = useMobileGitWorkbenchAvailability({
    environmentId: props.project.environmentId,
    threadId: null,
    cwd: props.project.workspaceRoot,
  });
  if (!mobileGitWorkbenchCanActivate(availability)) return null;
  return (
    <ListActionRow
      label={t.message("mobile.gitParity.projectWorkbench")}
      detail={props.project.workspaceRoot}
      onPress={() =>
        navigation.navigate("ProjectGitWorkbench", {
          environmentId: String(props.project.environmentId),
          cwd: props.project.workspaceRoot,
          projectName: props.project.title,
        })
      }
    />
  );
}

export function ProjectGitWorkbenchScreen(
  props: StaticScreenProps<{
    readonly environmentId: string;
    readonly cwd: string;
    readonly projectName?: string;
  }>,
) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const t = useMobileInterfaceTranslator();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const cwd = props.route.params.cwd;
  const availability = useMobileGitWorkbenchAvailability({ environmentId, threadId: null, cwd });
  const enabled = mobileGitWorkbenchCanActivate(availability);
  const canWrite = useAtomValue(
    gitWorkbenchEnvironment.applyChangeSelection.permissionAtom(environmentId),
  );
  return (
    <View className="flex-1 bg-sheet">
      <AppBar
        title={props.route.params.projectName ?? t.message("mobile.git.workbench")}
        subtitle={cwd}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: 16,
          paddingTop: Platform.OS === "android" ? Math.max(insets.top, 16) : 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        {enabled ? (
          <GitWorkbenchSection
            key={JSON.stringify([environmentId, cwd])}
            enabled
            canWrite={canWrite}
            environmentId={environmentId}
            cwd={cwd}
          />
        ) : (
          <AppText className="text-sm text-foreground-muted">
            {t.message(mobileGitWorkbenchStatusMessageKey(availability))}
          </AppText>
        )}
      </ScrollView>
    </View>
  );
}
