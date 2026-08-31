import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { View } from "react-native";

import { EmptyState } from "../../../components/EmptyState";
import { LoadingScreen } from "../../../components/LoadingScreen";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { GitBranchesSheet } from "./GitBranchesSheet";
import { GitCommitSheet } from "./GitCommitSheet";
import { GitConfirmSheet } from "./GitConfirmSheet";
import { GitOverviewSheet } from "./GitOverviewSheet";
import {
  mobileGitWorkbenchCanActivate,
  mobileGitWorkbenchStatusMessageKey,
  resolveMobileGitWorkbenchBlockedRoute,
} from "./mobile-git-workbench";
import { useMobileGitWorkbenchAvailability } from "./use-mobile-git-workbench";

interface MobileGitRouteGateProps {
  readonly children: ReactNode;
  readonly environmentId: string;
  readonly threadId: string;
}

function MobileGitRouteGate(props: MobileGitRouteGateProps) {
  const navigation = useNavigation();
  const translator = useMobileInterfaceTranslator();
  const environmentId = EnvironmentId.make(props.environmentId);
  const threadId = ThreadId.make(props.threadId);
  const availability = useMobileGitWorkbenchAvailability({ environmentId, threadId });
  const available = mobileGitWorkbenchCanActivate(availability);

  useEffect(() => {
    if (available || availability.state === "loading") return;
    const fallback = resolveMobileGitWorkbenchBlockedRoute({ environmentId, threadId });
    navigation.dispatch(StackActions.replace(fallback.name, fallback.params));
  }, [availability.state, available, environmentId, navigation, threadId]);

  if (availability.state === "loading") {
    return <LoadingScreen message={translator.message("settings.betterT3.status.loading")} />;
  }
  if (!available) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet px-6">
        <EmptyState
          title={translator.message("mobile.git.unavailable")}
          detail={translator.message(mobileGitWorkbenchStatusMessageKey(availability))}
        />
      </View>
    );
  }
  return props.children;
}

export function GuardedGitOverviewSheet(props: ComponentProps<typeof GitOverviewSheet>) {
  return (
    <MobileGitRouteGate
      environmentId={props.route.params.environmentId}
      threadId={props.route.params.threadId}
    >
      <GitOverviewSheet {...props} />
    </MobileGitRouteGate>
  );
}

export function GuardedGitCommitSheet(props: ComponentProps<typeof GitCommitSheet>) {
  return (
    <MobileGitRouteGate
      environmentId={props.route.params.environmentId}
      threadId={props.route.params.threadId}
    >
      <GitCommitSheet {...props} />
    </MobileGitRouteGate>
  );
}

export function GuardedGitBranchesSheet(props: ComponentProps<typeof GitBranchesSheet>) {
  return (
    <MobileGitRouteGate
      environmentId={props.route.params.environmentId}
      threadId={props.route.params.threadId}
    >
      <GitBranchesSheet {...props} />
    </MobileGitRouteGate>
  );
}

export function GuardedGitConfirmSheet(props: ComponentProps<typeof GitConfirmSheet>) {
  return (
    <MobileGitRouteGate
      environmentId={props.route.params.environmentId}
      threadId={props.route.params.threadId}
    >
      <GitConfirmSheet {...props} />
    </MobileGitRouteGate>
  );
}
