import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { useEnvironmentServerConfig } from "../../../state/entities";
import { mobilePreferencesAtom } from "../../../state/preferences";
import {
  resolveMobileGitWorkbenchAvailability,
  type MobileGitWorkbenchAvailability,
} from "./mobile-git-workbench";

export function useMobileGitWorkbenchAvailability(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): MobileGitWorkbenchAvailability {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const serverConfig = useEnvironmentServerConfig(input.environmentId);
  const featureEnabled =
    AsyncResult.isSuccess(preferences) && !preferences.waiting
      ? resolveBetterT3FeatureFlag(
          preferences.value.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
          "workspace.gitWorkbench",
        )
      : null;
  return resolveMobileGitWorkbenchAvailability({
    featureEnabled,
    gitWorkbenchVersion: serverConfig?.environment.capabilities.gitWorkbenchVersion,
    environmentId: input.environmentId,
    threadId: input.threadId,
  });
}
