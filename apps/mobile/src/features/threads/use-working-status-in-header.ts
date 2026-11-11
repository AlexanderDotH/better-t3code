import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";

export function useWorkingStatusInHeader(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    AsyncResult.isSuccess(preferences) &&
    resolveBetterT3FeatureFlag(
      preferences.value.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      "chat.workingStatusInHeader",
    )
  );
}
